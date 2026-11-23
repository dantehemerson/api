import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CacheManager } from '../src/graphql/cache-manager'

test('cache retains values including null and false', async () => {
  const cache = new CacheManager()
  for (const value of [null, false, 0, '', { name: 'cached' }]) {
    const key = JSON.stringify(value)
    assert.deepEqual(await cache.cachedResponse(key, async () => value, 60), value)
    assert.deepEqual(await cache.cachedResponse(key, async () => 'not cached', 60), value)
  }
})

test('cache refetches after TTL expiration', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() })
  const cache = new CacheManager()
  let calls = 0
  const fetchValue = async () => ++calls
  assert.equal(await cache.cachedResponse('expiring', fetchValue, 1), 1)
  assert.equal(await cache.cachedResponse('expiring', fetchValue, 1), 1)
  t.mock.timers.tick(1_001)
  assert.equal(await cache.cachedResponse('expiring', fetchValue, 1), 2)
})

test('cache does not retain rejected requests', async () => {
  const cache = new CacheManager()
  await assert.rejects(
    cache.cachedResponse(
      'failed',
      async () => {
        throw new Error('Unavailable')
      },
      60,
    ),
  )
  assert.equal(await cache.cachedResponse('failed', async () => 'recovered', 60), 'recovered')
})
