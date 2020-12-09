import cors from 'fastify-cors'
import  fastify, { FastifyInstance } from 'fastify'
import mercurius from 'mercurius'
import helmet from 'fastify-helmet'
import { config } from './config'
import { Logger } from './logger'
import { root } from './root.graphql'
import { schema } from './schema'

export class App {
  private readonly app: FastifyInstance
  private readonly logger: Logger

  constructor() {
    this.app = fastify({ logger: true})
    this.logger = new Logger()

    this.setupMiddlewares()
    this.setupGraphQL()
  }

  private setupGraphQL() {
    this.app.register(
      mercurius, 
      {
        schema,
        graphiql: true,
        resolvers: root as any
      })
  }

  private setupMiddlewares() {
    this.app.register(cors)
    this.app.register(helmet)
  }

  init() {
    this.app.listen(config.port, () => {
      this.logger.info(`Go to http://localhost:${config.port}`)
    })
  }
}
