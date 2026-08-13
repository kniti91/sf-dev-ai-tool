import { createServer } from 'node:http'
import { createApp } from './app.js'
import { config } from './config.js'
import { disconnectDatabase } from './database/prisma.js'

const server = createServer(createApp())

server.listen(config.PORT, () => {
  console.log(JSON.stringify({ level: 'info', message: 'VibeSafe API started', url: `http://localhost:${config.PORT}`, environment: config.NODE_ENV }))
})

function shutdown(signal: string) {
  console.log(JSON.stringify({ level: 'info', message: 'VibeSafe API stopping', signal }))
  server.close(async (error) => {
    if (error) {
      console.error(error)
      process.exit(1)
    }
    await disconnectDatabase()
    process.exit(0)
  })
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
