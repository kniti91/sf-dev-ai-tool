import cors from 'cors'
import cookieParser from 'cookie-parser'
import express from 'express'
import helmet from 'helmet'
import { config } from './config.js'
import { errorHandler, notFoundHandler } from './lib/errors.js'
import { requestContext } from './middleware/request-context.js'
import { attachSession } from './middleware/auth.js'
import { PrismaOrgRepository } from './repositories/prisma-org-repository.js'
import type { VibeSafeRepository } from './repositories/vibesafe-repository.js'
import { createApiRouter } from './routes/api.js'
import { createAuthRouter } from './routes/auth.js'
import { createHealthRouter, type DatabaseHealthCheck } from './routes/health.js'
import type { AuthService } from './services/auth-service.js'
import { PrismaAuthService } from './services/prisma-auth-service.js'
import { checkDatabase, prisma } from './database/prisma.js'

export function createApp(
  repository: VibeSafeRepository = new PrismaOrgRepository(prisma),
  authService: AuthService = new PrismaAuthService(prisma),
  databaseHealthCheck: DatabaseHealthCheck = checkDatabase,
) {
  const app = express()

  app.disable('x-powered-by')
  app.use(helmet())
  app.use(cors({ origin: config.WEB_ORIGIN, credentials: true }))
  app.use(express.json({ limit: '1mb' }))
  app.use(cookieParser())
  app.use(requestContext)
  app.use(attachSession(authService))

  app.use('/health', createHealthRouter(databaseHealthCheck))
  app.use('/api/v1/auth', createAuthRouter(authService))
  app.use('/api/v1', createApiRouter(repository))

  app.use(notFoundHandler)
  app.use(errorHandler)
  return app
}
