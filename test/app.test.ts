import assert from 'node:assert/strict'
import { test } from 'node:test'
import { App } from '../src/app'
import { mockUpstream, readingRSS, track, viewer } from './helpers'

test('Fastify 5 serves health with security headers', async t => {
  const { app } = new App({ logger: false })
  t.after(() => app.close())
  const response = await app.inject({ method: 'GET', url: '/health' })
  assert.equal(response.statusCode, 200)
  assert.equal(response.json().status, 'ok')
  assert.equal(typeof response.json().uptime, 'number')
  assert.equal(response.headers['x-content-type-options'], 'nosniff')
})

test('CORS preflight allows GraphQL requests', async t => {
  const { app } = new App({ logger: false })
  t.after(() => app.close())
  const response = await app.inject({
    method: 'OPTIONS',
    url: '/graphql',
    headers: {
      origin: 'https://example.com',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type',
    },
  })
  assert.equal(response.statusCode, 204)
  assert.equal(response.headers['access-control-allow-origin'], '*')
})

test('Mercurius executes all resolvers with GraphQL 17 and caches upstream responses', async t => {
  let calls = 0
  mockUpstream(url => {
    calls++
    if (url.includes('/graphql')) return { data: { viewer } }
    if (url.includes('/events/public')) {
      return [
        {
          type: 'PushEvent',
          created_at: '2026-11-23T00:00:00Z',
          repo: { name: 'example/repo' },
          payload: { commits: [{ message: 'feat: updated\n\nDetails', sha: 'abc', author: { name: 'Dante' } }] },
        },
      ]
    }
    if (url.includes('user.getrecenttracks')) return { recenttracks: { track: [track] } }
    if (url.includes('user.getinfo')) return { user: { playcount: '1234' } }
    if (url.includes('goodreads.com')) return readingRSS
    throw new Error(`Unexpected URL: ${url}`)
  })
  const { app } = new App({ logger: false })
  t.after(() => app.close())
  const request = {
    method: 'POST' as const,
    url: '/graphql',
    payload: {
      query: `{
        githubStatus { status updatedAt bio company contributions }
        latestCommit { message createdAt url }
        listening { name artist album url image playing scrobbles lastPlayingDate }
        reading { title updatedAt url profileUrl }
      }`,
    },
  }
  const response = await app.inject(request)
  assert.equal(response.statusCode, 200)
  const body = response.json()
  assert.equal(body.errors, undefined, JSON.stringify(body.errors))
  assert.equal(body.data.githubStatus.status, '🚀 Building')
  assert.equal(body.data.githubStatus.contributions, 42)
  assert.equal(body.data.latestCommit.message, 'feat: updated')
  assert.equal(body.data.latestCommit.url, 'https://github.com/example/repo/commit/abc')
  assert.equal(body.data.listening.name, 'Song')
  assert.equal(body.data.listening.playing, false)
  assert.equal(body.data.listening.scrobbles, '1234')
  assert.equal(body.data.reading.title, "I'm on page 50 of Example")
  assert.equal(calls, 5)
  const cached = await app.inject(request)
  assert.deepEqual(cached.json(), body)
  assert.equal(calls, 5)
})

test('GraphQL rejects unknown fields', async t => {
  const { app } = new App({ logger: false })
  t.after(() => app.close())
  const response = await app.inject({
    method: 'POST',
    url: '/graphql',
    payload: { query: '{ unknownField }' },
  })
  assert.equal(response.statusCode, 400)
  assert.match(response.json().errors[0].message, /Cannot query field/)
})

test('GraphiQL remains accessible', async t => {
  const { app } = new App({ logger: false })
  t.after(() => app.close())
  const response = await app.inject({ method: 'GET', url: '/graphiql' })
  assert.equal(response.statusCode, 200)
  assert.match(response.headers['content-type'] ?? '', /text\/html/)
})
