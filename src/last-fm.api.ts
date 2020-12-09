import axios from 'axios'
import qs from 'querystring'
import { config } from './config'
import { Logger } from './logger'
import { LastSong } from './schema'

export class LastFMAPI {
  private readonly baseURL = 'http://ws.audioscrobbler.com/2.0'
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

  private buildURL(queryOptions: qs.ParsedUrlQuery): string {
    return `${this.baseURL}/?${qs.stringify({ ...queryOptions, api_key: config.lastFM.apiKey, format: 'json' })}`
  }

  async getSongListening(): Promise<LastSong | null> {
    try {
      const [getTrackResult, getScrobblesResult] = await Promise.all([
        axios.get(this.getTrackURL),
        axios.get(this.getScrobblesURL),
      ])

      const track = getTrackResult.data['recenttracks']['track']
      const scrobbles = getScrobblesResult.data['user']['playcount']
      console.log('Los scrobbles son', scrobbles, typeof scrobbles)
      const playing = track[0]['@attr'] !== undefined

      return {
        name: track[0]['name'],
        artist: track[0]['artist']['#text'],
        album: track[0]['album']['#text'],
        url: track[0]['url'],
        image: track[0]['image'][3]['#text'],
        playing,
        scrobbles,
      }
    } catch (error) {
      this.logger.error('Error on get data', error)
      return null
    }
  }
}
