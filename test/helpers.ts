import axios, { type AxiosAdapter } from 'axios'
import { afterEach, beforeEach } from 'node:test'

const originalAdapter = axios.defaults.adapter

beforeEach(() => {
  mockUpstream(url => {
    throw new Error(`Unmocked upstream request: ${url}`)
  })
})

afterEach(() => {
  axios.defaults.adapter = originalAdapter
})

export function mockUpstream(respond: (url: string, data: unknown) => unknown): void {
  const adapter: AxiosAdapter = async config => ({
    data: respond(config.url ?? '', config.data),
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  })
  axios.defaults.adapter = adapter
}

export const viewer = {
  bio: 'Developer',
  company: 'Example',
  status: { emoji: ':rocket:', message: 'Building', updatedAt: '2026-11-23T00:00:00Z' },
  contributionsCollection: { contributionCalendar: { totalContributions: 42 } },
}

export const track = {
  name: 'Song',
  artist: { '#text': 'Artist' },
  album: { '#text': 'Album' },
  url: 'https://last.fm/music/artist/song',
  image: [{ '#text': '' }, { '#text': '' }, { '#text': '' }, { '#text': 'cover.jpg' }],
  date: { uts: '1795392000' },
}

export const readingRSS = `<?xml version="1.0"?>
<rss><channel><item>
  <title>Dante Calderón is on page 50 of Example</title>
  <pubDate>Mon, 23 Nov 2026 00:00:00 GMT</pubDate>
  <link>https://www.goodreads.com/status/1</link>
</item></channel></rss>`
