import cors from 'cors'
import express, { Application } from 'express'
import graphqlHTTP from 'express-graphql'
import { config } from './config'
import { Logger } from './logger'
import { root } from './root.graphql'
import { schema } from './schema'

export class App {
  private readonly app: Application
  private readonly logger: Logger

  constructor() {
    this.app = express()
    this.logger = new Logger()

    this.setupMiddlewares()
    this.setupGraphQL()
  }

  private setupGraphQL() {
    this.app.use(
      '/graphql',
      graphqlHTTP({
        schema,
        rootValue: root,
        graphiql: true
      })
    )
  }

  private setupMiddlewares() {
    this.app.use(cors())
  }

  init() {
    this.app.listen(config.port, () => {
      this.logger.info(`Go to http://localhost:${config.port}`)
    })
  }
}
