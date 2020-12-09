import winston from 'winston'

export class Logger {
  private logger: winston.Logger

  constructor(private readonly context: string = '') {
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.json(),
      transports: [new winston.transports.Console({ level: 'info' })],
    })
  }

  info(message: string) {
    this.logger.info(`[${this.context}] > ${message}`)
  }

  error(message: string, trace?: any) {
    this.logger.error(`[${this.context}] > ${message}`, trace)
  }

  warn(message: string) {
    this.logger.warn(`[${this.context}] > ${message}`)
  }
}
