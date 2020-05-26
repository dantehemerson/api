import winston from 'winston'

export class Logger {
  private logger: winston.Logger

  constructor() {
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.json(),
      transports: [new winston.transports.Console({ level: 'info' })]
    })
  }

  info(message: string) {
    this.logger.info(message)
  }

  error(message: string) {
    this.logger.error(message)
  }

  warn(message: string) {
    this.logger.warn(message)
  }
}
