import { createHash } from 'node:crypto'
import type { PrismaClient } from '../generated/prisma/client.js'
import { AnalysisItemStatus, AnalysisRunStatus, ArtifactType as DatabaseArtifactType, FindingDisposition, OrgConnectionStatus, OrgEnvironment, Severity as DatabaseSeverity } from '../generated/prisma/enums.js'
import type { Artifact, ComponentAnalysis, Finding, MetadataComponent, OrgConnection, Recommendation, Scan, Severity } from '../domain/types.js'
import { ApiError } from '../lib/errors.js'
import type { VibeSafeRepository } from './vibesafe-repository.js'

const environmentToDatabase = { production: OrgEnvironment.PRODUCTION, sandbox: OrgEnvironment.SANDBOX } as const
const statusToDatabase = { connected: OrgConnectionStatus.CONNECTED, reauthorization_required: OrgConnectionStatus.REAUTHORIZATION_REQUIRED } as const
const scanStatusToDatabase = { queued: AnalysisRunStatus.QUEUED, running: AnalysisRunStatus.RUNNING, partial: AnalysisRunStatus.PARTIAL, completed: AnalysisRunStatus.COMPLETED, cancelled: AnalysisRunStatus.CANCELLED, failed: AnalysisRunStatus.FAILED } as const
const severityToDatabase = { critical: DatabaseSeverity.CRITICAL, high: DatabaseSeverity.HIGH, medium: DatabaseSeverity.MEDIUM, low: DatabaseSeverity.LOW, informational: DatabaseSeverity.INFORMATIONAL } as const
const severityFromDatabase = { CRITICAL: 'critical', HIGH: 'high', MEDIUM: 'medium', LOW: 'low', INFORMATIONAL: 'informational' } as const

export class PrismaOrgRepository implements VibeSafeRepository {
  constructor(private readonly database: PrismaClient) {}

  async listOrgConnections(tenantId: string) {
    return (await this.database.orgConnection.findMany({ where: { workspaceId: tenantId }, orderBy: { createdAt: 'asc' } })).map(this.toDomain)
  }

  async getOrgConnection(id: string, tenantId: string) {
    const connection = await this.database.orgConnection.findFirst({ where: { id, workspaceId: tenantId } })
    return connection ? this.toDomain(connection) : undefined
  }

  async saveOrgConnection(connection: OrgConnection, connectedByUserId?: string) {
    const existing = await this.database.orgConnection.findUnique({ where: { id: connection.id }, select: { id: true } })
    const values = {
      label: connection.label,
      username: connection.username,
      environment: environmentToDatabase[connection.environment],
      instanceUrl: connection.instanceUrl,
      status: statusToDatabase[connection.status],
      lastDiscoveredAt: connection.lastDiscoveredAt ? new Date(connection.lastDiscoveredAt) : null,
    }
    if (existing) {
      return this.toDomain(await this.database.orgConnection.update({ where: { id: connection.id }, data: values }))
    }
    if (!connectedByUserId) throw new ApiError(500, 'ORG_CONNECTION_OWNER_REQUIRED', 'A user is required when creating a Salesforce organization connection.')
    const stored = await this.database.orgConnection.upsert({
      where: { workspaceId_salesforceOrgId: { workspaceId: connection.tenantId, salesforceOrgId: connection.salesforceOrgId } },
      update: values,
      create: { id: connection.id, workspaceId: connection.tenantId, connectedByUserId, salesforceOrgId: connection.salesforceOrgId, ...values },
    })
    return this.toDomain(stored)
  }

  async deleteOrgConnection(id: string, tenantId: string) {
    return (await this.database.orgConnection.deleteMany({ where: { id, workspaceId: tenantId } })).count > 0
  }

  async listArtifacts(orgConnectionId: string) {
    return (await this.database.artifact.findMany({ where: { orgConnectionId, isDeleted: false }, include: { currentVersion: true }, orderBy: [{ type: 'asc' }, { name: 'asc' }] })).map((artifact) => this.toArtifact(artifact))
  }

  async getArtifacts(ids: string[]) {
    if (!ids.length) return []
    return (await this.database.artifact.findMany({ where: { id: { in: ids }, isDeleted: false }, include: { currentVersion: true } })).map((artifact) => this.toArtifact(artifact))
  }

  async replaceArtifacts(orgConnectionId: string, artifacts: Artifact[]) {
    await this.database.$transaction(async (transaction) => {
      for (const artifact of artifacts) {
        const identityKey = `${artifact.type}:${artifact.namespace ?? ''}:${artifact.name}`
        await transaction.artifact.upsert({
          where: { orgConnectionId_identityKey: { orgConnectionId, identityKey } },
          update: { salesforceMetadataId: artifact.salesforceMetadataId, name: artifact.name, namespace: artifact.namespace, apiVersion: artifact.apiVersion, salesforceModifiedAt: new Date(artifact.modifiedAt), isDeleted: false },
          create: { id: artifact.id, orgConnectionId, identityKey, salesforceMetadataId: artifact.salesforceMetadataId, type: this.toDatabaseArtifactType(artifact.type), name: artifact.name, namespace: artifact.namespace, apiVersion: artifact.apiVersion, salesforceModifiedAt: new Date(artifact.modifiedAt) },
        })
      }
      await transaction.artifact.updateMany({ where: { orgConnectionId, id: { notIn: artifacts.map(({ id }) => id) } }, data: { isDeleted: true } })
    })
  }

  async replaceMetadataComponents(orgConnectionId: string, components: MetadataComponent[]) {
    await this.database.$transaction(async (transaction) => {
      await transaction.metadataComponent.deleteMany({ where: { orgConnectionId } })
      for (let index = 0; index < components.length; index += 1_000) {
        await transaction.metadataComponent.createMany({ data: components.slice(index, index + 1_000).map((component) => ({
          id: component.id, orgConnectionId, identityKey: component.identityKey, salesforceMetadataId: component.salesforceMetadataId,
          type: component.type, name: component.name, label: component.label, namespace: component.namespace,
          parentIdentityKey: component.parentIdentityKey, active: component.active, attributes: JSON.parse(JSON.stringify(component.attributes)) as object,
          salesforceModifiedAt: component.modifiedAt ? new Date(component.modifiedAt) : null,
        })) })
      }
    }, { timeout: 60_000 })
  }

  async listMetadataComponents(orgConnectionId: string, type?: MetadataComponent['type']) {
    return (await this.database.metadataComponent.findMany({ where: { orgConnectionId, ...(type ? { type } : {}) }, orderBy: [{ type: 'asc' }, { name: 'asc' }] })).map((component): MetadataComponent => ({
      id: component.id, orgConnectionId: component.orgConnectionId, identityKey: component.identityKey,
      salesforceMetadataId: component.salesforceMetadataId, type: component.type as MetadataComponent['type'], name: component.name,
      label: component.label, namespace: component.namespace, parentIdentityKey: component.parentIdentityKey, active: component.active,
      attributes: component.attributes as Record<string, unknown>, modifiedAt: component.salesforceModifiedAt?.toISOString() ?? null,
    }))
  }

  async recordArtifactVersion(artifactId: string, contentHash: string, sourceSizeBytes: number) {
    await this.database.$transaction(async (transaction) => {
      const version = await transaction.artifactVersion.upsert({
        where: { artifactId_contentHash: { artifactId, contentHash } },
        update: {},
        create: { artifactId, contentHash, sourceSizeBytes },
      })
      await transaction.artifact.update({ where: { id: artifactId }, data: { currentVersionId: version.id } })
    })
  }
  async listScans(tenantId: string, orgConnectionId?: string) {
    return (await this.database.analysisRun.findMany({ where: { workspaceId: tenantId, ...(orgConnectionId ? { orgConnectionId } : {}) }, include: { items: { select: { artifactId: true } } }, orderBy: { createdAt: 'desc' } })).map((run) => this.toScan(run))
  }

  async getScan(id: string, tenantId: string) {
    const run = await this.database.analysisRun.findFirst({ where: { id, workspaceId: tenantId }, include: { items: { select: { artifactId: true } } } })
    return run ? this.toScan(run) : undefined
  }

  async saveScan(scan: Scan) {
    const artifacts = await this.database.artifact.findMany({ where: { id: { in: scan.artifactIds }, orgConnection: { workspaceId: scan.tenantId }, isDeleted: false } })
    if (artifacts.length !== scan.artifactIds.length) throw new ApiError(400, 'SCAN_SCOPE_INVALID', 'One or more selected components do not belong to this organization.')
    const counts = artifacts.reduce<Record<string, number>>((result, artifact) => { result[artifact.type] = (result[artifact.type] ?? 0) + 1; return result }, {})
    const analyzerVersion = 'vibesafe+salesforce-code-analyzer@2.0.0'
    const analysisProfileHash = this.hash(JSON.stringify({ analyzerVersion, ruleSetVersion: scan.ruleSetVersion, scorePolicyVersion: scan.scorePolicyVersion, aiProvider: scan.aiProvider, aiModel: scan.aiModel, promptVersion: scan.promptVersion }))
    const run = await this.database.analysisRun.create({ data: {
      id: scan.id,
      workspaceId: scan.tenantId,
      orgConnectionId: scan.orgConnectionId,
      requestedByUserId: scan.requestedByUserId,
      name: scan.name,
      status: scanStatusToDatabase[scan.status],
      scope: scan.scope,
      requestSnapshot: { scope: scan.scope, components: artifacts.map(({ id, name, type }) => ({ id, name, type })) },
      selectedCounts: counts,
      requestedArtifactCount: artifacts.length,
      completedArtifactCount: scan.progress.completed,
      failedArtifactCount: scan.progress.failed ?? 0,
      currentStage: scan.progress.stage ?? 'queued',
      currentBatch: scan.progress.currentBatch ?? 0,
      totalBatches: scan.progress.totalBatches ?? 0,
      overallScore: scan.score,
      analyzerVersion,
      ruleSetVersion: scan.ruleSetVersion,
      scorePolicyVersion: scan.scorePolicyVersion,
      analysisProfileHash,
      aiProvider: scan.aiProvider,
      aiModel: scan.aiModel,
      promptVersion: scan.promptVersion,
      createdAt: new Date(scan.createdAt),
      completedAt: scan.completedAt ? new Date(scan.completedAt) : null,
      items: { create: artifacts.map(({ id, currentVersionId }) => ({ artifactId: id, artifactVersionId: currentVersionId, status: AnalysisItemStatus.QUEUED })) },
    }, include: { items: { select: { artifactId: true } } } })
    return this.toScan(run)
  }

  async updateScan(id: string, update: Partial<Scan>) {
    const existing = await this.database.analysisRun.findUnique({ where: { id }, select: { id: true } })
    if (!existing) return undefined
    const requiresFinalSummary = update.status === 'completed' || update.status === 'partial'
    await this.database.analysisRun.update({ where: { id }, data: {
      ...(update.status && !requiresFinalSummary ? { status: scanStatusToDatabase[update.status] } : {}),
      ...(update.progress ? { completedArtifactCount: update.progress.completed } : {}),
      ...(update.progress?.failed !== undefined ? { failedArtifactCount: update.progress.failed } : {}),
      ...(update.progress?.stage ? { currentStage: update.progress.stage } : {}),
      ...(update.progress?.currentBatch !== undefined ? { currentBatch: update.progress.currentBatch } : {}),
      ...(update.progress?.totalBatches !== undefined ? { totalBatches: update.progress.totalBatches } : {}),
      ...(update.score !== undefined ? { overallScore: update.score } : {}),
      ...(update.completedAt !== undefined ? { completedAt: update.completedAt ? new Date(update.completedAt) : null } : {}),
    } })
    if (requiresFinalSummary) {
      await this.finalizeRunSummary(id)
      await this.database.analysisRun.update({ where: { id }, data: { status: scanStatusToDatabase[update.status!] } })
    }
    const stored = await this.database.analysisRun.findUniqueOrThrow({ where: { id }, include: { items: { select: { artifactId: true } } } })
    return this.toScan(stored)
  }

  async reuseExistingAnalysisResults(scanId: string, artifactId?: string) {
    const run = await this.database.analysisRun.findUniqueOrThrow({ where: { id: scanId }, include: { items: { where: { ...(artifactId ? { artifactId } : {}), status: AnalysisItemStatus.QUEUED }, include: { artifact: { select: { currentVersionId: true } } } } } })
    const reused = new Set<string>()
    await this.database.$transaction(async (transaction) => {
      for (const item of run.items) {
        const artifactVersionId = item.artifact.currentVersionId
        if (!artifactVersionId) continue
        const result = await transaction.componentAnalysisResult.findUnique({ where: { artifactVersionId_analysisProfileHash: { artifactVersionId, analysisProfileHash: run.analysisProfileHash } } })
        if (result) {
          reused.add(item.artifactId)
          await transaction.analysisRunItem.update({ where: { id: item.id }, data: { artifactVersionId, componentAnalysisResultId: result.id, status: AnalysisItemStatus.REUSED, score: result.combinedScore } })
        } else {
          await transaction.analysisRunItem.update({ where: { id: item.id }, data: { artifactVersionId, status: AnalysisItemStatus.RUNNING } })
        }
      }
    })
    return reused
  }

  async listFindings(scanId?: string) {
    const items = await this.database.analysisRunItem.findMany({
      where: { ...(scanId ? { analysisRunId: scanId } : {}), componentAnalysisResultId: { not: null } },
      include: { analysisRun: { select: { id: true } }, artifact: { select: { id: true } }, componentAnalysisResult: { include: { findings: true } } },
      orderBy: { createdAt: 'desc' },
    })
    return items.flatMap((item) => (item.componentAnalysisResult?.findings ?? []).map((finding) => this.toFinding(finding, item.analysisRun.id, item.artifact.id)))
  }

  async getFinding(id: string) {
    const finding = await this.database.finding.findUnique({ where: { id }, include: { componentAnalysisResult: { include: { runItems: { include: { analysisRun: { select: { id: true } }, artifact: { select: { id: true } } }, orderBy: { createdAt: 'desc' }, take: 1 } } } } })
    const item = finding?.componentAnalysisResult.runItems[0]
    return finding && item ? this.toFinding(finding, item.analysisRun.id, item.artifact.id) : undefined
  }

  async replaceScanFindings(scanId: string, findings: Finding[], analyzedArtifactIds: string[]) {
    const run = await this.database.analysisRun.findUniqueOrThrow({ where: { id: scanId }, include: { items: { where: { artifactId: { in: analyzedArtifactIds } }, include: { artifact: { select: { currentVersionId: true } } } } } })
    await this.database.$transaction(async (transaction) => {
      for (const item of run.items) {
        const artifactVersionId = item.artifact.currentVersionId
        if (!artifactVersionId) throw new ApiError(409, 'ARTIFACT_VERSION_REQUIRED', 'The selected component was not fingerprinted before analysis.')
        const artifactFindings = findings.filter(({ artifactId }) => artifactId === item.artifactId)
        const severityCounts = this.severityCounts(artifactFindings)
        const score = this.score(artifactFindings)
        let result = await transaction.componentAnalysisResult.findUnique({ where: { artifactVersionId_analysisProfileHash: { artifactVersionId, analysisProfileHash: run.analysisProfileHash } } })
        let reused = true
        if (!result) {
          reused = false
          result = await transaction.componentAnalysisResult.create({ data: {
            artifactVersionId,
            analysisProfileHash: run.analysisProfileHash,
            analyzerVersion: run.analyzerVersion,
            ruleSetVersion: run.ruleSetVersion,
            deterministicScore: score,
            deterministicSummary: this.componentSummary(artifactFindings),
            metrics: { severityCounts, findingCount: artifactFindings.length },
            findings: { create: artifactFindings.map((finding) => ({
              id: finding.id,
              fingerprint: this.hash(JSON.stringify({ ruleId: finding.ruleId, lineStart: finding.lineStart, lineEnd: finding.lineEnd, message: finding.message })),
              ruleId: finding.ruleId,
              ruleVersion: finding.ruleVersion,
              severity: severityToDatabase[finding.severity],
              category: finding.category,
              message: finding.message,
              evidence: finding.evidence,
              lineStart: finding.lineStart,
              lineEnd: finding.lineEnd,
              confidence: finding.confidence,
              deterministic: finding.deterministic,
              engine: finding.engine,
              disposition: FindingDisposition.OPEN,
            })) },
          } })
        }
        await transaction.analysisRunItem.update({ where: { id: item.id }, data: { artifactVersionId, componentAnalysisResultId: result.id, status: reused ? AnalysisItemStatus.REUSED : AnalysisItemStatus.COMPLETED, score: result.deterministicScore } })
      }
    })
  }

  async saveComponentAnalysis(scanId: string, analysis: ComponentAnalysis, findings: Finding[]) {
    const run = await this.database.analysisRun.findUniqueOrThrow({ where: { id: scanId }, include: { items: { where: { artifactId: analysis.artifactId }, include: { artifact: { select: { currentVersionId: true } } } } } })
    const item = run.items[0]
    const artifactVersionId = item?.artifact.currentVersionId
    if (!item || !artifactVersionId) throw new ApiError(409, 'ARTIFACT_VERSION_REQUIRED', 'The selected component was not fingerprinted before analysis.')
    await this.database.$transaction(async (transaction) => {
      let result = await transaction.componentAnalysisResult.findUnique({ where: { artifactVersionId_analysisProfileHash: { artifactVersionId, analysisProfileHash: run.analysisProfileHash } } })
      let reused = true
      if (!result) {
        reused = false
        const severityCounts = this.severityCounts(findings)
        result = await transaction.componentAnalysisResult.create({ data: {
          artifactVersionId, analysisProfileHash: run.analysisProfileHash, analyzerVersion: run.analyzerVersion, ruleSetVersion: run.ruleSetVersion,
          aiProvider: analysis.aiProvider, aiModel: analysis.aiModel, promptVersion: analysis.promptVersion,
          deterministicScore: analysis.deterministicScore, aiScore: analysis.aiScore, combinedScore: analysis.combinedScore,
          deterministicSummary: analysis.deterministicSummary, aiSummary: analysis.aiSummary, categoryScores: analysis.categoryScores,
          requiresHumanReview: analysis.requiresHumanReview, metrics: { severityCounts, findingCount: findings.length },
          findings: { create: findings.map((finding) => ({
            id: finding.id, fingerprint: this.hash(JSON.stringify({ ruleId: finding.ruleId, lineStart: finding.lineStart, lineEnd: finding.lineEnd, message: finding.message })),
            ruleId: finding.ruleId, ruleVersion: finding.ruleVersion, severity: severityToDatabase[finding.severity], category: finding.category,
            message: finding.message, evidence: finding.evidence, lineStart: finding.lineStart || null, lineEnd: finding.lineEnd || null,
            confidence: finding.confidence, deterministic: finding.deterministic, engine: finding.engine, disposition: FindingDisposition.OPEN,
            ...(finding.suggestedRecommendation ? { recommendations: { create: [{
              provider: analysis.aiProvider ?? finding.engine, model: analysis.aiModel ?? 'unknown', promptVersion: analysis.promptVersion ?? finding.ruleVersion,
              content: finding.suggestedRecommendation, proposedCode: finding.proposedCode ?? null, confidence: finding.confidence,
              inputHash: this.hash(JSON.stringify({ artifactVersionId, ruleId: finding.ruleId, lineStart: finding.lineStart, promptVersion: analysis.promptVersion })),
            }] } } : {}),
          })) },
        } })
      }
      await transaction.analysisRunItem.update({ where: { id: item.id }, data: { artifactVersionId, componentAnalysisResultId: result.id, status: reused ? AnalysisItemStatus.REUSED : AnalysisItemStatus.COMPLETED, score: result.combinedScore } })
    })
  }

  async failScanItem(scanId: string, artifactId: string, code: string, message: string) {
    await this.database.analysisRunItem.updateMany({ where: { analysisRunId: scanId, artifactId }, data: { status: AnalysisItemStatus.FAILED, errorCode: code, errorMessage: message.slice(0, 2_000) } })
  }

  async listScanItems(scanId: string) {
    const items = await this.database.analysisRunItem.findMany({ where: { analysisRunId: scanId }, include: { artifact: true, componentAnalysisResult: true }, orderBy: { createdAt: 'asc' } })
    return items.map((item) => ({
      artifactId: item.artifactId, artifactName: item.artifact.name, artifactType: this.fromDatabaseArtifactType(item.artifact.type), status: item.status.toLowerCase() as 'queued' | 'running' | 'reused' | 'completed' | 'skipped' | 'failed',
      score: item.score, errorCode: item.errorCode, errorMessage: item.errorMessage,
      analysis: item.componentAnalysisResult ? {
        artifactId: item.artifactId, deterministicScore: item.componentAnalysisResult.deterministicScore, aiScore: item.componentAnalysisResult.aiScore,
        combinedScore: item.componentAnalysisResult.combinedScore, deterministicSummary: item.componentAnalysisResult.deterministicSummary ?? '', aiSummary: item.componentAnalysisResult.aiSummary,
        categoryScores: item.componentAnalysisResult.categoryScores as Record<string, number>, requiresHumanReview: item.componentAnalysisResult.requiresHumanReview,
        aiProvider: item.componentAnalysisResult.aiProvider, aiModel: item.componentAnalysisResult.aiModel, promptVersion: item.componentAnalysisResult.promptVersion,
      } : null,
    }))
  }

  async listRecommendations(findingId: string) {
    return (await this.database.recommendation.findMany({ where: { findingId }, orderBy: { createdAt: 'desc' } })).map((recommendation) => this.toRecommendation(recommendation))
  }

  async saveRecommendation(recommendation: Recommendation) {
    const stored = await this.database.recommendation.upsert({
      where: { findingId_provider_model_promptVersion_inputHash: { findingId: recommendation.findingId, provider: recommendation.provider, model: recommendation.model, promptVersion: recommendation.promptVersion, inputHash: recommendation.inputHash } },
      update: {},
      create: {
        id: recommendation.id,
        findingId: recommendation.findingId,
        provider: recommendation.provider,
        model: recommendation.model,
        promptVersion: recommendation.promptVersion,
        content: recommendation.content,
        proposedCode: recommendation.proposedCode,
        confidence: recommendation.confidence,
        inputHash: recommendation.inputHash,
        createdAt: new Date(recommendation.createdAt),
      },
    })
    return this.toRecommendation(stored)
  }

  private async finalizeRunSummary(scanId: string) {
    const run = await this.database.analysisRun.findUniqueOrThrow({ where: { id: scanId }, include: { items: { include: { componentAnalysisResult: { include: { findings: true } } } } } })
    const findings = run.items.flatMap(({ componentAnalysisResult }) => componentAnalysisResult?.findings ?? [])
    const severityCounts = findings.reduce<Record<string, number>>((counts, finding) => { const key = severityFromDatabase[finding.severity]; counts[key] = (counts[key] ?? 0) + 1; return counts }, {})
    const categories = new Map<string, typeof findings>()
    for (const finding of findings) categories.set(finding.category, [...(categories.get(finding.category) ?? []), finding])
    const componentCategoryScores = new Map<string, number[]>()
    for (const item of run.items) {
      const scores = (item.componentAnalysisResult?.categoryScores ?? {}) as Record<string, number>
      for (const [category, score] of Object.entries(scores)) componentCategoryScores.set(category, [...(componentCategoryScores.get(category) ?? []), score])
    }
    await this.database.$transaction(async (transaction) => {
      await transaction.analysisCategoryScore.deleteMany({ where: { analysisRunId: scanId } })
      const categoryNames = new Set([...categories.keys(), ...componentCategoryScores.keys()])
      if (categoryNames.size) await transaction.analysisCategoryScore.createMany({ data: [...categoryNames].map((category) => {
        const categoryFindings = categories.get(category) ?? []
        const scores = componentCategoryScores.get(category) ?? []
        return {
        analysisRunId: scanId,
        category,
        score: scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : this.score(categoryFindings.map((finding) => ({ severity: severityFromDatabase[finding.severity] }))),
        findingCount: categoryFindings.length,
        summary: `${categoryFindings.length} finding${categoryFindings.length === 1 ? '' : 's'} in ${category.replaceAll('_', ' ')}.`,
      } }) })
      const completedArtifactCount = run.items.filter(({ status }) => status === AnalysisItemStatus.COMPLETED || status === AnalysisItemStatus.REUSED).length
      const reusedArtifactCount = run.items.filter(({ status }) => status === AnalysisItemStatus.REUSED).length
      const failedArtifactCount = run.items.filter(({ status }) => status === AnalysisItemStatus.FAILED).length
      const aiFindingCount = findings.filter(({ deterministic }) => !deterministic).length
      const overallSummary = findings.length
        ? `Analyzed ${completedArtifactCount} components and found ${findings.length} issue${findings.length === 1 ? '' : 's'} (${aiFindingCount} AI-assisted): ${severityCounts.critical ?? 0} critical, ${severityCounts.high ?? 0} high, ${severityCounts.medium ?? 0} medium, and ${severityCounts.low ?? 0} low.${failedArtifactCount ? ` ${failedArtifactCount} component${failedArtifactCount === 1 ? '' : 's'} could not be analyzed.` : ''}`
        : `Analyzed ${completedArtifactCount} components with no findings.${failedArtifactCount ? ` ${failedArtifactCount} component${failedArtifactCount === 1 ? '' : 's'} could not be analyzed.` : ''}`
      await transaction.analysisRun.update({ where: { id: scanId }, data: {
        completedArtifactCount,
      reusedArtifactCount,
      failedArtifactCount,
        overallSummary,
        summarySnapshot: { componentCount: run.items.length, completedArtifactCount, reusedArtifactCount, failedArtifactCount, findingCount: findings.length, aiFindingCount, severityCounts, categories: Object.fromEntries([...categoryNames].map((category) => [category, { findingCount: (categories.get(category) ?? []).length, scores: componentCategoryScores.get(category) ?? [] }])) },
      } })
    })
  }

  private toScan(run: {
    id: string
    workspaceId: string
    requestedByUserId: string
    orgConnectionId: string
    name: string
    scope: string
    status: AnalysisRunStatus
    overallScore: number | null
    requestedArtifactCount: number
    completedArtifactCount: number
    reusedArtifactCount: number
    failedArtifactCount: number
    currentStage: string
    currentBatch: number
    totalBatches: number
    requestSnapshot: unknown
    selectedCounts: unknown
    ruleSetVersion: string
    scorePolicyVersion: string
    analysisProfileHash: string
    aiProvider: string | null
    aiModel: string | null
    promptVersion: string | null
    createdAt: Date
    completedAt: Date | null
    overallSummary: string | null
    items: Array<{ artifactId: string }>
  }): Scan {
    const status = run.status.toLowerCase() as Scan['status']
    return {
      id: run.id,
      tenantId: run.workspaceId,
      requestedByUserId: run.requestedByUserId,
      orgConnectionId: run.orgConnectionId,
      name: run.name,
      scope: run.scope === 'supported' ? 'supported' : 'selected',
      artifactIds: run.items.map(({ artifactId }) => artifactId),
      requestSnapshot: run.requestSnapshot,
      selectedCounts: run.selectedCounts,
      status,
      progress: { completed: run.completedArtifactCount, total: run.requestedArtifactCount, stage: run.currentStage as NonNullable<Scan['progress']['stage']>, currentBatch: run.currentBatch, totalBatches: run.totalBatches, failed: run.failedArtifactCount },
      reusedArtifactCount: run.reusedArtifactCount,
      ruleSetVersion: run.ruleSetVersion,
      scorePolicyVersion: run.scorePolicyVersion,
      score: run.overallScore,
      overallSummary: run.overallSummary,
      aiProvider: run.aiProvider,
      aiModel: run.aiModel,
      promptVersion: run.promptVersion,
      createdAt: run.createdAt.toISOString(),
      completedAt: run.completedAt?.toISOString() ?? null,
    }
  }

  private toFinding(finding: {
    id: string
    ruleId: string
    ruleVersion: string
    severity: DatabaseSeverity
    category: string
    message: string
    evidence: string
    lineStart: number | null
    lineEnd: number | null
    engine: string
    confidence: number
    deterministic: boolean
  }, scanId: string, artifactId: string): Finding {
    return {
      id: finding.id,
      scanId,
      artifactId,
      ruleId: finding.ruleId,
      ruleVersion: finding.ruleVersion,
      severity: severityFromDatabase[finding.severity],
      category: finding.category,
      message: finding.message,
      evidence: finding.evidence,
      lineStart: finding.lineStart ?? 0,
      lineEnd: finding.lineEnd ?? finding.lineStart ?? 0,
      engine: finding.engine,
      confidence: finding.confidence,
      deterministic: finding.deterministic,
    }
  }

  private toRecommendation(recommendation: {
    id: string
    findingId: string
    provider: string
    model: string
    promptVersion: string
    content: string
    proposedCode: string | null
    confidence: number | null
    inputHash: string
    createdAt: Date
  }): Recommendation {
    return { ...recommendation, createdAt: recommendation.createdAt.toISOString() }
  }

  private score(findings: Array<{ severity: Severity }>) {
    const penalties: Record<Severity, number> = { critical: 15, high: 8, medium: 4, low: 1, informational: 0 }
    return Math.max(0, 100 - findings.reduce((total, finding) => total + penalties[finding.severity], 0))
  }

  private severityCounts(findings: Array<{ severity: Severity }>) {
    return findings.reduce<Record<string, number>>((counts, finding) => { counts[finding.severity] = (counts[finding.severity] ?? 0) + 1; return counts }, {})
  }

  private componentSummary(findings: Finding[]) {
    const counts = this.severityCounts(findings)
    return findings.length ? `${findings.length} deterministic finding${findings.length === 1 ? '' : 's'}: ${counts.critical ?? 0} critical, ${counts.high ?? 0} high, ${counts.medium ?? 0} medium, and ${counts.low ?? 0} low.` : 'No findings from the enabled deterministic rules.'
  }

  private hash(value: string) { return `sha256:${createHash('sha256').update(value).digest('hex')}` }

  private toDatabaseArtifactType(type: Artifact['type']) {
    if (type === 'Trigger') return DatabaseArtifactType.APEX_TRIGGER
    if (type === 'LWC') return DatabaseArtifactType.LWC_BUNDLE
    if (type === 'Flow') return DatabaseArtifactType.FLOW
    if (type === 'Validation Rule') return DatabaseArtifactType.VALIDATION_RULE
    return DatabaseArtifactType.APEX_CLASS
  }

  private fromDatabaseArtifactType(type: DatabaseArtifactType): Artifact['type'] {
    if (type === DatabaseArtifactType.APEX_TRIGGER) return 'Trigger'
    if (type === DatabaseArtifactType.LWC_BUNDLE) return 'LWC'
    if (type === DatabaseArtifactType.FLOW) return 'Flow'
    if (type === DatabaseArtifactType.VALIDATION_RULE) return 'Validation Rule'
    return 'Apex Class'
  }

  private toArtifact(artifact: {
    id: string
    orgConnectionId: string
    salesforceMetadataId: string | null
    name: string
    type: DatabaseArtifactType
    namespace: string | null
    apiVersion: string | null
    salesforceModifiedAt: Date | null
    updatedAt: Date
    currentVersion: { contentHash: string } | null
  }): Artifact {
    return {
      id: artifact.id,
      orgConnectionId: artifact.orgConnectionId,
      salesforceMetadataId: artifact.salesforceMetadataId ?? artifact.id,
      name: artifact.name,
      type: this.fromDatabaseArtifactType(artifact.type),
      namespace: artifact.namespace,
      apiVersion: artifact.apiVersion ?? '',
      modifiedAt: (artifact.salesforceModifiedAt ?? artifact.updatedAt).toISOString(),
      contentHash: artifact.currentVersion?.contentHash ?? '',
    }
  }

  private toDomain(connection: {
    id: string
    workspaceId: string
    salesforceOrgId: string
    label: string
    username: string
    environment: OrgEnvironment
    instanceUrl: string
    status: OrgConnectionStatus
    lastDiscoveredAt: Date | null
  }): OrgConnection {
    return {
      id: connection.id,
      tenantId: connection.workspaceId,
      salesforceOrgId: connection.salesforceOrgId,
      label: connection.label,
      username: connection.username,
      environment: connection.environment === OrgEnvironment.SANDBOX ? 'sandbox' : 'production',
      instanceUrl: connection.instanceUrl,
      status: connection.status === OrgConnectionStatus.REAUTHORIZATION_REQUIRED ? 'reauthorization_required' : 'connected',
      lastDiscoveredAt: connection.lastDiscoveredAt?.toISOString() ?? null,
    }
  }
}
