import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { config } from '../config.js'
import type { Artifact, Finding } from '../domain/types.js'
import { ApiError } from '../lib/errors.js'
import type { VibeSafeRepository } from '../repositories/vibesafe-repository.js'
import { AnalysisService } from './analysis-service.js'
import type { AiProvider } from './ai-provider.js'
import type { BatchDeterministicAnalyzer } from './code-analyzer-service.js'
import type { SalesforceOAuthService } from './salesforce-oauth-service.js'

interface VerificationToken { artifactId: string; candidateHash: string; baselineHash: string; expiresAt: number }

export class RemediationOrchestrator {
  private readonly analysis: AnalysisService
  constructor(
    private readonly repository: VibeSafeRepository,
    private readonly salesforce: Pick<SalesforceOAuthService, 'loadArtifactSources' | 'validateArtifactSource'>,
    private readonly analyzer: BatchDeterministicAnalyzer,
    provider?: AiProvider,
  ) { this.analysis = new AnalysisService(provider) }

  async verify(scanId: string, artifactId: string, selectedFindingIds: string[], candidateSource: string, expectedBaselineHash: string, tenantId: string) {
    const scan = await this.repository.getScan(scanId, tenantId)
    if (!scan) throw new ApiError(404, 'SCAN_NOT_FOUND', 'The analysis was not found.')
    const [artifact] = await this.repository.getArtifacts([artifactId])
    if (!artifact || artifact.orgConnectionId !== scan.orgConnectionId || !scan.artifactIds.includes(artifact.id)) throw new ApiError(404, 'ARTIFACT_NOT_FOUND', 'The component was not found in this analysis.')
    const selected = (await Promise.all(selectedFindingIds.map((id) => this.repository.getFinding(id)))).filter((finding) => finding !== undefined)
    if (selected.length !== selectedFindingIds.length || selected.some((finding) => finding.scanId !== scanId || finding.artifactId !== artifactId)) throw new ApiError(400, 'FINDINGS_SCOPE_INVALID', 'Every selected finding must belong to this component analysis.')
    const sources = await this.runStage('source_retrieval', 'retrieving the current Salesforce source', () => this.salesforce.loadArtifactSources(scan.orgConnectionId, tenantId, [artifact]))
    try {
      const baselineSource = sources.get(artifact.id)
      if (baselineSource === undefined) throw new ApiError(409, 'SALESFORCE_SOURCE_NOT_FOUND', 'The current component source could not be retrieved.')
      const baselineHash = this.hash(baselineSource)
      if (baselineHash !== expectedBaselineHash) throw new ApiError(409, 'SOURCE_CHANGED', 'The component changed after this proposal was generated. Generate a new resolution.')
      if (candidateSource === baselineSource) throw new ApiError(400, 'CANDIDATE_UNCHANGED', 'The proposed source is identical to the current Salesforce source.')

      const baselineArtifact: Artifact = { ...artifact, id: `${artifact.id}:baseline` }
      const candidateArtifact: Artifact = { ...artifact, id: `${artifact.id}:candidate` }
      const deterministic = await this.runStage('static_analysis', 'running Salesforce Code Analyzer', () => this.analyzer.analyzeBatch([baselineArtifact, candidateArtifact], new Map([[baselineArtifact.id, baselineSource], [candidateArtifact.id, candidateSource]])))
      const [baseline, candidate] = await this.runStage('ai_review', 'comparing the original and proposed versions', () => Promise.all([
        this.analysis.analyzeComponent(`verify:${scanId}`, baselineArtifact, baselineSource, deterministic.get(baselineArtifact.id) ?? []),
        this.analysis.analyzeComponent(`verify:${scanId}`, candidateArtifact, candidateSource, deterministic.get(candidateArtifact.id) ?? []),
      ]))
      const compilation = await this.runStage('salesforce_compilation', 'checking compilation in Salesforce', () => this.salesforce.validateArtifactSource(scan.orgConnectionId, tenantId, artifact, candidateSource))
      const comparison = this.compare(baseline.findings, candidate.findings, new Set(selected.map(({ ruleId }) => ruleId)))
      const scoreDelta = candidate.analysis.combinedScore - baseline.analysis.combinedScore
      const introducedBlocking = comparison.introduced.filter(({ severity, deterministic }) => deterministic && (severity === 'critical' || severity === 'high'))
      const eligible = compilation.valid && scoreDelta > 0 && introducedBlocking.length === 0
      const reasons = [
        ...(!compilation.valid ? ['The candidate does not compile in Salesforce.'] : []),
        ...(scoreDelta <= 0 ? [`The verified score did not improve (${scoreDelta >= 0 ? '+' : ''}${scoreDelta}).`] : []),
        ...(introducedBlocking.length ? [`The candidate introduced ${introducedBlocking.length} new high or critical finding${introducedBlocking.length === 1 ? '' : 's'}.`] : []),
      ]
      const candidateHash = this.hash(candidateSource)
      const verificationExpiresAt = eligible ? Date.now() + 60 * 60_000 : null
      return {
        eligible, reasons, baseline: { score: baseline.analysis.combinedScore, deterministicScore: baseline.analysis.deterministicScore, aiScore: baseline.analysis.aiScore, findingCount: baseline.findings.length },
        candidate: { score: candidate.analysis.combinedScore, deterministicScore: candidate.analysis.deterministicScore, aiScore: candidate.analysis.aiScore, findingCount: candidate.findings.length },
        scoreDelta, resolved: comparison.resolved.map(this.findingSummary), remaining: comparison.remaining.map(this.findingSummary), introduced: comparison.introduced.map(this.findingSummary),
        targetedResolved: comparison.targetedResolved.map(this.findingSummary), compilation,
        verificationToken: verificationExpiresAt ? this.signToken({ artifactId, candidateHash, baselineHash, expiresAt: verificationExpiresAt }) : null,
        verificationExpiresAt: verificationExpiresAt ? new Date(verificationExpiresAt).toISOString() : null,
      }
    } finally { sources.clear() }
  }

  assertDeploymentToken(token: string, artifactId: string, source: string, baselineHash: string) {
    const [encoded, suppliedSignature] = token.split('.')
    if (!encoded || !suppliedSignature) throw new ApiError(400, 'VERIFICATION_REQUIRED', 'Analyze the proposed changes before deployment.')
    const expectedSignature = this.signature(encoded)
    const supplied = Buffer.from(suppliedSignature, 'base64url'); const expected = Buffer.from(expectedSignature, 'base64url')
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new ApiError(400, 'VERIFICATION_INVALID', 'The deployment verification is invalid. Analyze the proposal again.')
    let payload: VerificationToken
    try { payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as VerificationToken } catch { throw new ApiError(400, 'VERIFICATION_INVALID', 'The deployment verification is invalid.') }
    if (payload.expiresAt < Date.now()) throw new ApiError(409, 'VERIFICATION_EXPIRED', 'The deployment verification expired. Analyze the proposal again.')
    if (payload.artifactId !== artifactId || payload.candidateHash !== this.hash(source) || payload.baselineHash !== baselineHash) throw new ApiError(409, 'VERIFICATION_MISMATCH', 'The code changed after verification. Analyze the edited proposal again.')
  }

  private compare(baseline: Finding[], candidate: Finding[], targetedRules: Set<string>) {
    const candidateKeys = new Set(candidate.map((finding) => this.findingKey(finding)))
    const baselineKeys = new Set(baseline.map((finding) => this.findingKey(finding)))
    const resolved = baseline.filter((finding) => !candidateKeys.has(this.findingKey(finding)))
    return { resolved, remaining: candidate.filter((finding) => baselineKeys.has(this.findingKey(finding))), introduced: candidate.filter((finding) => !baselineKeys.has(this.findingKey(finding))), targetedResolved: resolved.filter(({ ruleId }) => targetedRules.has(ruleId)) }
  }
  private findingKey(finding: Finding) { return `${finding.deterministic ? 'D' : 'A'}:${finding.ruleId}:${finding.category}` }
  private findingSummary = ({ ruleId, severity, category, message, lineStart, deterministic }: Finding) => ({ ruleId, severity, category, message, lineStart, deterministic })
  private async runStage<T>(stage: string, label: string, action: () => Promise<T>): Promise<T> {
    try { return await action() }
    catch (error) {
      if (error instanceof ApiError) throw error
      const reason = error instanceof Error ? error.message.slice(0, 1_000) : 'Unknown verification error'
      console.error(JSON.stringify({ level: 'error', message: 'remediation_verification_stage_failed', stage, reason }))
      throw new ApiError(502, 'REMEDIATION_STAGE_FAILED', `Verification failed while ${label}.`, { stage, reason })
    }
  }
  private hash(source: string) { return createHash('sha256').update(source).digest('hex') }
  private signToken(payload: VerificationToken) { const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url'); return `${encoded}.${this.signature(encoded)}` }
  private signature(encoded: string) { return createHmac('sha256', config.TOKEN_ENCRYPTION_KEY ?? 'development-only-verification-key').update(encoded).digest('base64url') }
}
