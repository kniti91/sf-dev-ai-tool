import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { MemoryVibeSafeRepository } from '../src/repositories/memory-repository.js'
import { ScanService } from '../src/services/scan-service.js'
import { MemoryAuthService } from '../src/services/auth-service.js'

const app = createApp(new MemoryVibeSafeRepository(), new MemoryAuthService(), async () => {})

async function authenticatedAgent() {
  const agent = request.agent(app)
  await agent.post('/api/v1/auth/signup').send({ displayName: 'Test Architect', email: `test-${crypto.randomUUID()}@example.com`, password: 'SecurePass123!' }).expect(201)
  return agent
}

describe('VibeSafe API', () => {
  it('reports service health', async () => {
    const response = await request(app).get('/health').expect(200)
    expect(response.body.status).toBe('ok')
    expect(response.headers['x-correlation-id']).toBeTruthy()
  })

  it('prevents a new tenant from reading another tenant org', async () => {
    const agent = await authenticatedAgent()
    const response = await agent.get('/api/v1/org-connections/org_acme_prod/artifacts?type=Trigger').expect(404)
    expect(response.body.error.code).toBe('ORG_CONNECTION_NOT_FOUND')
  })

  it('starts a selected scan within the owning tenant', async () => {
    const service = new ScanService(new MemoryVibeSafeRepository())
    const scan = await service.start({ tenantId: 'tenant_demo', requestedByUserId: 'user_demo', orgConnectionId: 'org_acme_prod', name: 'API integration test', scope: 'selected', artifactIds: ['artifact_account_trigger'] })
    expect(scan.status).toBe('queued')
    expect(scan.progress.total).toBe(1)
  })

  it('returns a stable validation error envelope', async () => {
    const agent = await authenticatedAgent()
    const response = await agent.post('/api/v1/scans').send({ name: '' }).expect(400)
    expect(response.body.error.code).toBe('VALIDATION_ERROR')
    expect(response.body.error.correlationId).toBeTruthy()
  })

  it('does not expose stack traces for unknown routes', async () => {
    const agent = await authenticatedAgent()
    const response = await agent.get('/api/v1/not-real').expect(404)
    expect(response.body.error.code).toBe('ROUTE_NOT_FOUND')
    expect(response.body.error.stack).toBeUndefined()
  })
})
