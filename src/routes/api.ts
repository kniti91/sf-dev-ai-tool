import { Router } from 'express'
import { z } from 'zod'
import { ApiError } from '../lib/errors.js'
import type { VibeSafeRepository } from '../repositories/vibesafe-repository.js'
import { ScanService } from '../services/scan-service.js'
import { requireAuth } from '../middleware/auth.js'
import { SalesforceOAuthService } from '../services/salesforce-oauth-service.js'
import { config } from '../config.js'
import { createConfiguredAiProvider, type AiProvider } from '../services/ai-provider.js'
import { RecommendationService } from '../services/recommendation-service.js'
import { SalesforceCodeAnalyzer } from '../services/code-analyzer-service.js'
import { RemediationOrchestrator } from '../services/remediation-orchestrator.js'

const scanInput = z.object({
  orgConnectionId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  scope: z.enum(['selected', 'supported']),
  artifactIds: z.array(z.string().min(1)).max(5_000).optional(),
})

const artifactQuery = z.object({ search: z.string().optional(), type: z.enum(['Apex Class', 'Trigger', 'LWC']).optional() })
const metadataQuery = z.object({ search: z.string().optional(), type: z.enum(['Object', 'Field', 'Flow', 'Validation Rule', 'Profile', 'Permission Set', 'Sharing Setting']).optional(), active: z.enum(['true', 'false']).optional() })
const discoverBody = z.object({ componentTypes: z.array(z.enum(['Apex Class', 'Trigger', 'LWC', 'Object', 'Field', 'Flow', 'Validation Rule', 'Profile', 'Permission Set', 'Sharing Setting'])).min(1).optional() })
const sourceContextQuery = z.object({ findingId: z.string().min(1), radius: z.coerce.number().int().min(1).max(10).default(3) })
const componentResolutionInput = z.object({ findingIds: z.array(z.string().min(1)).min(1).max(25).refine((ids) => new Set(ids).size === ids.length, 'Finding IDs must be unique.') })
const candidateVerificationInput = componentResolutionInput.extend({ source: z.string().min(1).max(500_000), expectedSourceHash: z.string().regex(/^[a-f0-9]{64}$/) })
const componentDeployInput = z.object({ source: z.string().min(1).max(500_000), expectedSourceHash: z.string().regex(/^[a-f0-9]{64}$/), verificationToken: z.string().min(1), confirmation: z.literal('DEPLOY') })

export function createApiRouter(repository: VibeSafeRepository, aiProvider: AiProvider | undefined = createConfiguredAiProvider()) {
  const router = Router()
  const salesforceOAuth = new SalesforceOAuthService(repository)
  const codeAnalyzer = new SalesforceCodeAnalyzer()
  const scanService = new ScanService(repository, (orgConnectionId, tenantId, artifacts) => salesforceOAuth.loadArtifactSources(orgConnectionId, tenantId, artifacts), aiProvider, codeAnalyzer)
  const recommendationService = new RecommendationService(repository, salesforceOAuth, aiProvider)
  const remediationOrchestrator = new RemediationOrchestrator(repository, salesforceOAuth, codeAnalyzer, aiProvider)

  router.use(requireAuth)

  router.get('/org-connections', async (request, response) => response.json({ data: await repository.listOrgConnections(request.tenantId!) }))
  router.get('/org-connections/connector', (_request, response) => {
    const packageVersionId = config.SALESFORCE_CONNECTOR_PACKAGE_VERSION_ID
    response.json({ data: {
      available: Boolean(packageVersionId),
      packageVersionId: packageVersionId ?? null,
      productionInstallUrl: packageVersionId ? `https://login.salesforce.com/packaging/installPackage.apexp?p0=${packageVersionId}` : null,
      sandboxInstallUrl: packageVersionId ? `https://test.salesforce.com/packaging/installPackage.apexp?p0=${packageVersionId}` : null,
    } })
  })
  router.post('/org-connections/oauth/start', async (request, response) => {
    const { environment } = z.object({ environment: z.enum(['production', 'sandbox']) }).parse(request.body)
    response.json({ data: await salesforceOAuth.start(request.tenantId!, request.userId!, environment) })
  })
  router.get('/org-connections/oauth/callback', async (request, response) => {
    const query = z.object({ code: z.string().optional(), state: z.string().optional(), error: z.string().optional(), error_description: z.string().optional() }).parse(request.query)
    if (query.error || !query.code || !query.state) { response.redirect(`${config.WEB_ORIGIN}/salesforce/callback?error=${encodeURIComponent(query.error_description || query.error || 'Salesforce authorization was not completed.')}`); return }
    try { const connection = await salesforceOAuth.complete(query.state, query.code, request.tenantId!, request.userId!); response.redirect(`${config.WEB_ORIGIN}/salesforce/callback?connected=${encodeURIComponent(connection.id)}`) }
    catch (error) { const message = error instanceof Error ? error.message : 'Salesforce connection failed.'; response.redirect(`${config.WEB_ORIGIN}/salesforce/callback?error=${encodeURIComponent(message)}`) }
  })
  router.get('/org-connections/:id', async (request, response) => {
    const org = await repository.getOrgConnection(request.params.id!, request.tenantId!)
    if (!org) throw new ApiError(404, 'ORG_CONNECTION_NOT_FOUND', 'The Salesforce organization connection was not found.')
    response.json({ data: org })
  })
  router.post('/org-connections/:id/discover', async (request, response) => {
    const org = await repository.getOrgConnection(request.params.id!, request.tenantId!)
    if (!org) throw new ApiError(404, 'ORG_CONNECTION_NOT_FOUND', 'The Salesforce organization connection was not found.')
    const input = discoverBody.parse(request.body ?? {})
    response.json({ data: await salesforceOAuth.discover(org.id, request.tenantId!, input.componentTypes) })
  })
  router.get('/org-connections/:id/artifacts', async (request, response) => {
    if (!await repository.getOrgConnection(request.params.id!, request.tenantId!)) throw new ApiError(404, 'ORG_CONNECTION_NOT_FOUND', 'The Salesforce organization connection was not found.')
    const query = artifactQuery.parse(request.query)
    let data = await repository.listArtifacts(request.params.id!)
    if (query.type) data = data.filter(({ type }) => type === query.type)
    if (query.search) data = data.filter(({ name }) => name.toLowerCase().includes(query.search!.toLowerCase()))
    response.json({ data, pagination: { total: data.length, limit: data.length, offset: 0 } })
  })
  router.get('/org-connections/:id/metadata-components', async (request, response) => {
    if (!await repository.getOrgConnection(request.params.id!, request.tenantId!)) throw new ApiError(404, 'ORG_CONNECTION_NOT_FOUND', 'The Salesforce organization connection was not found.')
    const query = metadataQuery.parse(request.query)
    let data = await repository.listMetadataComponents(request.params.id!, query.type)
    if (query.search) data = data.filter(({ name, label }) => `${name} ${label ?? ''}`.toLowerCase().includes(query.search!.toLowerCase()))
    if (query.active) data = data.filter(({ active }) => active === (query.active === 'true'))
    response.json({ data, pagination: { total: data.length, limit: data.length, offset: 0 } })
  })
  router.delete('/org-connections/:id', async (request, response) => { await salesforceOAuth.disconnect(request.params.id!, request.tenantId!); response.status(204).send() })

  router.get('/scans', async (request, response) => {
    const orgConnectionId = typeof request.query.orgConnectionId === 'string' ? request.query.orgConnectionId : undefined
    response.json({ data: await repository.listScans(request.tenantId!, orgConnectionId) })
  })
  router.post('/scans', async (request, response) => response.status(202).json({ data: await scanService.start({ ...scanInput.parse(request.body), tenantId: request.tenantId!, requestedByUserId: request.userId! }) }))
  router.get('/scans/:id', async (request, response) => {
    const scan = await repository.getScan(request.params.id!, request.tenantId!)
    if (!scan) throw new ApiError(404, 'SCAN_NOT_FOUND', 'The scan was not found.')
    response.json({ data: scan })
  })
  router.get('/scans/:id/items', async (request, response) => {
    if (!await repository.getScan(request.params.id!, request.tenantId!)) throw new ApiError(404, 'SCAN_NOT_FOUND', 'The scan was not found.')
    response.json({ data: await repository.listScanItems(request.params.id!) })
  })
  router.get('/scans/:id/items/:artifactId/source-context', async (request, response) => {
    const scan = await repository.getScan(request.params.id!, request.tenantId!)
    if (!scan) throw new ApiError(404, 'SCAN_NOT_FOUND', 'The scan was not found.')
    const query = sourceContextQuery.parse(request.query)
    const finding = await repository.getFinding(query.findingId)
    if (!finding || finding.scanId !== scan.id || finding.artifactId !== request.params.artifactId) throw new ApiError(404, 'FINDING_NOT_FOUND', 'The finding was not found for this component.')
    const [artifact] = await repository.getArtifacts([request.params.artifactId!])
    if (!artifact || artifact.orgConnectionId !== scan.orgConnectionId) throw new ApiError(404, 'ARTIFACT_NOT_FOUND', 'The component was not found.')
    const sources = await salesforceOAuth.loadArtifactSources(scan.orgConnectionId, request.tenantId!, [artifact])
    try {
      const source = sources.get(artifact.id)
      if (!source) throw new ApiError(409, 'SALESFORCE_SOURCE_NOT_FOUND', 'The component source could not be retrieved.')
      const lines = source.split(/\r?\n/)
      const target = Math.max(1, finding.lineStart || 1)
      const startLine = Math.max(1, target - query.radius)
      const endLine = Math.min(lines.length, Math.max(target, finding.lineEnd || target) + query.radius)
      response.json({ data: { artifactId: artifact.id, findingId: finding.id, startLine, endLine, targetStartLine: target, targetEndLine: finding.lineEnd || target, lines: lines.slice(startLine - 1, endLine).map((content, index) => ({ number: startLine + index, content })) } })
    } finally { sources.clear() }
  })
  router.post('/scans/:id/cancel', async (request, response) => response.json({ data: await scanService.cancel(request.params.id!, request.tenantId!) }))
  router.get('/scans/:id/findings', async (request, response) => {
    if (!await repository.getScan(request.params.id!, request.tenantId!)) throw new ApiError(404, 'SCAN_NOT_FOUND', 'The scan was not found.')
    response.json({ data: await repository.listFindings(request.params.id!) })
  })
  router.post('/scans/:id/items/:artifactId/resolution', async (request, response) => {
    const { findingIds } = componentResolutionInput.parse(request.body)
    response.status(201).json({ data: await recommendationService.resolveComponent(request.params.id!, request.params.artifactId!, findingIds, request.tenantId!) })
  })
  router.post('/scans/:id/items/:artifactId/verify-candidate', async (request, response) => {
    const input = candidateVerificationInput.parse(request.body)
    response.json({ data: await remediationOrchestrator.verify(request.params.id!, request.params.artifactId!, input.findingIds, input.source, input.expectedSourceHash, request.tenantId!) })
  })
  router.post('/scans/:id/items/:artifactId/deploy', async (request, response) => {
    const scan = await repository.getScan(request.params.id!, request.tenantId!)
    if (!scan) throw new ApiError(404, 'SCAN_NOT_FOUND', 'The scan was not found.')
    const [artifact] = await repository.getArtifacts([request.params.artifactId!])
    if (!artifact || artifact.orgConnectionId !== scan.orgConnectionId || !scan.artifactIds.includes(artifact.id)) throw new ApiError(404, 'ARTIFACT_NOT_FOUND', 'The component was not found in this analysis.')
    const input = componentDeployInput.parse(request.body)
    remediationOrchestrator.assertDeploymentToken(input.verificationToken, artifact.id, input.source, input.expectedSourceHash)
    response.json({ data: await salesforceOAuth.deployArtifactSource(scan.orgConnectionId, request.tenantId!, artifact, input.source, input.expectedSourceHash) })
  })
  router.get('/findings', async (request, response) => { const scanIds = new Set((await repository.listScans(request.tenantId!)).map(({ id }) => id)); response.json({ data: (await repository.listFindings()).filter(({ scanId }) => scanIds.has(scanId)) }) })
  router.get('/findings/:id', async (request, response) => {
    const finding = await repository.getFinding(request.params.id!)
    if (!finding || !await repository.getScan(finding.scanId, request.tenantId!)) throw new ApiError(404, 'FINDING_NOT_FOUND', 'The finding was not found.')
    response.json({ data: finding })
  })
  router.get('/findings/:id/recommendations', async (request, response) => {
    const finding = await repository.getFinding(request.params.id!)
    if (!finding || !await repository.getScan(finding.scanId, request.tenantId!)) throw new ApiError(404, 'FINDING_NOT_FOUND', 'The finding was not found.')
    response.json({ data: await repository.listRecommendations(finding.id) })
  })
  router.post('/findings/:id/explanation', async (request, response) => {
    const result = await recommendationService.generate(request.params.id!, request.tenantId!)
    response.status(result.reused ? 200 : 201).json({ data: result.recommendation, meta: { reused: result.reused } })
  })

  return router
}
