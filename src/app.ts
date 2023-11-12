import cors from '@fastify/cors'
import fastify, { FastifyInstance } from 'fastify'
import mercurius from 'mercurius'
import helmet from '@fastify/helmet'
import { config } from './config'
import { Logger } from './logger'
import { root } from './graphql/root.graphql'
import { schema } from './graphql/schema'

export class App {
  private readonly app: FastifyInstance
  private readonly logger: Logger

  constructor() {
    this.app = fastify({ logger: true })
    this.logger = new Logger()

    this.setupHealth()
    this.setupMiddlewares()
    this.setupGraphQL()
  }

  private setupGraphQL() {
    this.app.register(mercurius, {
      schema,
      graphiql: true,
      resolvers: root as any,
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
        host: '0.0.0.0'
      });
      const address = this.app.server.address()
      const port = typeof address === 'string' ? address : address?.port
      this.logger.info(`Go to http://localhost:${port}`)
    } catch (error) {
      this.app.log.error(error)
      process.exit(1)
    }
  }
}
