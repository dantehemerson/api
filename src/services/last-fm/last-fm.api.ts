import axios from 'axios'
import { config } from '../../config'
import { Logger } from '../../logger'
import { LastSong } from '../../graphql/schema'

export class LastFMApiService {
  private readonly baseURL = 'https://ws.audioscrobbler.com/2.0/'
  private readonly logger: Logger
  private readonly getTrackURL: string
  private readonly getScrobblesURL: string

  constructor() {
    this.logger = new Logger('LastFM API')

    this.getTrackURL = this.buildURL({
      method: 'user.getrecenttracks',
      user: config.lastFM.username,
    })

    this.getScrobblesURL = this.buildURL({
      method: 'user.getinfo',
      user: config.lastFM.username,
    })
  }

  private buildURL(queryOptions: Record<string, string | undefined>): string {
    const url = new URL(this.baseURL)
    for (const [key, value] of Object.entries({
      ...queryOptions,
      api_key: config.lastFM.apiKey,
      format: 'json',
    })) {
      url.searchParams.set(key, value ?? '')
    }
    return url.href
  }

  async getSongListening(): Promise<LastSong | null> {
    try {
      const [getTrackResult, getScrobblesResult] = await Promise.all([
        axios.get(this.getTrackURL, { timeout: 10_000 }),
        axios.get(this.getScrobblesURL, { timeout: 10_000 }),
      ])

      const tracks = getTrackResult.data.recenttracks?.track
      const track = Array.isArray(tracks) ? tracks[0] : tracks
      if (!track) return null
      const scrobbles = getScrobblesResult.data['user']['playcount']
      const playing = track['@attr']?.nowplaying === 'true'
      const timestamp = Number.parseInt(track.date?.uts, 10) * 1000
      const lastPlayingDate = new Date(Number.isFinite(timestamp) ? timestamp : Date.now())

      return {
        name: track.name,
        artist: track.artist['#text'],
        album: track.album['#text'],
        url: track.url,
        image: track.image?.[3]?.['#text'] ?? '',
        playing,
        scrobbles,
        lastPlayingDate: lastPlayingDate.toISOString(),
      }
    } catch (error) {
      this.logger.error('Error on get data', error)
      return null
    }
  }
}
