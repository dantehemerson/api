import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { FastifyInstance } from 'fastify'
import { App } from '../src/app'
import {
  createApiTokenGuard,
  generateApiToken,
  hashApiToken,
  parseBearerToken,
  tokenMatchesHash,
} from '../src/auth/api-token'
import { type UsageDependencies } from '../src/graphql/root.graphql'
import { type ChatGPTUsageSnapshot, type MachineSnapshot } from '../src/graphql/schema'
import { UsageStore } from '../src/usage/usage-store'

const CHATGPT_TOKEN = 'chatgpt-collector-token-value'
const MACHINES_TOKEN = 'machines-collector-token-value'

function createStorePath(): string {
  return join(mkdtempSync(join(tmpdir(), 'api-token-test-')), 'usage.db')
}

function createApp(store: UsageStore, options: { chatgptHash?: string | null; machinesHash?: string | null } = {}) {
  const chatgptHash = options.chatgptHash === undefined ? hashApiToken(CHATGPT_TOKEN) : options.chatgptHash
  const machinesHash = options.machinesHash === undefined ? hashApiToken(MACHINES_TOKEN) : options.machinesHash
  const usage: Partial<UsageDependencies> = {
    store,
    tokenCredentials: {
      chatgpt: { hash: chatgptHash ?? undefined },
      machines: { hash: machinesHash ?? undefined },
    },
    // The Cloudflare Access fallback is not configured in these tests, so any
    // request that falls through to it must fail.
    credentials: { chatgpt: {}, machines: {} },
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
  const headers: Record<string, string> = {}
  if (options.token !== undefined) headers.authorization = `Bearer ${options.token}`
  const response = await app.inject({
    method: 'POST',
    url: '/graphql',
    headers,
    payload: { query, variables: options.variables ?? {} },
  })
  return response.json()
}

const CHATGPT_FIELDS = 'version plan fetchedAt stale meters { window usedPercent resetsAt }'
const MACHINE_FIELDS = 'id name dnsName os online addresses lastSeen openCodeVersion codexVersion claudeCodeVersion'
const UPLOAD_CHATGPT = `mutation Upload($input: ChatGPTUsageInput!) { uploadChatgptUsage(input: $input) { ${CHATGPT_FIELDS} } }`
const UPLOAD_MACHINES = `mutation Upload($input: MachinesInput!) { uploadMachines(input: $input) { version fetchedAt stale machines { ${MACHINE_FIELDS} } } }`

const chatgptInput = () => ({
  version: 1,
  plan: 'plus',
  fetchedAt: new Date().toISOString(),
  meters: [{ window: 'fiveHour', usedPercent: 18.25, resetsAt: '2026-11-17T06:19:38Z' }],
})

const machinesInput = () => ({
  version: 1,
  fetchedAt: new Date().toISOString(),
  machines: [
    {
      id: 'node-1',
      name: 'test-machine',
      dnsName: 'test-machine.tail.test',
      os: 'macOS',
      online: true,
      addresses: ['100.64.0.1'],
      lastSeen: '2026-11-17T04:00:00Z',
      openCodeVersion: '1.2.3',
    },
  ],
})

test('a valid API token uploads a snapshot that is served back exactly', async t => {
  const store = new UsageStore(createStorePath())
  const app = createApp(store)
  t.after(() => app.close())
  const input = chatgptInput()

  const upload = await graphql<{ uploadChatgptUsage: ChatGPTUsageSnapshot }>(app, UPLOAD_CHATGPT, {
    variables: { input },
    token: CHATGPT_TOKEN,
  })
  assert.equal(upload.errors, undefined, JSON.stringify(upload.errors))
  assert.deepEqual(upload.data?.uploadChatgptUsage, {
    version: 1,
    plan: 'plus',
    fetchedAt: input.fetchedAt,
    stale: false,
    // The API normalizes timestamps to full ISO-8601 with milliseconds.
    meters: [{ window: 'fiveHour', usedPercent: 18.25, resetsAt: '2026-11-17T06:19:38.000Z' }],
  })
})

test('each API token is bound to exactly one mutation', async t => {
  const store = new UsageStore(createStorePath())
  const app = createApp(store)
  t.after(() => app.close())

  // The machines token must not be able to write a ChatGPT snapshot.
  const crossed = await graphql(app, UPLOAD_CHATGPT, {
    variables: { input: chatgptInput() },
    token: MACHINES_TOKEN,
  })
  assert.equal(crossed.errors?.[0]?.message, 'Invalid collector API token')

  // And the ChatGPT token must not be able to write a machines snapshot.
  const crossedBack = await graphql(app, UPLOAD_MACHINES, {
    variables: { input: machinesInput() },
    token: CHATGPT_TOKEN,
  })
  assert.equal(crossedBack.errors?.[0]?.message, 'Invalid collector API token')

  // Nothing was written by either attempt.
  const stored = await graphql<{ chatgptUsage: unknown; machines: unknown }>(
    app,
    '{ chatgptUsage { version } machines { version } }',
  )
  assert.equal(stored.data?.chatgptUsage, null)
  assert.equal(stored.data?.machines, null)
})

test('uploads without a usable token are rejected and never write', async t => {
  const store = new UsageStore(createStorePath())
  const app = createApp(store)
  t.after(() => app.close())

  for (const token of [undefined, '', 'wrong-token', 'chatgpt-collector-token-valu']) {
    const upload = await graphql(app, UPLOAD_CHATGPT, {
      variables: { input: chatgptInput() },
      token,
    })
    assert.ok(upload.errors, `token ${JSON.stringify(token)} must be rejected`)
  }

  const stored = await graphql<{ chatgptUsage: unknown }>(app, '{ chatgptUsage { version } }')
  assert.equal(stored.data?.chatgptUsage, null)
})

test('an unconfigured API token fails closed instead of accepting anything', async t => {
  const store = new UsageStore(createStorePath())
  const app = createApp(store, { chatgptHash: null })
  t.after(() => app.close())

  const upload = await graphql(app, UPLOAD_CHATGPT, {
    variables: { input: chatgptInput() },
    token: CHATGPT_TOKEN,
  })
  assert.equal(upload.errors?.[0]?.message, 'Collector authentication is not configured')
})

test('a malformed or missing Authorization header is rejected', async t => {
  const store = new UsageStore(createStorePath())
  const app = createApp(store)
  t.after(() => app.close())

  const response = await app.inject({
    method: 'POST',
    url: '/graphql',
    headers: { authorization: 'Basic Y2hhcmdwdDpwYXNzd29yZA==' },
    payload: { query: UPLOAD_CHATGPT, variables: { input: chatgptInput() } },
  })
  const body = response.json() as GraphQLResponse<unknown>
  assert.equal(body.errors?.[0]?.message, 'Missing collector API token')
})

test('the stored hash never contains the token plaintext', () => {
  const token = generateApiToken()
  const hash = hashApiToken(token)
  assert.notEqual(hash, token)
  assert.ok(!hash.includes(token))
  assert.match(hash, /^[a-f0-9]{64}$/)
  assert.ok(tokenMatchesHash(token, hash))
  assert.ok(!tokenMatchesHash(`${token}x`, hash))
})

test('generated tokens are high entropy and unique', () => {
  const tokens = new Set(Array.from({ length: 64 }, () => generateApiToken()))
  assert.equal(tokens.size, 64)
  for (const token of tokens) {
    assert.ok(token.length >= 43, `token too short: ${token.length}`)
    assert.match(token, /^[A-Za-z0-9_-]+$/)
  }
})

test('parseBearerToken accepts only a single bearer credential', () => {
  assert.equal(parseBearerToken('Bearer abc'), 'abc')
  assert.equal(parseBearerToken('bearer abc'), 'abc')
  assert.equal(parseBearerToken('Bearer   abc  '), 'abc')
  assert.equal(parseBearerToken('Bearer '), undefined)
  assert.equal(parseBearerToken('Basic abc'), undefined)
  assert.equal(parseBearerToken('abc'), undefined)
  assert.equal(parseBearerToken('Bearer a b'), undefined)
  assert.equal(parseBearerToken(undefined), undefined)
})

test('tokenMatchesHash rejects malformed or non-hex stored hashes', () => {
  const token = generateApiToken()
  const hash = hashApiToken(token)
  assert.ok(tokenMatchesHash(token, hash))
  assert.ok(tokenMatchesHash(token, hash.toUpperCase()))
  assert.ok(!tokenMatchesHash(token, 'not-a-hash'))
  assert.ok(!tokenMatchesHash(token, ''))
  assert.ok(!tokenMatchesHash(token, hash.slice(0, 63)))
  assert.ok(!tokenMatchesHash('', hash))
})

test('the guard reports distinct failures without leaking the token', async () => {
  const guard = createApiTokenGuard({ hash: hashApiToken(CHATGPT_TOKEN) })
  await guard(CHATGPT_TOKEN)

  await assert.rejects(() => guard(undefined), /Missing collector API token/)
  await assert.rejects(() => guard('nope'), /Invalid collector API token/)
  await assert.rejects(() => createApiTokenGuard({})(CHATGPT_TOKEN), /Collector authentication is not configured/)
})
