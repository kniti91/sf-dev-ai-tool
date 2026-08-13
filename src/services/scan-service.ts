import { randomUUID } from 'node:crypto'
import { ApiError } from '../lib/errors.js'
import type { VibeSafeRepository } from '../repositories/vibesafe-repository.js'
import type { Artifact, Scan } from '../domain/types.js'
import { AnalysisService } from './analysis-service.js'
import type { AiProvider } from './ai-provider.js'
import type { BatchDeterministicAnalyzer, DeterministicViolation } from './code-analyzer-service.js'
import { config } from '../config.js'

export interface StartScanInput { tenantId: string; requestedByUserId: string; orgConnectionId: string; name: string; scope: 'selected' | 'supported'; artifactIds?: string[] | undefined }
export type ArtifactSourceLoader = (orgConnectionId: string, tenantId: string, artifacts: Artifact[]) => Promise<Map<string, string>>

export class ScanService {
  private readonly analysis: AnalysisService
  constructor(
    private readonly repository: VibeSafeRepository,
    private readonly sourceLoader: ArtifactSourceLoader = async () => new Map(),
    private readonly aiProvider?: AiProvider,
    private readonly deterministicAnalyzer?: BatchDeterministicAnalyzer,
  ) { this.analysis = new AnalysisService(aiProvider) }

  async start(input: StartScanInput): Promise<Scan> {
    const org = await this.repository.getOrgConnection(input.orgConnectionId, input.tenantId)
    if (!org) throw new ApiError(404, 'ORG_CONNECTION_NOT_FOUND', 'The Salesforce organization connection was not found.')
    const available = await this.repository.listArtifacts(input.orgConnectionId)
    const artifactIds = input.scope === 'supported' ? available.map(({ id }) => id) : input.artifactIds ?? []
    if (artifactIds.length === 0) throw new ApiError(400, 'SCAN_SCOPE_EMPTY', 'Select at least one artifact to analyze.')
    const resolved = await this.repository.getArtifacts(artifactIds)
    if (resolved.length !== artifactIds.length || resolved.some((artifact) => artifact.orgConnectionId !== input.orgConnectionId)) throw new ApiError(400, 'SCAN_SCOPE_INVALID', 'One or more artifacts do not belong to this organization.')
    const scan = await this.repository.saveScan({
      id: randomUUID(), tenantId: input.tenantId, requestedByUserId: input.requestedByUserId, orgConnectionId: input.orgConnectionId, name: input.name, scope: input.scope, artifactIds,
      requestSnapshot: { scope: input.scope, artifactIds }, selectedCounts: {}, status: 'queued', progress: { completed: 0, total: artifactIds.length, stage: 'queued', currentBatch: 0, totalBatches: Math.ceil(artifactIds.length / config.SCAN_COMPONENT_BATCH_SIZE), failed: 0 }, reusedArtifactCount: 0, ruleSetVersion: '2.0.0', scorePolicyVersion: '2.0.0',
      score: null, overallSummary: null, aiProvider: this.aiProvider?.name ?? null, aiModel: this.aiProvider?.model ?? null, promptVersion: this.aiProvider ? 'salesforce-component-analysis-v1' : null, createdAt: new Date().toISOString(), completedAt: null,
    })
    setTimeout(() => { void this.execute(scan.id, input.tenantId) }, 0)
    return scan
  }

  async cancel(id: string, tenantId: string): Promise<Scan> {
    const scan = await this.repository.getScan(id, tenantId)
    if (!scan) throw new ApiError(404, 'SCAN_NOT_FOUND', 'The scan was not found.')
    if (['completed', 'failed', 'cancelled'].includes(scan.status)) throw new ApiError(409, 'SCAN_NOT_CANCELLABLE', `A ${scan.status} scan cannot be cancelled.`)
    return (await this.repository.updateScan(id, { status: 'cancelled', completedAt: new Date().toISOString() }))!
  }

  private async execute(id: string, tenantId: string) {
    const scan = await this.repository.getScan(id, tenantId)
    if (!scan || scan.status === 'cancelled') return
    const artifacts = await this.repository.getArtifacts(scan.artifactIds)
    const batches = this.chunk(artifacts, config.SCAN_COMPONENT_BATCH_SIZE)
    let completed = 0
    let failed = 0
    let progressWrites = Promise.resolve<unknown>(undefined)
    const reportProgress = (stage: NonNullable<Scan['progress']['stage']>, currentBatch: number) => {
      const snapshot = { completed, total: artifacts.length, stage, currentBatch, totalBatches: batches.length, failed }
      progressWrites = progressWrites.then(() => this.repository.updateScan(id, { progress: snapshot }))
      return progressWrites
    }
    await this.repository.updateScan(id, { status: 'running', progress: { completed, total: artifacts.length, stage: 'retrieving', currentBatch: 0, totalBatches: batches.length, failed } })

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const current = await this.repository.getScan(id, tenantId)
      if (!current || current.status === 'cancelled') return
      const batch = batches[batchIndex]!
      const currentBatch = batchIndex + 1
      let sources: Map<string, string> | undefined
      try {
        await reportProgress('retrieving', currentBatch)
        sources = await this.sourceLoader(scan.orgConnectionId, tenantId, batch)
        for (const artifact of batch) if (!sources.has(artifact.id)) throw new ApiError(409, 'SALESFORCE_SOURCE_NOT_FOUND', `Source for ${artifact.name} could not be retrieved.`)

        const pending: Artifact[] = []
        for (const artifact of batch) {
          const reused = await this.repository.reuseExistingAnalysisResults(id, artifact.id)
          if (reused.has(artifact.id)) { completed += 1; await reportProgress('retrieving', currentBatch) }
          else pending.push(artifact)
        }

        let deterministic: Map<string, DeterministicViolation[]> | undefined
        if (pending.length && this.deterministicAnalyzer) {
          await reportProgress('static_analysis', currentBatch)
          const codeArtifacts = pending.filter(({ type }) => type === 'Apex Class' || type === 'Trigger' || type === 'LWC')
          try { deterministic = codeArtifacts.length ? await this.deterministicAnalyzer.analyzeBatch(codeArtifacts, sources) : new Map() }
          catch (error) { console.warn(JSON.stringify({ level: 'warn', message: 'salesforce_code_analyzer_batch_unavailable', batch: currentBatch, error: error instanceof Error ? error.message : 'Unknown analyzer error' })) }
        }

        await reportProgress('ai_analysis', currentBatch)
        let cursor = 0
        const worker = async () => {
          while (cursor < pending.length) {
            const artifact = pending[cursor++]!
            try {
              const source = sources!.get(artifact.id)!
              const result = await this.analysis.analyzeComponent(id, artifact, source, deterministic?.get(artifact.id))
              await this.repository.saveComponentAnalysis(id, result.analysis, result.findings)
            } catch (error) {
              failed += 1
              const code = error instanceof ApiError ? error.code : 'COMPONENT_ANALYSIS_FAILED'
              const message = error instanceof Error ? error.message : 'Component analysis failed.'
              await this.repository.failScanItem(id, artifact.id, code, message)
            } finally {
              completed += 1
              await reportProgress('ai_analysis', currentBatch)
            }
          }
        }
        await Promise.all(Array.from({ length: Math.min(config.AI_COMPONENT_CONCURRENCY, pending.length) }, worker))
      } catch (error) {
        const code = error instanceof ApiError ? error.code : 'COMPONENT_ANALYSIS_FAILED'
        const message = error instanceof Error ? error.message : 'Component analysis failed.'
        for (const artifact of batch) {
          failed += 1
          completed += 1
          await this.repository.failScanItem(id, artifact.id, code, message)
        }
        await reportProgress('ai_analysis', currentBatch)
      } finally {
        sources?.clear()
      }
    }
    await progressWrites
    await reportProgress('finalizing', batches.length)
    const items = await this.repository.listScanItems(id)
    const successful = items.filter(({ status }) => status === 'completed' || status === 'reused')
    const score = successful.length ? Math.round(successful.reduce((sum, item) => sum + (item.score ?? 0), 0) / successful.length) : 0
    const status = failed ? (successful.length ? 'partial' : 'failed') : 'completed'
    await this.repository.updateScan(id, { status, progress: { completed, total: artifacts.length, stage: status === 'failed' ? 'failed' : 'completed', currentBatch: batches.length, totalBatches: batches.length, failed }, score, completedAt: new Date().toISOString() })
  }

  private chunk<T>(values: T[], size: number): T[][] {
    const result: T[][] = []
    for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size))
    return result
  }
}
