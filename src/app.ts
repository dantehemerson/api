import cors from '@fastify/cors'
import fastify, { FastifyInstance, FastifyServerOptions } from 'fastify'
import mercurius from 'mercurius'
import helmet from '@fastify/helmet'
import { config } from './config'
import { Logger } from './logger'
import { createRoot, UsageDependencies } from './graphql/root.graphql'
import { CacheManager } from './graphql/cache-manager'
import { schema } from './graphql/schema'
import { UsageStore } from './usage/usage-store'

export class App {
  readonly app: FastifyInstance
  private readonly logger: Logger
  private readonly usage: UsageDependencies

  constructor(options: FastifyServerOptions = {}, usage: Partial<UsageDependencies> = {}) {
    this.app = fastify({ logger: true, ...options })
    this.logger = new Logger()
    this.usage = { ...usage, store: usage.store ?? new UsageStore(config.usage.dbPath) }

    this.setupHealth()
    this.setupMiddlewares()
    this.setupGraphQL()
  }

  private setupGraphQL() {
    const cache = new CacheManager()
    this.app.addHook('onClose', async () => {
      cache.close()
      this.usage.store.close()
    })
    this.app.register(mercurius, {
      schema,
      graphiql: true,
      resolvers: createRoot(cache, this.usage),
    })
  }

  private setupHealth() {
    this.app.get('/health', (_, response) => {
      response.send({
        status: 'ok',
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        timestamp: Date.now(),
      })
    })
  }

  private setupMiddlewares() {
    this.app.register(cors)
    this.app.register(helmet, {
      contentSecurityPolicy: false,
    })
  }

  async init() {
    try {
      await this.app.listen({
        port: config.port,
        host: '0.0.0.0',
      })
      const address = this.app.server.address()
      const port = typeof address === 'string' ? address : address?.port
      this.logger.info(`Go to http://localhost:${port}`)
    } catch (error) {
      this.app.log.error(error)
      throw error
    }
  }
}
