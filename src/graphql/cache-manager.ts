import NodeCache from 'node-cache'
import { Logger } from '../logger'

export class CacheManager {
  private cache: NodeCache
  private logger = new Logger('CacheManager')

  constructor() {
    this.cache = new NodeCache()
  }

  close() {
    this.cache.close()
  }

  invalidate(key: string): void {
    this.logger.info(`Invalidating cache for key ${key}`)
    this.cache.del(key)
  }

  async cachedResponse<T>(key: string, method: () => Promise<T>, ttl: number): Promise<T> {
    const cached = this.cache.get<T>(key)
    if (cached !== undefined) {
      this.logger.info(`Cache hit for key ${key}, returning cached value`)

      return cached
    }

    this.logger.info(`Cache miss for key ${key}, calling method and caching result`)

    const response = await method()

    this.logger.info(`Caching response for key ${key} with ttl ${ttl}`)
    this.cache.set(key, response, ttl)

    return response
  }
}
