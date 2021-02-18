import axios, { AxiosInstance } from 'axios'
import {parseStringPromise} from "xml2js"

export class GoodreadsApiService {
  private axiosInstance: AxiosInstance
  private readonly userId = '72837965-dante-calder-n'

  constructor() {
    this.axiosInstance = axios.create()
  }

  /**
   * from rssURL: https://www.goodreads.com/user_status/list/72837965-dante-calder-n?format=rss
   */
  async lastReading() {
    try {
      const response = await this.axiosInstance.get(
        `https://www.goodreads.com/user_status/list/${this.userId}?format=rss`,
      )

      const { rss } = await parseStringPromise(response.data, { explicitArray: false });

      return {
        ...this.parseStatus(rss.channel.item),
        profileUrl: `https://www.goodreads.com/user/show/${this.userId}`
      }
    } catch (error) {
      console.error(error)
      /** Return default status */
      return {
        title: 'Atomic Habits',
        updatedAt: new Date().toISOString(),
        url: 'https://www.goodreads.com/user/show/72837965-dante-calder-n',
        profileUrl: 'https://www.goodreads.com/user/show/72837965-dante-calder-n'
      }
    }
  }

  /**
   * regex: https://regex101.com/r/pSL8OQ/1
   */
  private parseStatus(items: { title: string, pubDate: string, link: string }[]) {
    const readingStatusItem = items.filter(statusItem => {
      return /(page\s\d+)|(is\s\d+\%)/.test(statusItem.title)
    })[0]

    return {
      title: readingStatusItem.title.replace('Dante Calderón is ', `I'm `),
      updatedAt: new Date(readingStatusItem.pubDate).toISOString(),
      url: readingStatusItem.link
    }
  }
}
