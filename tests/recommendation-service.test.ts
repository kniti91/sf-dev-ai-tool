import { describe, expect, it, vi } from 'vitest'
import type { Artifact, Finding, Recommendation, Scan } from '../src/domain/types.js'
import type { VibeSafeRepository } from '../src/repositories/vibesafe-repository.js'
import type { AiProvider } from '../src/services/ai-provider.js'
import { RecommendationService } from '../src/services/recommendation-service.js'

const artifact: Artifact = { id: 'artifact-1', orgConnectionId: 'org-1', salesforceMetadataId: '01p000000000001', name: 'AccountService', type: 'Apex Class', namespace: null, apiVersion: '61.0', modifiedAt: new Date().toISOString(), contentHash: '' }
const finding: Finding = { id: 'finding-1', scanId: 'scan-1', artifactId: artifact.id, ruleId: 'SOQL_IN_LOOP', ruleVersion: '1', severity: 'high', category: 'governor-limits', message: 'SOQL is executed in a loop.', evidence: 'Rule matched at line 4.', lineStart: 4, lineEnd: 4, engine: 'rules', confidence: 1, deterministic: true }
const scan: Scan = { id: 'scan-1', tenantId: 'tenant-1', requestedByUserId: 'user-1', orgConnectionId: 'org-1', name: 'Test', scope: 'selected', artifactIds: [artifact.id], requestSnapshot: {}, selectedCounts: {}, status: 'completed', progress: { completed: 1, total: 1 }, reusedArtifactCount: 0, ruleSetVersion: '1', scorePolicyVersion: '1', score: 70, overallSummary: null, createdAt: new Date().toISOString(), completedAt: new Date().toISOString() }

function harness(providerFailure = false) {
  const stored: Recommendation[] = []
  let sourceMap: Map<string, string> | undefined
  const repository = {
    getFinding: vi.fn(async () => finding), getScan: vi.fn(async () => scan), getArtifacts: vi.fn(async () => [{ ...artifact }]),
    listRecommendations: vi.fn(async () => stored),
    saveRecommendation: vi.fn(async (item: Recommendation) => { stored.push(item); return item }),
  } as unknown as VibeSafeRepository
  const sourceService = { loadArtifactSources: vi.fn(async (_org: string, _tenant: string, artifacts: Artifact[]) => { artifacts[0]!.contentHash = 'sha256:current'; sourceMap = new Map([[artifact.id, 'public class AccountService {}']]); return sourceMap }) }
  const provider: AiProvider = { name: 'test-ai', model: 'test-model', generateRecommendation: vi.fn(async () => {
    if (providerFailure) throw new Error('provider unavailable')
    return { summary: 'Bulkification is required.', recommendation: 'Move the query outside the loop.', proposedCode: null, confidence: 0.95 }
  }), generateResolution: vi.fn(async ({ findings }) => ({ summary: 'Selected issues resolved.', proposedCode: 'public class AccountService {}', resolvedFindingIds: findings.map(({ id }) => id), cautions: ['Run Apex tests before deployment.'], confidence: 0.9 })) } as AiProvider
  return { service: new RecommendationService(repository, sourceService, provider), provider, sourceService, stored, sourceMap: () => sourceMap }
}

describe('RecommendationService', () => {
  it('persists once and reuses a recommendation for the same source and finding', async () => {
    const test = harness()
    const first = await test.service.generate(finding.id, scan.tenantId)
    const second = await test.service.generate(finding.id, scan.tenantId)
    expect(first.reused).toBe(false)
    expect(second.reused).toBe(true)
    expect(test.provider.generateRecommendation).toHaveBeenCalledTimes(1)
    expect(test.stored).toHaveLength(1)
    expect(test.sourceMap()?.size).toBe(0)
  })

  it('clears transient source when the provider fails', async () => {
    const test = harness(true)
    await expect(test.service.generate(finding.id, scan.tenantId)).rejects.toThrow('provider unavailable')
    expect(test.sourceMap()?.size).toBe(0)
    expect(test.stored).toHaveLength(0)
  })

  it('generates one consolidated resolution and clears the transient source', async () => {
    const test = harness()
    const result = await test.service.resolveComponent(scan.id, artifact.id, [finding.id], scan.tenantId)
    expect(result.resolvedFindingIds).toEqual([finding.id])
    expect(result.proposedCode).toContain('AccountService')
    expect(test.provider.generateResolution).toHaveBeenCalledTimes(1)
    expect(test.sourceMap()?.size).toBe(0)
  })
})
