import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GithubApiService } from '../src/services/github/github-api.service'
import { GoodreadsApiService } from '../src/services/goodreads/goodreads-api.service'
import { LastFMApiService } from '../src/services/last-fm/last-fm.api'
import { Logger } from '../src/logger'
import { mockUpstream, readingRSS, track, viewer } from './helpers'

test('GitHub status safely handles a missing status and bio', async () => {
  mockUpstream(() => ({ data: { viewer: { ...viewer, status: null, bio: null, company: null } } }))
  const status = await new GithubApiService().getGithubStatus()
  assert.equal(status.status, '')
  assert.equal(status.updatedAt, null)
  assert.equal(status.bio, 'A dreamer')
  assert.equal(status.company, null)
})

test('GitHub preserves unknown emoji shortcodes', async () => {
  mockUpstream(() => ({
    data: { viewer: { ...viewer, status: { ...viewer.status, emoji: ':custom-emoji:' } } },
  }))
  assert.equal((await new GithubApiService().getGithubStatus()).status, ':custom-emoji: Building')
})

test('GitHub GraphQL errors are propagated', async () => {
  mockUpstream(() => ({ errors: [{ message: 'Bad credentials' }] }))
  await assert.rejects(new GithubApiService().getGithubStatus(), /Bad credentials/)
})

test('GitHub skips push events without commits and selects the last authored commit', async () => {
  mockUpstream(() => [
    { type: 'WatchEvent' },
    { type: 'PushEvent', payload: {} },
    {
      type: 'PushEvent',
      created_at: '2026-11-23T00:00:00Z',
      repo: { name: 'example/repo' },
      payload: {
        commits: [
          { message: 'old', sha: 'old', author: { name: 'Dante' } },
          { message: ' fix: newest \nDetails', sha: 'new', author: { name: 'Dante' } },
          { message: 'no author', sha: 'skip' },
        ],
      },
    },
  ])
  const commit = await new GithubApiService().getLatestCommit()
  assert.equal(commit?.message, 'fix: newest')
  assert.equal(commit?.url, 'https://github.com/example/repo/commit/new')
})

test('GitHub returns the existing default when there are no public commits', async () => {
  mockUpstream(() => [])
  assert.equal((await new GithubApiService().getLatestCommit())?.message, 'feat: Hack complete')
})

test('GitHub returns null on HTTP failure', async () => {
  mockUpstream(() => {
    throw new Error('Unavailable')
  })
  assert.equal(await new GithubApiService().getLatestCommit(), null)
})

test('Last.fm uses HTTPS and correctly parses a completed track', async () => {
  mockUpstream(url => {
    assert.equal(new URL(url).protocol, 'https:')
    assert.equal(new URL(url).searchParams.get('format'), 'json')
    return url.includes('user.getinfo') ? { user: { playcount: '42' } } : { recenttracks: { track: [track] } }
  })
  const song = await new LastFMApiService().getSongListening()
  assert.equal(song?.playing, false)
  assert.equal(song?.lastPlayingDate, new Date(Number(track.date.uts) * 1000).toISOString())
  assert.equal(song?.image, 'cover.jpg')
})

test('Last.fm handles a single now-playing track without a date or images', async () => {
  mockUpstream(url =>
    url.includes('user.getinfo')
      ? { user: { playcount: '42' } }
      : { recenttracks: { track: { ...track, date: undefined, image: [], '@attr': { nowplaying: 'true' } } } },
  )
  const song = await new LastFMApiService().getSongListening()
  assert.equal(song?.playing, true)
  assert.equal(song?.image, '')
  assert.ok(Number.isFinite(Date.parse(song!.lastPlayingDate)))
})

test('Last.fm returns null for an empty track list', async () => {
  mockUpstream(url => (url.includes('user.getinfo') ? { user: { playcount: '0' } } : { recenttracks: { track: [] } }))
  assert.equal(await new LastFMApiService().getSongListening(), null)
})

test('Last.fm handles upstream failures', async t => {
  t.mock.method(Logger.prototype, 'error', () => {})
  mockUpstream(() => {
    throw new Error('Unavailable')
  })
  assert.equal(await new LastFMApiService().getSongListening(), null)
})

test('Goodreads parses an RSS feed containing a single item', async () => {
  mockUpstream(() => readingRSS)
  const reading = await new GoodreadsApiService().lastReading()
  assert.equal(reading.title, "I'm on page 50 of Example")
  assert.equal(reading.updatedAt, '2026-11-23T00:00:00.000Z')
  assert.equal(reading.url, 'https://www.goodreads.com/status/1')
})

test('Goodreads selects the first reading status in a multi-item feed', async () => {
  mockUpstream(() => readingRSS.replace('<channel>', '<channel><item><title>Other status</title></item>'))
  assert.equal((await new GoodreadsApiService().lastReading()).title, "I'm on page 50 of Example")
})

test('Goodreads retains its fallback on invalid RSS', async t => {
  t.mock.method(console, 'error', () => {})
  mockUpstream(() => 'invalid XML')
  assert.equal((await new GoodreadsApiService().lastReading()).title, 'Atomic Habits')
})
