import { describe, expect, it, vi } from 'vitest'
import type { Artifact, Finding, Scan } from '../src/domain/types.js'
import type { VibeSafeRepository } from '../src/repositories/vibesafe-repository.js'
import type { BatchDeterministicAnalyzer, DeterministicViolation } from '../src/services/code-analyzer-service.js'
import { RemediationOrchestrator } from '../src/services/remediation-orchestrator.js'

const artifact: Artifact = { id: 'artifact-1', orgConnectionId: 'org-1', salesforceMetadataId: '01p000000000001', name: 'Example', type: 'Apex Class', namespace: null, apiVersion: '61.0', modifiedAt: new Date().toISOString(), contentHash: '' }
const finding: Finding = { id: 'finding-1', scanId: 'scan-1', artifactId: artifact.id, ruleId: 'RULE-1', ruleVersion: '1', severity: 'low', category: 'maintainability', message: 'Remove debug output.', evidence: 'Static analyzer result.', lineStart: 2, lineEnd: 2, engine: 'test', confidence: 1, deterministic: true }
const scan: Scan = { id: 'scan-1', tenantId: 'tenant-1', requestedByUserId: 'user-1', orgConnectionId: artifact.orgConnectionId, name: 'Test', scope: 'selected', artifactIds: [artifact.id], requestSnapshot: {}, selectedCounts: {}, status: 'completed', progress: { completed: 1, total: 1 }, reusedArtifactCount: 0, ruleSetVersion: '1', scorePolicyVersion: '1', score: 99, overallSummary: null, createdAt: new Date().toISOString(), completedAt: new Date().toISOString() }

describe('RemediationOrchestrator', () => {
  it('gates deployment on verified code and clears transient source', async () => {
    const baselineSource = 'public class Example { void run() { System.debug(1); } }'
    const candidateSource = 'public class Example { void run() {} }'
    const sourceMap = new Map([[artifact.id, baselineSource]])
    const repository = { getScan: vi.fn(async () => scan), getArtifacts: vi.fn(async () => [artifact]), getFinding: vi.fn(async () => finding) } as unknown as VibeSafeRepository
    const violation: DeterministicViolation = { ruleId: finding.ruleId, ruleVersion: '1', severity: 'low', category: finding.category, message: finding.message, evidence: finding.evidence, lineStart: 1, lineEnd: 1, engine: 'test', confidence: 1 }
    const analyzer: BatchDeterministicAnalyzer = {
      analyze: vi.fn(async () => []),
      analyzeBatch: vi.fn(async (artifacts) => new Map(artifacts.map((item) => [item.id, item.id.endsWith(':baseline') ? [violation] : []]))),
    }
    const salesforce = { loadArtifactSources: vi.fn(async () => sourceMap), validateArtifactSource: vi.fn(async () => ({ valid: true, errors: [] })) }
    const service = new RemediationOrchestrator(repository, salesforce, analyzer)
    const hash = (await import('node:crypto')).createHash('sha256').update(baselineSource).digest('hex')
    const result = await service.verify(scan.id, artifact.id, [finding.id], candidateSource, hash, scan.tenantId)
    expect(result.eligible).toBe(true)
    expect(result.scoreDelta).toBe(1)
    expect(result.targetedResolved).toHaveLength(1)
    expect(result.verificationToken).toBeTruthy()
    expect(sourceMap.size).toBe(0)
    expect(() => service.assertDeploymentToken(result.verificationToken!, artifact.id, candidateSource, hash)).not.toThrow()
    expect(() => service.assertDeploymentToken(result.verificationToken!, artifact.id, `${candidateSource}\n`, hash)).toThrow('code changed after verification')
  })
})
