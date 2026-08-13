import request from 'supertest'
import { afterAll, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { prisma, disconnectDatabase } from '../src/database/prisma.js'
import { MemoryVibeSafeRepository } from '../src/repositories/memory-repository.js'
import { PrismaAuthService } from '../src/services/prisma-auth-service.js'

const describeDatabase = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip
const email = `persistent-${crypto.randomUUID()}@example.com`
const authService = new PrismaAuthService(prisma)
const app = createApp(new MemoryVibeSafeRepository(), authService, async () => { await prisma.$queryRaw`SELECT 1` })

describeDatabase('PostgreSQL authentication', () => {
  afterAll(async () => {
    const user = await prisma.user.findUnique({ where: { email }, select: { memberships: { select: { workspaceId: true } } } })
    await prisma.user.deleteMany({ where: { email } })
    if (user?.memberships.length) await prisma.workspace.deleteMany({ where: { id: { in: user.memberships.map(({ workspaceId }) => workspaceId) } } })
    await disconnectDatabase()
  })

  it('restores a session from PostgreSQL in a new app instance', async () => {
    const signup = await request(app).post('/api/v1/auth/signup').send({ displayName: 'Persistent User', email, password: 'SecurePass123!' }).expect(201)
    const cookie = signup.headers['set-cookie']?.[0]
    expect(cookie).toBeTruthy()

    const restartedApp = createApp(new MemoryVibeSafeRepository(), new PrismaAuthService(prisma), async () => {})
    const session = await request(restartedApp).get('/api/v1/auth/session').set('Cookie', cookie!).expect(200)
    expect(session.body.data.user.email).toBe(email)
    expect(session.body.data.tenant.id).toBeTruthy()
  })

  it('logs in with the persisted password hash and revokes logout sessions', async () => {
    const agent = request.agent(app)
    await agent.post('/api/v1/auth/login').send({ email, password: 'SecurePass123!' }).expect(200)
    await agent.post('/api/v1/auth/logout').expect(204)
    expect(await prisma.session.count({ where: { user: { email } } })).toBe(1)
  })
})
