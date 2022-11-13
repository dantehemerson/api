import NodeCache from 'node-cache'
import { Logger } from '../logger'

export class CacheManager {
  private cache: NodeCache
  private logger = new Logger('CacheManager')

  constructor() {
    this.cache = new NodeCache()
  }

  async cachedReponse(key: string, method: any, ttl: number) {
    if (this.cache.has(key)) {
      this.logger.info(`Cache hit for key ${key}, returning cached value`)

      return this.cache.get(key)
    }

    this.logger.info(`Cache miss for key ${key}, calling method and caching result`)

    const response = await method()

    this.logger.info(`Caching response for key ${key} with ttl ${ttl}`)
    this.cache.set(key, response, ttl)

    return response
  }
}
