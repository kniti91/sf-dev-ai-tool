import { describe, expect, it, vi } from 'vitest'
import type { AiProvider } from '../src/services/ai-provider.js'
import { AnalysisService } from '../src/services/analysis-service.js'
import type { Artifact } from '../src/domain/types.js'
import { MemoryVibeSafeRepository } from '../src/repositories/memory-repository.js'
import { ScanService } from '../src/services/scan-service.js'
import { normalizeAnalyzerOutput, type DeterministicAnalyzer } from '../src/services/code-analyzer-service.js'

const artifact: Artifact = { id: 'artifact-1', orgConnectionId: 'org-1', salesforceMetadataId: '01p000000000001', name: 'AccountService', type: 'Apex Class', namespace: null, apiVersion: '67.0', modifiedAt: new Date().toISOString(), contentHash: 'sha256:test' }

describe('component AI analysis', () => {
  it('normalizes Salesforce Code Analyzer output without inventing a DML-in-loop finding', () => {
    const location = (startLine: number) => [{ file: 'OrderEventTrigger.trigger', startLine, endLine: startLine }]
    const findings = normalizeAnalyzerOutput({ versions: { 'code-analyzer': '0.52.0' }, violations: [
      { rule: 'AvoidLogicInTrigger', engine: 'pmd', severity: 3, tags: ['Recommended', 'BestPractices', 'Apex'], primaryLocationIndex: 0, locations: location(1), message: 'Avoid logic in triggers' },
      { rule: 'AvoidDebugStatements', engine: 'pmd', severity: 4, tags: ['Recommended', 'Performance', 'Apex'], primaryLocationIndex: 0, locations: location(2), message: 'Avoid debug statements' },
      { rule: 'DebugsShouldUseLoggingLevel', engine: 'pmd', severity: 4, tags: ['Recommended', 'BestPractices', 'Apex'], primaryLocationIndex: 0, locations: location(2), message: 'Specify a logging level' },
      { rule: 'OperationWithLimitsInLoop', engine: 'pmd', severity: 2, tags: ['Recommended', 'Performance', 'Apex'], primaryLocationIndex: 0, locations: location(8), message: 'Operation can consume limits in a loop' },
    ] })
    expect(findings.map(({ ruleId }) => ruleId)).toEqual(['SFCA-PMD-AvoidLogicInTrigger', 'SFCA-PMD-AvoidDebugStatements', 'SFCA-PMD-OperationWithLimitsInLoop'])
    expect(findings.at(-1)?.category).toBe('governor_limits')
    expect(findings.some(({ ruleId }) => ruleId.includes('DML'))).toBe(false)
  })

  it('merges AI context with deterministic findings without retaining source', async () => {
    const provider: AiProvider = {
      name: 'test-ai', model: 'test-model', generateRecommendation: vi.fn(),
      analyzeComponent: vi.fn(async () => ({
        summary: 'The component needs bulkification and access checks.', score: 62,
        categoryScores: { security: 70, governor_limits: 40, performance: 65, maintainability: 75, reliability: 80, testability: 55 },
        requiresHumanReview: true,
        findings: [
          { issueType: 'soql-loop', severity: 'critical', category: 'governor_limits', title: 'Query occurs in iteration', evidence: 'A query is performed near line 3.', recommendation: 'Bulkify the query.', lineStart: 3, lineEnd: 3, confidence: 0.9, proposedCode: null, requiresHumanReview: true },
          { issueType: 'crud-check', severity: 'high', category: 'security', title: 'CRUD access is not verified', evidence: 'The update path lacks an explicit access check.', recommendation: 'Verify update access before DML.', lineStart: 4, lineEnd: 4, confidence: 0.87, proposedCode: null, requiresHumanReview: true },
        ],
      })),
    }
    const source = 'public class AccountService { void run(List<Account> rows) { for(Account a : rows) { List<Contact> c = [SELECT Id FROM Contact]; } update rows; } }'
    const analyzer: DeterministicAnalyzer = { analyze: vi.fn(async () => [{ ruleId: 'SFCA-PMD-OperationWithLimitsInLoop', ruleVersion: '5', severity: 'critical', category: 'governor_limits', message: 'A query occurs in an iterative block.', evidence: 'Reported by Salesforce Code Analyzer.', lineStart: 3, lineEnd: 3, engine: 'salesforce-code-analyzer:pmd', confidence: 1 }]) }
    const result = await new AnalysisService(provider, analyzer).analyzeComponent('scan-1', artifact, source)
    expect(result.findings.some(({ deterministic }) => deterministic)).toBe(true)
    expect(result.findings.some(({ deterministic }) => !deterministic)).toBe(true)
    expect(result.findings.filter(({ category, deterministic }) => category === 'governor_limits' && !deterministic)).toHaveLength(0)
    expect(result.findings.filter(({ category, deterministic }) => category === 'governor_limits' && deterministic)).toHaveLength(1)
    expect(result.analysis.aiScore).toBe(62)
    expect(result.analysis.combinedScore).toBeLessThan(100)
    expect(JSON.stringify(result)).not.toContain(source)
  })

  it('works deterministically when no AI provider is configured', async () => {
    const result = await new AnalysisService().analyzeComponent('scan-1', artifact, 'public without sharing class AccountService {}')
    expect(result.analysis.aiScore).toBeNull()
    expect(result.analysis.aiProvider).toBeNull()
    expect(result.findings).toHaveLength(1)
  })

  it('continues as a partial scan and clears every transient source map after a component failure', async () => {
    const repository = new MemoryVibeSafeRepository()
    const sourceMaps: Map<string, string>[] = []
    const provider: AiProvider = {
      name: 'test-ai', model: 'test-model', generateRecommendation: vi.fn(),
      analyzeComponent: vi.fn(async ({ artifact: selected }) => {
        if (selected.id === 'artifact_account_handler') throw new Error('simulated provider failure')
        return { summary: 'No contextual risks found.', score: 95, categoryScores: { security: 95, governor_limits: 95, performance: 95, maintainability: 95, reliability: 95, testability: 95 }, requiresHumanReview: false, findings: [] }
      }),
    }
    const service = new ScanService(repository, async (_org, _tenant, selected) => { const map = new Map(selected.map(({ id }) => [id, 'public class Example {}'])); sourceMaps.push(map); return map }, provider)
    const scan = await service.start({ tenantId: 'tenant_demo', requestedByUserId: 'user_demo', orgConnectionId: 'org_acme_prod', name: 'Partial test', scope: 'selected', artifactIds: ['artifact_account_trigger', 'artifact_account_handler'] })
    let completed = await repository.getScan(scan.id, 'tenant_demo')
    for (let attempt = 0; attempt < 100 && completed?.status !== 'partial'; attempt++) { await new Promise((resolve) => setTimeout(resolve, 10)); completed = await repository.getScan(scan.id, 'tenant_demo') }
    expect(completed?.status).toBe('partial')
    expect((await repository.listScanItems(scan.id)).map(({ status }) => status)).toEqual(['completed', 'failed'])
    expect(sourceMaps).toHaveLength(1)
    expect(sourceMaps.every(({ size }) => size === 0)).toBe(true)
  })
})
