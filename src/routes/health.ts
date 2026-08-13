import { Router } from 'express'

export type DatabaseHealthCheck = () => Promise<void>

export function createHealthRouter(checkDatabase: DatabaseHealthCheck) {
  const router = Router()
  router.get('/', async (_request, response) => {
    try {
      await checkDatabase()
      response.json({ status: 'ok', service: 'vibesafe-api', version: '0.1.0', database: 'connected', timestamp: new Date().toISOString() })
    } catch {
      response.status(503).json({ status: 'degraded', service: 'vibesafe-api', version: '0.1.0', database: 'unavailable', timestamp: new Date().toISOString() })
    }
  })
  return router
}
