import axios, { AxiosInstance, AxiosRequestConfig } from 'axios'

export class GoodreadsApiService {
  private axiosInstance: AxiosInstance

  constructor() {
    this.axiosInstance = axios.create()
  }

  /**
   * from rssURL: https://www.goodreads.com/user_status/list/72837965-dante-calder-n?format=rss
   */
  async lastReading() {
    try {
      const response = await this.axiosInstance.get(
        `https://api.rss2json.com/v1/api.json?rss_url=https%3A%2F%2Fwww.goodreads.com%2Fuser_status%2Flist%2F72837965-dante-calder-n%3Fformat%3Drss`,
      )

      return this.parseStatus(response.data.items)
    } catch (error) {
      console.error(error)
      /** Return default status */
      return {
        title: 'Atomic Habits',
        updatedAt: new Date().toISOString(),
        url: 'https://www.goodreads.com/user/show/72837965-dante-calder-n'
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
