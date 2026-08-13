import { createHash, randomUUID } from 'node:crypto'
import type { Recommendation } from '../domain/types.js'
import { ApiError } from '../lib/errors.js'
import type { VibeSafeRepository } from '../repositories/vibesafe-repository.js'
import type { SalesforceOAuthService } from './salesforce-oauth-service.js'
import type { AiProvider } from './ai-provider.js'

const PROMPT_VERSION = 'salesforce-recommendation-v1'

export class RecommendationService {
  constructor(
    private readonly repository: VibeSafeRepository,
    private readonly sourceService: Pick<SalesforceOAuthService, 'loadArtifactSources'>,
    private readonly provider?: AiProvider,
  ) {}

  async generate(findingId: string, tenantId: string) {
    if (!this.provider) throw new ApiError(503, 'AI_PROVIDER_NOT_CONFIGURED', 'OpenAI is not configured on the server.')
    const finding = await this.repository.getFinding(findingId)
    if (!finding) throw new ApiError(404, 'FINDING_NOT_FOUND', 'The finding was not found.')
    const scan = await this.repository.getScan(finding.scanId, tenantId)
    if (!scan) throw new ApiError(404, 'FINDING_NOT_FOUND', 'The finding was not found.')
    const [artifact] = await this.repository.getArtifacts([finding.artifactId])
    if (!artifact || artifact.orgConnectionId !== scan.orgConnectionId) throw new ApiError(409, 'FINDING_COMPONENT_UNAVAILABLE', 'The component for this finding is no longer available.')

    const sources = await this.sourceService.loadArtifactSources(scan.orgConnectionId, tenantId, [artifact])
    try {
      const source = sources.get(artifact.id)
      if (!source) throw new ApiError(409, 'SALESFORCE_SOURCE_NOT_FOUND', 'The component source could not be retrieved.')
      const inputHash = createHash('sha256').update(JSON.stringify({ findingId, fingerprint: `${finding.ruleId}:${finding.ruleVersion}:${finding.message}:${finding.evidence}`, contentHash: artifact.contentHash, provider: this.provider.name, model: this.provider.model, promptVersion: PROMPT_VERSION })).digest('hex')
      const existing = (await this.repository.listRecommendations(findingId)).find((item) => item.provider === this.provider!.name && item.model === this.provider!.model && item.promptVersion === PROMPT_VERSION && item.inputHash === inputHash)
      if (existing) return { recommendation: existing, reused: true }

      const output = await this.provider.generateRecommendation({ artifact, finding, source })
      const recommendation: Recommendation = {
        id: randomUUID(), findingId, provider: this.provider.name, model: this.provider.model,
        promptVersion: PROMPT_VERSION, content: `${output.summary}\n\n${output.recommendation}`,
        proposedCode: output.proposedCode, confidence: output.confidence, inputHash, createdAt: new Date().toISOString(),
      }
      return { recommendation: await this.repository.saveRecommendation(recommendation), reused: false }
    } finally {
      sources.clear()
    }
  }

  async resolveComponent(scanId: string, artifactId: string, findingIds: string[], tenantId: string) {
    if (!this.provider?.generateResolution) throw new ApiError(503, 'AI_PROVIDER_NOT_CONFIGURED', 'The configured AI provider does not support consolidated resolutions.')
    const scan = await this.repository.getScan(scanId, tenantId)
    if (!scan) throw new ApiError(404, 'SCAN_NOT_FOUND', 'The scan was not found.')
    const findings = await Promise.all(findingIds.map((findingId) => this.repository.getFinding(findingId)))
    if (findings.some((finding) => !finding || finding.scanId !== scanId || finding.artifactId !== artifactId)) throw new ApiError(400, 'FINDINGS_SCOPE_INVALID', 'Every selected finding must belong to this component analysis.')
    const [artifact] = await this.repository.getArtifacts([artifactId])
    if (!artifact || artifact.orgConnectionId !== scan.orgConnectionId) throw new ApiError(409, 'FINDING_COMPONENT_UNAVAILABLE', 'The component is no longer available.')
    const sources = await this.sourceService.loadArtifactSources(scan.orgConnectionId, tenantId, [artifact])
    try {
      const source = sources.get(artifact.id)
      if (!source) throw new ApiError(409, 'SALESFORCE_SOURCE_NOT_FOUND', 'The component source could not be retrieved.')
      const resolution = await this.provider.generateResolution({ artifact, findings: findings.filter((finding) => finding !== undefined), source })
      return { ...resolution, originalSource: source, sourceHash: createHash('sha256').update(source).digest('hex'), artifactType: artifact.type }
    } finally { sources.clear() }
  }
}
