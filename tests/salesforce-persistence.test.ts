import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { createHash, randomUUID } from 'node:crypto'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { prisma, disconnectDatabase } from '../src/database/prisma.js'
import { PrismaOrgRepository } from '../src/repositories/prisma-org-repository.js'
import { PrismaAuthService } from '../src/services/prisma-auth-service.js'
import { SalesforceCredentialStore } from '../src/services/salesforce-credential-store.js'
import { SalesforceOAuthService } from '../src/services/salesforce-oauth-service.js'
import { ScanService } from '../src/services/scan-service.js'

const describeDatabase = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip
const email = `salesforce-persistence-${randomUUID()}@example.com`
const orgId = `00D${randomUUID().replaceAll('-', '').slice(0, 15)}`
let workspaceId = ''
let userId = ''
let connectionId = ''
const apexClassId = '01p000000000001AAA'
const triggerId = '01q000000000001AAA'
const bundleId = '0Rb000000000001AAA'

describeDatabase('Salesforce OAuth persistence', () => {
  afterEach(() => vi.unstubAllGlobals())

  afterAll(async () => {
    if (workspaceId) await prisma.workspace.deleteMany({ where: { id: workspaceId } })
    await prisma.user.deleteMany({ where: { email } })
    await disconnectDatabase()
  })

  it('completes OAuth after a service restart and stores encrypted tokens', async () => {
    const account = await new PrismaAuthService(prisma).signup(email, 'SecurePass123!', 'Salesforce Persistence User')
    workspaceId = account.tenantId
    userId = account.user.id
    const repository = new PrismaOrgRepository(prisma)

    const firstService = new SalesforceOAuthService(repository, prisma)
    const started = await firstService.start(workspaceId, userId, 'production')
    const stateRecord = await prisma.oAuthAuthorizationState.findUniqueOrThrow({ where: { stateHash: createHash('sha256').update(started.state).digest('hex') } })
    expect(stateRecord.pkceVerifier).toMatch(/^v1\./)
    expect(stateRecord.pkceVerifier).not.toContain(started.state)

    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/services/oauth2/token')) {
        return new Response(JSON.stringify({ access_token: 'test-access-token', refresh_token: 'test-refresh-token', instance_url: 'https://vibesafe-test.my.salesforce.com', id: 'https://login.salesforce.com/id/test', token_type: 'Bearer' }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url === 'https://login.salesforce.com/id/test') {
        return new Response(JSON.stringify({ organization_id: orgId, username: email, display_name: 'VibeSafe Test Org' }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      throw new Error(`Unexpected test request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const restartedService = new SalesforceOAuthService(repository, prisma)
    const connection = await restartedService.complete(started.state, 'test-code', workspaceId, userId)
    connectionId = connection.id
    expect(connection.salesforceOrgId).toBe(orgId)
    expect(await repository.getOrgConnection(connection.id, 'another-workspace')).toBeUndefined()

    const encrypted = await prisma.orgOAuthToken.findUniqueOrThrow({ where: { orgConnectionId: connection.id } })
    expect(encrypted.encryptedAccessToken).toMatch(/^v1\./)
    expect(encrypted.encryptedAccessToken).not.toContain('test-access-token')
    expect(encrypted.encryptedRefreshToken).not.toContain('test-refresh-token')

    const tokensAfterRestart = await new SalesforceCredentialStore(prisma).getTokens(connection.id)
    expect(tokensAfterRestart).toEqual({ accessToken: 'test-access-token', refreshToken: 'test-refresh-token' })
    await expect(restartedService.complete(started.state, 'test-code', workspaceId, userId)).rejects.toMatchObject({ code: 'OAUTH_STATE_INVALID' })
  })

  it('lists the persisted org from a fresh repository instance', async () => {
    const repository = new PrismaOrgRepository(prisma)
    const connections = await repository.listOrgConnections(workspaceId)
    expect(connections).toHaveLength(1)
    expect(connections[0]).toMatchObject({ salesforceOrgId: orgId, username: email, status: 'connected' })
  })

  it('persists refreshed access tokens while retaining the refresh token', async () => {
    await new SalesforceCredentialStore(prisma).saveTokens(connectionId, { accessToken: 'rotated-access-token' })
    const reloaded = await new SalesforceCredentialStore(prisma).getTokens(connectionId)
    expect(reloaded).toEqual({ accessToken: 'rotated-access-token', refreshToken: 'test-refresh-token' })
  })

  it('stores live component metadata and fingerprints without storing source', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      const soql = url.searchParams.get('q') ?? ''
      let records: unknown[] = []
      if (soql.includes('FROM ApexClass') && soql.includes('Name')) records = [{ Id: apexClassId, Name: 'AccountService', NamespacePrefix: null, ApiVersion: 67, LastModifiedDate: '2026-08-06T12:00:00.000Z' }]
      else if (soql.includes('FROM ApexTrigger') && soql.includes('Name')) records = [{ Id: triggerId, Name: 'AccountTrigger', NamespacePrefix: null, ApiVersion: 67, LastModifiedDate: '2026-08-06T12:00:00.000Z' }]
      else if (soql.includes('FROM LightningComponentBundle')) records = [{ Id: bundleId, DeveloperName: 'accountHealth', NamespacePrefix: null, ApiVersion: 67, LastModifiedDate: '2026-08-06T12:00:00.000Z' }]
      else if (soql.includes('FROM ApexClass')) records = [{ Id: apexClassId, Body: 'public class AccountService { public static void run() {} }' }]
      else if (soql.includes('FROM ApexTrigger')) records = [{ Id: triggerId, Body: 'trigger AccountTrigger on Account (before insert) {}' }]
      else if (soql.includes('FROM LightningComponentResource')) records = [{ LightningComponentBundleId: bundleId, FilePath: 'lwc/accountHealth/accountHealth.js', Source: 'export default class AccountHealth {}' }]
      return new Response(JSON.stringify({ records, done: true }), { status: 200, headers: { 'content-type': 'application/json' } })
    }))

    const repository = new PrismaOrgRepository(prisma)
    const service = new SalesforceOAuthService(repository, prisma)
    const components = await service.listComponents(connectionId, workspaceId)
    expect(components.map(({ name }) => name)).toEqual(['AccountService', 'AccountTrigger', 'accountHealth'])
    expect(await prisma.artifact.count({ where: { orgConnectionId: connectionId } })).toBe(3)

    const sources = await service.loadArtifactSources(connectionId, workspaceId, components)
    expect(sources.size).toBe(3)
    expect(await prisma.artifactVersion.count({ where: { artifact: { orgConnectionId: connectionId } } })).toBe(3)
    const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ArtifactVersion'`
    expect(columns.map(({ column_name }) => column_name)).not.toContain('sourceCode')
    sources.clear()

    await service.listComponents(connectionId, workspaceId)
    expect(await prisma.artifact.count({ where: { orgConnectionId: connectionId } })).toBe(3)
  })

  it('stores run history and reuses unchanged component results without source', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      const soql = url.searchParams.get('q') ?? ''
      let records: unknown[] = []
      if (soql.includes('FROM ApexClass')) records = [{ Id: apexClassId, Body: 'public without sharing class AccountService { public static void run() {} }' }]
      else if (soql.includes('FROM ApexTrigger')) records = [{ Id: triggerId, Body: 'trigger AccountTrigger on Account (before insert) {}' }]
      else if (soql.includes('FROM LightningComponentResource')) records = [{ LightningComponentBundleId: bundleId, FilePath: 'lwc/accountHealth/accountHealth.js', Source: 'console.log("health");' }]
      return new Response(JSON.stringify({ records, done: true }), { status: 200, headers: { 'content-type': 'application/json' } })
    }))
    const repository = new PrismaOrgRepository(prisma)
    const salesforce = new SalesforceOAuthService(repository, prisma)
    const scans = new ScanService(repository, (orgConnectionId, tenantId, artifacts) => salesforce.loadArtifactSources(orgConnectionId, tenantId, artifacts))
    const artifacts = await repository.listArtifacts(connectionId)

    const first = await scans.start({ tenantId: workspaceId, requestedByUserId: userId, orgConnectionId: connectionId, name: 'Initial selected review', scope: 'selected', artifactIds: artifacts.map(({ id }) => id) })
    const firstRun = await waitForCompletedRun(first.id)
    expect(firstRun.overallSummary).toContain('Analyzed 3 components')
    expect(firstRun.reusedArtifactCount).toBe(0)
    expect(JSON.stringify(firstRun.requestSnapshot)).not.toContain('without sharing')
    expect(await prisma.componentAnalysisResult.count({ where: { artifactVersion: { artifact: { orgConnectionId: connectionId } } } })).toBe(3)
    const persistedFindings = await prisma.finding.findMany({ where: { componentAnalysisResult: { artifactVersion: { artifact: { orgConnectionId: connectionId } } } } })
    expect(persistedFindings.length).toBeGreaterThan(0)
    expect(JSON.stringify(persistedFindings)).not.toContain('console.log("health")')
    expect(JSON.stringify(persistedFindings)).not.toContain('without sharing class')

    const second = await scans.start({ tenantId: workspaceId, requestedByUserId: userId, orgConnectionId: connectionId, name: 'Repeated selected review', scope: 'selected', artifactIds: artifacts.map(({ id }) => id) })
    const secondRun = await waitForCompletedRun(second.id)
    expect(secondRun.reusedArtifactCount).toBe(3)
    expect(await prisma.componentAnalysisResult.count({ where: { artifactVersion: { artifact: { orgConnectionId: connectionId } } } })).toBe(3)
    expect(await prisma.analysisRun.count({ where: { orgConnectionId: connectionId } })).toBe(2)
    expect(await repository.listFindings(second.id)).toHaveLength(persistedFindings.length)
  })

  it('deduplicates recommendations and restricts API access to the owning workspace', async () => {
    const repository = new PrismaOrgRepository(prisma)
    const finding = await prisma.finding.findFirstOrThrow({ where: { componentAnalysisResult: { artifactVersion: { artifact: { orgConnectionId: connectionId } } } } })
    const recommendation = {
      id: randomUUID(),
      findingId: finding.id,
      provider: 'test-provider',
      model: 'test-model',
      promptVersion: '1.0.0',
      content: 'Use sharing enforcement and verify access before executing the operation.',
      proposedCode: null,
      confidence: 0.9,
      inputHash: 'sha256:test-recommendation-input',
      createdAt: new Date().toISOString(),
    }
    const first = await repository.saveRecommendation(recommendation)
    const duplicate = await repository.saveRecommendation({ ...recommendation, id: randomUUID(), content: 'Duplicate retry content must not replace the original.' })
    expect(duplicate.id).toBe(first.id)
    expect(await prisma.recommendation.count({ where: { findingId: finding.id } })).toBe(1)

    const app = createApp(repository, new PrismaAuthService(prisma), async () => {})
    await request(app).get(`/api/v1/findings/${finding.id}/recommendations`).expect(404)
    const agent = request.agent(app)
    await agent.post('/api/v1/auth/login').send({ email, password: 'SecurePass123!' }).expect(200)
    const response = await agent.get(`/api/v1/findings/${finding.id}/recommendations`).expect(200)
    expect(response.body.data).toHaveLength(1)
    expect(response.body.data[0].content).toBe(recommendation.content)
  })
})

async function waitForCompletedRun(id: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const run = await prisma.analysisRun.findUniqueOrThrow({ where: { id } })
    if (run.status === 'COMPLETED') return run
    if (run.status === 'FAILED') throw new Error(`Analysis run ${id} failed.`)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Analysis run ${id} did not complete in time.`)
}
