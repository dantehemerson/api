import { App } from './app'

const app = new App()

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.app.close().catch(error => {
      app.app.log.error(error)
      process.exitCode = 1
    })
  })
}

app.init().catch(() => {
  process.exitCode = 1
})
