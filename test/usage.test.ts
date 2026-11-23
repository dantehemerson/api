import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { before, test } from 'node:test'
import axios, { type AxiosAdapter } from 'axios'
import { createLocalJWKSet, exportJWK, generateKeyPair, type JWK, type JWTVerifyGetKey, SignJWT } from 'jose'
import type { FastifyInstance } from 'fastify'
import { App } from '../src/app'
import { CLOUDFLARE_ACCESS_ISSUER, createCollectorAccessGuard } from '../src/auth/cloudflare-access'
import { type UsageDependencies, type UsageCredentials } from '../src/graphql/root.graphql'
import { type ChatGPTUsageSnapshot, type MachineSnapshot, type OpenCodeUsage } from '../src/graphql/schema'
import { normalizeGoMeters } from '../src/services/opencode/opencode-usage.service'
import { UsageStore } from '../src/usage/usage-store'
import { normalizeChatGPTSnapshot, normalizeMachineSnapshot } from '../src/usage/validators'
import { mockUpstream } from './helpers'

const CHATGPT_AUDIENCE = 'chatgpt-usage-audience'
const CHATGPT_CLIENT_ID = 'chatgpt-collector.access'
const MACHINES_AUDIENCE = 'machines-only-audience'
const MACHINES_CLIENT_ID = 'machines-only-client.access'

let signingKey: CryptoKey | undefined
let signingJwk: (JWK & { kid: string; alg: string }) | undefined
let accessKeys: JWTVerifyGetKey | undefined

before(async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256')
  signingKey = privateKey
  signingJwk = { ...(await exportJWK(publicKey)), kid: 'usage-test', alg: 'RS256' }
  accessKeys = createLocalJWKSet({ keys: [signingJwk] })
})

interface TestClaims {
  sub?: string
  common_name?: string
  type?: string
  iss?: string
  aud?: string[]
  iat?: number
  exp?: number
  email?: string
}

async function signToken(claims: TestClaims = {}): Promise<string> {
  assert.ok(signingKey && signingJwk)
  return new SignJWT({
    sub: '',
    common_name: CHATGPT_CLIENT_ID,
    type: 'app',
    iss: CLOUDFLARE_ACCESS_ISSUER,
    aud: [CHATGPT_AUDIENCE],
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...claims,
  })
    .setProtectedHeader({ alg: 'RS256', kid: signingJwk.kid })
    .sign(signingKey)
}

const machinesToken = () => signToken({ aud: [MACHINES_AUDIENCE], common_name: MACHINES_CLIENT_ID })

function createStorePath(): string {
  return join(mkdtempSync(join(tmpdir(), 'usage-test-')), 'usage.db')
}

function createApp(store: UsageStore, options: { credentials?: UsageCredentials; opencodeApiKey?: string } = {}) {
  const usage: Partial<UsageDependencies> = {
    store,
    accessKeys,
    credentials: options.credentials ?? {
      chatgpt: { audience: CHATGPT_AUDIENCE, clientId: CHATGPT_CLIENT_ID },
      machines: { audience: MACHINES_AUDIENCE, clientId: MACHINES_CLIENT_ID },
    },
    opencodeApiKey: options.opencodeApiKey,
  }
  const { app } = new App({ logger: false }, usage)
  return app
}

interface GraphQLResponse<T> {
  data?: T | null
  errors?: { message: string }[]
}

async function graphql<T>(
  app: FastifyInstance,
  query: string,
  options: { variables?: Record<string, unknown>; token?: string } = {},
): Promise<GraphQLResponse<T>> {
  const response = await app.inject({
    method: 'POST',
    url: '/graphql',
    headers: options.token === undefined ? {} : { 'cf-access-jwt-assertion': options.token },
    payload: { query, variables: options.variables ?? {} },
  })
  return response.json()
}

const CHATGPT_FIELDS = 'version plan fetchedAt stale meters { window usedPercent resetsAt }'
const MACHINE_FIELDS = 'id name dnsName os online addresses lastSeen openCodeVersion codexVersion claudeCodeVersion'
const CHATGPT_QUERY = `{ chatgptUsage { ${CHATGPT_FIELDS} } }`
const MACHINES_QUERY = `{ machines { version fetchedAt stale machines { ${MACHINE_FIELDS} } } }`
const OPENCODE_QUERY = '{ opencodeUsage { fetchedAt meters { window usedPercent resetsAt } } }'
const UPLOAD_CHATGPT = `mutation Upload($input: ChatGPTUsageInput!) { uploadChatgptUsage(input: $input) { ${CHATGPT_FIELDS} } }`
const UPLOAD_MACHINES = `mutation Upload($input: MachinesInput!) { uploadMachines(input: $input) { version fetchedAt stale machines { ${MACHINE_FIELDS} } } }`

const chatgptInput = () => ({
  version: 1,
  plan: 'plus',
  fetchedAt: new Date().toISOString(),
  meters: [
    { window: 'fiveHour', usedPercent: 18.25, resetsAt: '2026-11-17T06:19:38Z' },
    { window: 'week', usedPercent: 1, resetsAt: null },
  ],
})

const machinesInput = () => ({
  version: 1,
  fetchedAt: new Date().toISOString(),
  machines: [
    {
      id: 'node-1',
      name: '  test-machine  ',
      dnsName: 'test-machine.tail.test',
      os: 'macOS',
      online: true,
      addresses: ['100.64.0.1', '100.64.0.1', 'fd7a::1'],
      lastSeen: '2026-11-17T04:00:00Z',
      openCodeVersion: '1.2.3',
    },
  ],
})

test('uploadChatgptUsage stores a valid snapshot and serves the exact same data back', async t => {
  const store = new UsageStore(createStorePath())
  const app = createApp(store)
  t.after(() => app.close())
  const input = chatgptInput()

  const upload = await graphql<{ uploadChatgptUsage: ChatGPTUsageSnapshot }>(app, UPLOAD_CHATGPT, {
    variables: { input },
    token: await signToken(),
  })
  assert.equal(upload.errors, undefined, JSON.stringify(upload.errors))
  assert.deepEqual(upload.data?.uploadChatgptUsage, {
    version: 1,
    plan: 'plus',
    fetchedAt: input.fetchedAt,
    meters: [
      { window: 'fiveHour', usedPercent: 18.25, resetsAt: '2026-11-17T06:19:38.000Z' },
      { window: 'week', usedPercent: 1, resetsAt: null },
    ],
    stale: false,
  })

  const query = await graphql<{ chatgptUsage: ChatGPTUsageSnapshot | null }>(app, CHATGPT_QUERY)
  assert.equal(query.errors, undefined)
  assert.deepEqual(query.data?.chatgptUsage, upload.data?.uploadChatgptUsage)
})

test('uploaded meters are sorted into window order even when uploaded reversed', async t => {
  const store = new UsageStore(createStorePath())
  const app = createApp(store)
  t.after(() => app.close())
  const input = { ...chatgptInput(), meters: [...chatgptInput().meters].reverse() }

  const upload = await graphql<{ uploadChatgptUsage: ChatGPTUsageSnapshot }>(app, UPLOAD_CHATGPT, {
    variables: { input },
    token: await signToken(),
  })
  assert.equal(upload.errors, undefined, JSON.stringify(upload.errors))
  assert.deepEqual(
    upload.data?.uploadChatgptUsage?.meters.map(meter => meter.window),
    ['fiveHour', 'week'],
  )
})

test('uploadChatgptUsage rejects every non-service-token assertion and stores nothing', async t => {
  const store = new UsageStore(createStorePath())
  const app = createApp(store)
  t.after(() => app.close())
  const input = chatgptInput()

  const attacker = await generateKeyPair('RS256')
  const forged = await new SignJWT({
    sub: '',
    common_name: CHATGPT_CLIENT_ID,
    type: 'app',
    iss: CLOUDFLARE_ACCESS_ISSUER,
    aud: [CHATGPT_AUDIENCE],
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  })
    .setProtectedHeader({ alg: 'RS256' })
    .sign(attacker.privateKey)

  for (const [label, token] of [
    ['no token', undefined],
    ['garbage token', 'forged'],
    ['forged signature', forged],
    ['human subject', await signToken({ sub: 'human' })],
    ['human email', await signToken({ email: 'human@example.com' })],
    ['non-app type', await signToken({ type: 'org' })],
    ['wrong client id', await signToken({ common_name: 'another-client.access' })],
    ['missing common_name', await signToken({ common_name: undefined })],
    ['machines audience', await machinesToken()],
    ['dashboard audience', await signToken({ aud: ['dashboard-audience'] })],
    ['wrong issuer', await signToken({ iss: 'https://attacker.example' })],
    ['expired token', await signToken({ exp: 0 })],
    ['missing exp', await signToken({ exp: undefined })],
    ['missing iat', await signToken({ iat: undefined })],
    ['future iat', await signToken({ iat: Math.floor(Date.now() / 1000) + 3600 })],
  ] as [string, string | undefined][]) {
    const body = await graphql<{ uploadChatgptUsage: ChatGPTUsageSnapshot | null }>(app, UPLOAD_CHATGPT, {
      variables: { input },
      token,
    })
    assert.ok(body.errors, label)
    assert.equal(body.data?.uploadChatgptUsage ?? null, null, label)
    assert.doesNotMatch(body.errors[0].message, /human|attacker|another-client|dashboard|example\.com/, label)
    assert.equal(store.read('chatgpt'), null, label)
  }
})

test('uploadMachines rejects the ChatGPT collector token (cross-application isolation)', async t => {
  const store = new UsageStore(createStorePath())
  const app = createApp(store)
  t.after(() => app.close())
  const input = machinesInput()

  const cross = await graphql<{ uploadMachines: MachineSnapshot | null }>(app, UPLOAD_MACHINES, {
    variables: { input },
    token: await signToken(),
  })
  assert.ok(cross.errors)
  assert.equal(store.read('machines'), null)

  const machinesNoToken = await graphql<{ uploadMachines: MachineSnapshot | null }>(app, UPLOAD_MACHINES, {
    variables: { input },
  })
  assert.ok(machinesNoToken.errors)
  assert.equal(store.read('machines'), null)

  const upload = await graphql<{ uploadMachines: MachineSnapshot }>(app, UPLOAD_MACHINES, {
    variables: { input },
    token: await machinesToken(),
  })
  assert.equal(upload.errors, undefined, JSON.stringify(upload.errors))
  assert.deepEqual(upload.data?.uploadMachines, {
    version: 1,
    fetchedAt: input.fetchedAt,
    stale: false,
    machines: [
      {
        id: 'node-1',
        name: 'test-machine',
        dnsName: 'test-machine.tail.test',
        os: 'macOS',
        online: true,
        addresses: ['100.64.0.1', 'fd7a::1'],
        lastSeen: '2026-11-17T04:00:00Z',
        openCodeVersion: '1.2.3',
        codexVersion: null,
        claudeCodeVersion: null,
      },
    ],
  })

  const query = await graphql<{ machines: MachineSnapshot | null }>(app, MACHINES_QUERY)
  assert.equal(query.errors, undefined)
  assert.deepEqual(query.data?.machines, upload.data?.uploadMachines)
})

test('mutations fail closed when the collector credentials are not configured', async t => {
  const store = new UsageStore(createStorePath())
  const app = createApp(store, { credentials: { chatgpt: {}, machines: {} } })
  t.after(() => app.close())

  for (const [label, query] of [
    ['chatgpt', UPLOAD_CHATGPT],
    ['machines', UPLOAD_MACHINES],
  ] as [string, string][]) {
    const body = await graphql(app, query, {
      variables: { input: label === 'chatgpt' ? chatgptInput() : machinesInput() },
      token: await signToken(),
    })
    assert.ok(body.errors, label)
    assert.match(body.errors[0].message, /not configured/, label)
  }
})

test('uploadChatgptUsage rejects malformed snapshots without storing them', async t => {
  const store = new UsageStore(createStorePath())
  const app = createApp(store)
  t.after(() => app.close())
  const token = await signToken()
  const base = chatgptInput()

  for (const [label, input] of [
    ['bad plan', { ...base, plan: 'sensitive-account-name' }],
    ['unknown version', { ...base, version: 2 }],
    ['bad fetchedAt', { ...base, fetchedAt: 'yesterday' }],
    ['no meters', { ...base, meters: [] }],
    ['duplicate windows', { ...base, meters: [base.meters[0], base.meters[0]] }],
    ['unknown window', { ...base, meters: [{ window: 'month', usedPercent: 1, resetsAt: null }] }],
    ['meter missing resetsAt', { ...base, meters: [{ window: 'week', usedPercent: 1 }] }],
    ['usedPercent above range', { ...base, meters: [{ window: 'week', usedPercent: 101, resetsAt: null }] }],
    ['usedPercent below range', { ...base, meters: [{ window: 'week', usedPercent: -1, resetsAt: null }] }],
    ['bad resetsAt', { ...base, meters: [{ window: 'week', usedPercent: 1, resetsAt: 'not a date' }] }],
  ] as [string, Record<string, unknown>][]) {
    const body = await graphql<{ uploadChatgptUsage: ChatGPTUsageSnapshot | null }>(app, UPLOAD_CHATGPT, {
      variables: { input },
      token,
    })
    assert.ok(body.errors, label)
    assert.equal(body.errors[0].message, 'Invalid ChatGPT usage snapshot', label)
    assert.equal(body.data?.uploadChatgptUsage ?? null, null, label)
    assert.equal(store.read('chatgpt'), null, label)
  }
})

test('uploadMachines rejects malformed snapshots without storing them', async t => {
  const store = new UsageStore(createStorePath())
  const app = createApp(store)
  t.after(() => app.close())
  const token = await machinesToken()
  const base = machinesInput()

  for (const [label, input] of [
    ['unknown version', { ...base, version: 2 }],
    ['bad fetchedAt', { ...base, fetchedAt: 'yesterday' }],
    ['duplicate machine ids', { ...base, machines: [...base.machines, ...base.machines] }],
    ['bad machine id', { ...base, machines: [{ ...base.machines[0], id: 'has spaces!' }] }],
    ['blank machine name', { ...base, machines: [{ ...base.machines[0], name: '   ' }] }],
    ['overlong machine name', { ...base, machines: [{ ...base.machines[0], name: 'x'.repeat(129) }] }],
    ['bad lastSeen', { ...base, machines: [{ ...base.machines[0], lastSeen: 'not a date' }] }],
    ['bad CLI version', { ...base, machines: [{ ...base.machines[0], openCodeVersion: 'latest' }] }],
    [
      'machine missing lastSeen',
      { ...base, machines: [{ id: 'node-1', name: 'x', dnsName: 'x', os: 'x', online: true, addresses: [] }] },
    ],
    [
      'too many addresses',
      {
        ...base,
        machines: [{ ...base.machines[0], addresses: Array.from({ length: 9 }, (_, i) => `10.0.0.${i}`) }],
      },
    ],
  ] as [string, Record<string, unknown>][]) {
    const body = await graphql<{ uploadMachines: MachineSnapshot | null }>(app, UPLOAD_MACHINES, {
      variables: { input },
      token,
    })
    assert.ok(body.errors, label)
    assert.equal(body.errors[0].message, 'Invalid machines snapshot', label)
    assert.equal(body.data?.uploadMachines ?? null, null, label)
    assert.equal(store.read('machines'), null, label)
  }
})

test('uploadChatgptUsage rejects stale and future-dated snapshots', async t => {
  const store = new UsageStore(createStorePath())
  const app = createApp(store)
  t.after(() => app.close())
  const token = await signToken()

  for (const [label, fetchedAt] of [
    ['eleven minutes old', new Date(Date.now() - 11 * 60_000).toISOString()],
    ['two minutes in the future', new Date(Date.now() + 120_000).toISOString()],
  ] as [string, string][]) {
    const body = await graphql<{ uploadChatgptUsage: ChatGPTUsageSnapshot | null }>(app, UPLOAD_CHATGPT, {
      variables: { input: { ...chatgptInput(), fetchedAt } },
      token,
    })
    assert.ok(body.errors, label)
    assert.match(body.errors[0].message, /stale|future/, label)
    assert.equal(store.read('chatgpt'), null, label)
  }

  // Up to 60 seconds of collector clock skew is tolerated, like the dash Worker.
  const skewed = new Date(Date.now() + 30_000).toISOString()
  const accepted = await graphql<{ uploadChatgptUsage: ChatGPTUsageSnapshot }>(app, UPLOAD_CHATGPT, {
    variables: { input: { ...chatgptInput(), fetchedAt: skewed } },
    token,
  })
  assert.equal(accepted.errors, undefined, JSON.stringify(accepted.errors))
  assert.equal(accepted.data?.uploadChatgptUsage.fetchedAt, skewed)
})

test('uploadMachines rejects stale and future-dated snapshots', async t => {
  const store = new UsageStore(createStorePath())
  const app = createApp(store)
  t.after(() => app.close())
  const token = await machinesToken()

  for (const [label, fetchedAt] of [
    ['sixteen minutes old', new Date(Date.now() - 16 * 60_000).toISOString()],
    ['two minutes in the future', new Date(Date.now() + 120_000).toISOString()],
  ] as [string, string][]) {
    const body = await graphql<{ uploadMachines: MachineSnapshot | null }>(app, UPLOAD_MACHINES, {
      variables: { input: { ...machinesInput(), fetchedAt } },
      token,
    })
    assert.ok(body.errors, label)
    assert.match(body.errors[0].message, /stale|future/, label)
    assert.equal(store.read('machines'), null, label)
  }
})

test('chatgptUsage flags a snapshot older than 10 minutes as stale but keeps serving it', async t => {
  const store = new UsageStore(createStorePath())
  const app = createApp(store)
  t.after(() => app.close())

  const old = normalizeChatGPTSnapshot({
    ...chatgptInput(),
    fetchedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
  })
  assert.ok(old)
  store.save('chatgpt', old)

  const body = await graphql<{ chatgptUsage: ChatGPTUsageSnapshot | null }>(app, CHATGPT_QUERY)
  assert.equal(body.errors, undefined)
  assert.equal(body.data?.chatgptUsage?.stale, true)
  assert.equal(body.data?.chatgptUsage?.fetchedAt, old.fetchedAt)
})

test('machines flags a snapshot older than 15 minutes as stale but keeps serving it', async t => {
  const store = new UsageStore(createStorePath())
  const app = createApp(store)
  t.after(() => app.close())

  const old = normalizeMachineSnapshot({
    ...machinesInput(),
    fetchedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
  })
  assert.ok(old)
  store.save('machines', old)

  const body = await graphql<{ machines: MachineSnapshot | null }>(app, MACHINES_QUERY)
  assert.equal(body.errors, undefined)
  assert.equal(body.data?.machines?.stale, true)
  assert.equal(body.data?.machines?.machines.length, 1)
})

test('chatgpt snapshots are retained indefinitely (a sleeping Mac shows stale data)', async t => {
  const store = new UsageStore(createStorePath())
  const app = createApp(store)
  t.after(() => app.close())

  const ancient = normalizeChatGPTSnapshot({
    ...chatgptInput(),
    fetchedAt: new Date(Date.now() - 40 * 24 * 60 * 60_000).toISOString(),
  })
  assert.ok(ancient)
  store.save('chatgpt', ancient)

  const body = await graphql<{ chatgptUsage: ChatGPTUsageSnapshot | null }>(app, CHATGPT_QUERY)
  assert.equal(body.errors, undefined)
  assert.equal(body.data?.chatgptUsage?.stale, true)
  assert.equal(body.data?.chatgptUsage?.fetchedAt, ancient.fetchedAt)
})

test('machines snapshots expire after 30 days and stop being served', async t => {
  const dbPath = createStorePath()
  const store = new UsageStore(dbPath)
  const fresh = normalizeMachineSnapshot(machinesInput())
  assert.ok(fresh)
  store.save('machines', fresh)
  store.close()

  const db = new DatabaseSync(dbPath)
  db.prepare("UPDATE usage_snapshots SET updated_at = ? WHERE kind = 'machines'").run(
    new Date(Date.now() - 31 * 24 * 60 * 60_000).toISOString(),
  )
  db.close()

  const reopened = new UsageStore(dbPath)
  assert.equal(reopened.read('machines'), null)

  const app = createApp(reopened)
  t.after(() => app.close())
  const body = await graphql<{ machines: MachineSnapshot | null }>(app, MACHINES_QUERY)
  assert.equal(body.errors, undefined)
  assert.equal(body.data?.machines, null)
})

test('snapshots persist in SQLite across an application restart', async t => {
  const dbPath = createStorePath()
  const firstApp = createApp(new UsageStore(dbPath))
  const input = chatgptInput()
  const upload = await graphql<{ uploadChatgptUsage: ChatGPTUsageSnapshot }>(firstApp, UPLOAD_CHATGPT, {
    variables: { input },
    token: await signToken(),
  })
  assert.equal(upload.errors, undefined, JSON.stringify(upload.errors))
  await firstApp.close()

  const secondApp = createApp(new UsageStore(dbPath))
  t.after(() => secondApp.close())
  const query = await graphql<{ chatgptUsage: ChatGPTUsageSnapshot | null }>(secondApp, CHATGPT_QUERY)
  assert.equal(query.errors, undefined)
  assert.deepEqual(query.data?.chatgptUsage, upload.data?.uploadChatgptUsage)
})

const goPayload = () => ({
  subscriberUserId: 'private-user',
  billing: { plan: 'secret-plan', email: 'billing@example.com' },
  access: {
    account: { email: 'private@example.com' },
    meters: {
      fiveHour: { limitMicroCents: '1000000000', usedMicroCents: '54100000', resetsAt: '2026-11-16T08:09:10.000Z' },
      week: { limitMicroCents: '1000000', usedMicroCents: '21600', resetsAt: '2026-11-16T08:09:10.000Z' },
      month: { limitMicroCents: '100000', usedMicroCents: '22150', resetsAt: null },
    },
  },
})

test('opencodeUsage proxies the upstream once per cache TTL and never exposes account fields', async t => {
  const store = new UsageStore(createStorePath())
  const app = createApp(store, { opencodeApiKey: 'test-key' })
  t.after(() => app.close())

  let calls = 0
  mockUpstream(url => {
    if (url === 'https://opencode.ai/console/api/go/status') {
      calls++
      return goPayload()
    }
    throw new Error(`Unexpected URL: ${url}`)
  })

  const expectedMeters = [
    { window: 'fiveHour', usedPercent: 5.41, resetsAt: '2026-11-16T08:09:10.000Z' },
    { window: 'week', usedPercent: 2.16, resetsAt: '2026-11-16T08:09:10.000Z' },
    { window: 'month', usedPercent: 22.15, resetsAt: null },
  ]
  const first = await graphql<{ opencodeUsage: OpenCodeUsage | null }>(app, OPENCODE_QUERY)
  assert.equal(first.errors, undefined, JSON.stringify(first.errors))
  const second = await graphql<{ opencodeUsage: OpenCodeUsage | null }>(app, OPENCODE_QUERY)
  assert.equal(second.errors, undefined)
  assert.equal(calls, 1)
  assert.deepEqual(first.data?.opencodeUsage?.meters, expectedMeters)
  assert.deepEqual(second.data?.opencodeUsage?.meters, expectedMeters)
  assert.ok(Number.isFinite(Date.parse(first.data?.opencodeUsage?.fetchedAt ?? 'invalid')))
  assert.doesNotMatch(JSON.stringify(first), /private-user|secret-plan|MicroCents|example\.com/)
})

test('opencodeUsage fails cleanly when the upstream is unavailable', async t => {
  const store = new UsageStore(createStorePath())
  const app = createApp(store, { opencodeApiKey: 'test-key' })
  t.after(() => app.close())

  const adapter: AxiosAdapter = async config => ({
    data: { message: 'denied' },
    status: 503,
    statusText: 'Service Unavailable',
    headers: {},
    config,
  })
  axios.defaults.adapter = adapter

  const body = await graphql<{ opencodeUsage: OpenCodeUsage | null }>(app, OPENCODE_QUERY)
  assert.ok(body.errors)
  assert.equal(body.errors[0].message, 'OpenCode usage is unavailable')
  assert.equal(body.data?.opencodeUsage ?? null, null)
})

test('opencodeUsage fails closed when no API key is configured', async t => {
  const store = new UsageStore(createStorePath())
  const app = createApp(store, { opencodeApiKey: '' })
  t.after(() => app.close())
  let called = false
  mockUpstream(() => {
    called = true
    throw new Error('Upstream should not be reached without a key')
  })

  const body = await graphql<{ opencodeUsage: OpenCodeUsage | null }>(app, OPENCODE_QUERY)
  assert.ok(body.errors)
  assert.equal(body.errors[0].message, 'OpenCode usage API key is not configured')
  assert.equal(body.data?.opencodeUsage ?? null, null)
  assert.equal(called, false)
})

test('opencodeUsage sends the configured bearer token without following redirects', async t => {
  const store = new UsageStore(createStorePath())
  const app = createApp(store, { opencodeApiKey: '  oc_sk_test  ' })
  t.after(() => app.close())

  let authorization: unknown
  let maxRedirects: number | undefined
  const adapter: AxiosAdapter = async config => {
    authorization = config.headers?.authorization
    maxRedirects = config.maxRedirects
    return { data: goPayload(), status: 200, statusText: 'OK', headers: {}, config }
  }
  axios.defaults.adapter = adapter

  const body = await graphql<{ opencodeUsage: OpenCodeUsage | null }>(app, OPENCODE_QUERY)
  assert.equal(body.errors, undefined, JSON.stringify(body.errors))
  assert.equal(authorization, 'Bearer oc_sk_test')
  assert.equal(maxRedirects, 0)
})

test('normalizeGoMeters ports the dash reduction rules', () => {
  assert.deepEqual(normalizeGoMeters(goPayload()), [
    { window: 'fiveHour', usedPercent: 5.41, resetsAt: '2026-11-16T08:09:10.000Z' },
    { window: 'week', usedPercent: 2.16, resetsAt: '2026-11-16T08:09:10.000Z' },
    { window: 'month', usedPercent: 22.15, resetsAt: null },
  ])

  const idle = normalizeGoMeters({
    access: {
      meters: {
        ...goPayload().access.meters,
        fiveHour: { limitMicroCents: '1000000000', usedMicroCents: '0', resetsAt: null },
      },
    },
  })
  assert.deepEqual(idle[0], { window: 'fiveHour', usedPercent: 0, resetsAt: null })

  const clamped = normalizeGoMeters({
    access: {
      meters: {
        ...goPayload().access.meters,
        fiveHour: { limitMicroCents: '10', usedMicroCents: '25', resetsAt: '2026-11-16T08:09:10.000Z' },
        week: { limitMicroCents: '0', usedMicroCents: '0', resetsAt: '2026-11-16T08:09:10.000Z' },
      },
    },
  })
  assert.equal(clamped[0].usedPercent, 100)
  assert.equal(clamped[1].usedPercent, 0)

  for (const meters of [
    { fiveHour: undefined },
    { week: { limitMicroCents: '1.5', usedMicroCents: '1', resetsAt: '2026-11-16T08:09:10.000Z' } },
    { month: { limitMicroCents: '1', usedMicroCents: '1', resetsAt: 'not-a-date' } },
  ]) {
    assert.throws(() => normalizeGoMeters({ access: { meters: { ...goPayload().access.meters, ...meters } } }))
  }
  assert.throws(() => normalizeGoMeters({ access: {} }))
})

test('normalizeChatGPTSnapshot enforces the exact dash contract', () => {
  const snapshot = chatgptInput()
  const normalized = normalizeChatGPTSnapshot(snapshot)
  assert.equal(normalized?.meters[0].resetsAt, '2026-11-17T06:19:38.000Z')
  assert.deepEqual(normalizeChatGPTSnapshot({ ...snapshot, meters: [snapshot.meters[1]] })?.meters, [
    { window: 'week', usedPercent: 1, resetsAt: null },
  ])

  for (const invalid of [
    { ...snapshot, access_token: 'secret' },
    { ...snapshot, plan: 'sensitive-account-name' },
    { ...snapshot, version: 2 },
    { ...snapshot, fetchedAt: 'yesterday' },
    { ...snapshot, meters: [] },
    { ...snapshot, meters: [snapshot.meters[0], snapshot.meters[0]] },
    { ...snapshot, meters: [snapshot.meters[0], snapshot.meters[1], snapshot.meters[1]] },
    { ...snapshot, meters: [{ ...snapshot.meters[0], account_id: 'private' }] },
    ...[-1, 101, Number.NaN, Number.POSITIVE_INFINITY, '25', null].map(usedPercent => ({
      ...snapshot,
      meters: [{ ...snapshot.meters[0], usedPercent }],
    })),
    { ...snapshot, meters: [{ window: 'month', usedPercent: 1, resetsAt: null }] },
    { ...snapshot, meters: [{ ...snapshot.meters[0], resetsAt: 'not a date' }] },
  ]) {
    assert.equal(normalizeChatGPTSnapshot(invalid), null, JSON.stringify(invalid))
  }
})

test('normalizeMachineSnapshot enforces the exact dash contract', () => {
  const snapshot = machinesInput()
  const normalized = normalizeMachineSnapshot(snapshot)
  assert.deepEqual(normalized?.machines, [
    {
      id: 'node-1',
      name: 'test-machine',
      dnsName: 'test-machine.tail.test',
      os: 'macOS',
      online: true,
      addresses: ['100.64.0.1', 'fd7a::1'],
      lastSeen: '2026-11-17T04:00:00Z',
      openCodeVersion: '1.2.3',
      codexVersion: null,
      claudeCodeVersion: null,
    },
  ])

  const optional = normalizeMachineSnapshot({
    ...snapshot,
    machines: [{ ...snapshot.machines[0], codexVersion: '0.9.0', claudeCodeVersion: '1.0.0-beta.1' }],
  })
  assert.equal(optional?.machines[0].codexVersion, '0.9.0')
  assert.equal(optional?.machines[0].claudeCodeVersion, '1.0.0-beta.1')

  const offline = normalizeMachineSnapshot({
    ...snapshot,
    machines: [{ ...snapshot.machines[0], online: null, lastSeen: null, openCodeVersion: null }],
  })
  assert.equal(offline?.machines[0].online, null)
  assert.equal(offline?.machines[0].lastSeen, null)

  // An empty fleet is valid in dash (only >100 machines is rejected).
  assert.deepEqual(normalizeMachineSnapshot({ ...snapshot, machines: [] })?.machines, [])

  for (const invalid of [
    { ...snapshot, extra: 'key' },
    { ...snapshot, version: 2 },
    { ...snapshot, fetchedAt: 'not a date' },
    { ...snapshot, machines: Array.from({ length: 101 }, (_, i) => ({ ...snapshot.machines[0], id: `node-${i}` })) },
    { ...snapshot, machines: ['not-an-object'] },
    { ...snapshot, machines: [{ ...snapshot.machines[0], unknown_key: true }] },
    { ...snapshot, machines: [{ ...snapshot.machines[0], id: 'x'.repeat(129) }] },
    { ...snapshot, machines: [{ ...snapshot.machines[0], name: '' }] },
    { ...snapshot, machines: [{ ...snapshot.machines[0], dnsName: 'x'.repeat(255) }] },
    { ...snapshot, machines: [{ ...snapshot.machines[0], os: 'x'.repeat(33) }] },
    { ...snapshot, machines: [{ ...snapshot.machines[0], online: 'yes' }] },
    { ...snapshot, machines: [{ ...snapshot.machines[0], addresses: ['x'.repeat(65)] }] },
    { ...snapshot, machines: [{ ...snapshot.machines[0], addresses: [42] }] },
    { ...snapshot, machines: [{ ...snapshot.machines[0], openCodeVersion: 'latest' }] },
    { ...snapshot, machines: [{ ...snapshot.machines[0], codexVersion: 'v1.0.0' }] },
  ]) {
    assert.equal(normalizeMachineSnapshot(invalid), null, JSON.stringify(invalid))
  }
})

test('collector guard accepts only the pinned service identity and fails closed', async () => {
  assert.ok(accessKeys)
  const guard = createCollectorAccessGuard({ keys: accessKeys })
  const credentials = { audience: CHATGPT_AUDIENCE, clientId: CHATGPT_CLIENT_ID }

  await guard(await signToken(), credentials)

  for (const claims of [
    { aud: ['dashboard-audience'] },
    { common_name: 'another-client.access' },
    { common_name: undefined },
    { sub: 'human' },
    { email: 'human@example.com' },
    { iss: 'https://attacker.example' },
    { exp: 0 },
    { exp: undefined },
    { iat: undefined },
    { iat: Math.floor(Date.now() / 1000) + 3600 },
    { type: 'org' },
  ]) {
    await assert.rejects(guard(await signToken(claims), credentials))
  }

  const attacker = await generateKeyPair('RS256')
  const forged = await new SignJWT({ common_name: CHATGPT_CLIENT_ID, type: 'app', iss: CLOUDFLARE_ACCESS_ISSUER })
    .setProtectedHeader({ alg: 'RS256' })
    .sign(attacker.privateKey)
  for (const token of [undefined, 'forged', forged]) {
    await assert.rejects(guard(token, credentials))
  }

  await assert.rejects(guard(await signToken(), {}), /not configured/)

  const outage = createCollectorAccessGuard({
    keys: async () => {
      throw new Error('sensitive JWKS failure')
    },
  })
  await assert.rejects(outage(await signToken(), credentials), (error: Error) => !/sensitive/.test(error.message))
})

test('usage queries return null before anything has been uploaded', async t => {
  const store = new UsageStore(createStorePath())
  const app = createApp(store)
  t.after(() => app.close())

  const body = await graphql<{ chatgptUsage: ChatGPTUsageSnapshot | null; machines: MachineSnapshot | null }>(
    app,
    '{ chatgptUsage { stale } machines { stale } }',
  )
  assert.equal(body.errors, undefined)
  assert.equal(body.data?.chatgptUsage, null)
  assert.equal(body.data?.machines, null)
})
