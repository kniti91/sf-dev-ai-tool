import type { Artifact, ComponentAnalysis, Finding, MetadataComponent, OrgConnection, Recommendation, Scan, ScanItem } from '../domain/types.js'
import type { VibeSafeRepository } from './vibesafe-repository.js'

const orgConnections: OrgConnection[] = [{
  id: 'org_acme_prod', tenantId: 'tenant_demo', salesforceOrgId: '00D5g000000ACME', label: 'Acme Production', username: 'architect@acme.com',
  environment: 'production', instanceUrl: 'https://acme.my.salesforce.com', status: 'connected', lastDiscoveredAt: new Date(Date.now() - 8 * 60_000).toISOString(),
}]

const artifacts: Artifact[] = [
  ['artifact_account_trigger', 'AccountTrigger', 'Trigger', '61.0'],
  ['artifact_account_handler', 'AccountTriggerHandler', 'Apex Class', '61.0'],
  ['artifact_opportunity_service', 'OpportunityService', 'Apex Class', '60.0'],
  ['artifact_health_panel', 'AccountHealthPanel', 'LWC', '61.0'],
  ['artifact_contact_trigger', 'ContactTrigger', 'Trigger', '59.0'],
  ['artifact_revenue_forecast', 'RevenueForecast', 'LWC', '61.0'],
].map(([id, name, type, apiVersion], index) => ({
  id: id!, orgConnectionId: 'org_acme_prod', salesforceMetadataId: id!, name: name!, type: type as Artifact['type'], namespace: null, apiVersion: apiVersion!,
  modifiedAt: new Date(Date.now() - index * 86_400_000).toISOString(), contentHash: `sha256:demo-${id}`,
}))

const scans: Scan[] = [{
  id: 'scan_baseline', tenantId: 'tenant_demo', requestedByUserId: 'user_demo', orgConnectionId: 'org_acme_prod', name: 'Production baseline', scope: 'supported',
  artifactIds: artifacts.map(({ id }) => id), status: 'completed', progress: { completed: 6, total: 6 },
  requestSnapshot: { scope: 'supported' }, selectedCounts: { APEX_CLASS: 2, APEX_TRIGGER: 2, LWC_BUNDLE: 2 }, reusedArtifactCount: 0,
  ruleSetVersion: '1.0.0', scorePolicyVersion: '1.0.0', score: 76,
  overallSummary: 'Demonstration analysis summary.',
  aiProvider: null, aiModel: null, promptVersion: null,
  createdAt: new Date(Date.now() - 86_400_000).toISOString(), completedAt: new Date(Date.now() - 86_380_000).toISOString(),
}]

const findings: Finding[] = [
  { id: 'finding_soql_loop', scanId: 'scan_baseline', artifactId: 'artifact_account_handler', ruleId: 'APEX-SOQL-LOOP', ruleVersion: '1.0.0', severity: 'critical', category: 'governor_limits', message: 'A SOQL operation is executed inside a loop.', evidence: 'Query expression is nested within the loop beginning on line 41.', lineStart: 42, lineEnd: 42, engine: 'salesforce-code-analyzer', confidence: 1, deterministic: true },
  { id: 'finding_crud_fls', scanId: 'scan_baseline', artifactId: 'artifact_opportunity_service', ruleId: 'APEX-CRUD-FLS', ruleVersion: '1.0.0', severity: 'high', category: 'security', message: 'Object access is not verified before the operation.', evidence: 'No supported CRUD/FLS check was found in the analyzed path.', lineStart: 87, lineEnd: 89, engine: 'vibesafe-custom', confidence: 0.9, deterministic: true },
]
const recommendations: Recommendation[] = []
const metadataComponents: MetadataComponent[] = []
const scanItems = new Map<string, ScanItem[]>()

export class MemoryVibeSafeRepository implements VibeSafeRepository {
  async listOrgConnections(tenantId: string) { return structuredClone(orgConnections.filter((org) => org.tenantId === tenantId)) }
  async getOrgConnection(id: string, tenantId: string) { return structuredClone(orgConnections.find((org) => org.id === id && org.tenantId === tenantId)) }
  async saveOrgConnection(connection: OrgConnection, connectedByUserId?: string) { void connectedByUserId; const index = orgConnections.findIndex((org) => org.id === connection.id); if (index >= 0) orgConnections[index] = connection; else orgConnections.push(connection); return structuredClone(connection) }
  async deleteOrgConnection(id: string, tenantId: string) { const index = orgConnections.findIndex((org) => org.id === id && org.tenantId === tenantId); if (index < 0) return false; orgConnections.splice(index, 1); return true }
  async listArtifacts(orgConnectionId: string) { return structuredClone(artifacts.filter((artifact) => artifact.orgConnectionId === orgConnectionId)) }
  async getArtifacts(ids: string[]) { return structuredClone(artifacts.filter((artifact) => ids.includes(artifact.id))) }
  async replaceArtifacts(orgConnectionId: string, replacements: Artifact[]) { for (let index = artifacts.length - 1; index >= 0; index--) if (artifacts[index]?.orgConnectionId === orgConnectionId) artifacts.splice(index, 1); artifacts.push(...replacements) }
  async replaceMetadataComponents(orgConnectionId: string, replacements: MetadataComponent[]) { for (let index = metadataComponents.length - 1; index >= 0; index--) if (metadataComponents[index]?.orgConnectionId === orgConnectionId) metadataComponents.splice(index, 1); metadataComponents.push(...structuredClone(replacements)) }
  async listMetadataComponents(orgConnectionId: string, type?: MetadataComponent['type']) { return structuredClone(metadataComponents.filter((component) => component.orgConnectionId === orgConnectionId && (!type || component.type === type))) }
  async recordArtifactVersion(artifactId: string, contentHash: string, sourceSizeBytes: number) { void sourceSizeBytes; const artifact = artifacts.find(({ id }) => id === artifactId); if (artifact) artifact.contentHash = contentHash }
  async listScans(tenantId: string, orgConnectionId?: string) { return structuredClone(scans.filter((scan) => scan.tenantId === tenantId && (!orgConnectionId || scan.orgConnectionId === orgConnectionId))) }
  async getScan(id: string, tenantId: string) { return structuredClone(scans.find((scan) => scan.id === id && scan.tenantId === tenantId)) }
  async saveScan(scan: Scan) { scans.unshift(scan); scanItems.set(scan.id, scan.artifactIds.map((artifactId) => { const artifact = artifacts.find(({ id }) => id === artifactId)!; return { artifactId, artifactName: artifact.name, artifactType: artifact.type, status: 'queued', score: null, errorCode: null, errorMessage: null, analysis: null } })); return structuredClone(scan) }
  async updateScan(id: string, update: Partial<Scan>) { const index = scans.findIndex((scan) => scan.id === id); if (index < 0) return undefined; scans[index] = { ...scans[index]!, ...update }; return structuredClone(scans[index]) }
  async reuseExistingAnalysisResults(scanId: string, artifactId?: string) { void scanId; void artifactId; return new Set<string>() }
  async listFindings(scanId?: string) { return structuredClone(scanId ? findings.filter((finding) => finding.scanId === scanId) : findings) }
  async getFinding(id: string) { return structuredClone(findings.find((finding) => finding.id === id)) }
  async replaceScanFindings(scanId: string, replacements: Finding[], analyzedArtifactIds: string[]) { void analyzedArtifactIds; for (let index = findings.length - 1; index >= 0; index--) if (findings[index]?.scanId === scanId) findings.splice(index, 1); findings.push(...replacements) }
  async saveComponentAnalysis(scanId: string, analysis: ComponentAnalysis, replacements: Finding[]) { findings.push(...replacements); const item = scanItems.get(scanId)?.find(({ artifactId }) => artifactId === analysis.artifactId); if (item) { item.status = 'completed'; item.score = analysis.combinedScore; item.analysis = analysis } }
  async failScanItem(scanId: string, artifactId: string, code: string, message: string) { const item = scanItems.get(scanId)?.find((value) => value.artifactId === artifactId); if (item) { item.status = 'failed'; item.errorCode = code; item.errorMessage = message } }
  async listScanItems(scanId: string) { return structuredClone(scanItems.get(scanId) ?? []) }
  async listRecommendations(findingId: string) { return structuredClone(recommendations.filter((recommendation) => recommendation.findingId === findingId)) }
  async saveRecommendation(recommendation: Recommendation) { const existing = recommendations.find((item) => item.findingId === recommendation.findingId && item.provider === recommendation.provider && item.model === recommendation.model && item.promptVersion === recommendation.promptVersion && item.inputHash === recommendation.inputHash); if (existing) return structuredClone(existing); recommendations.push(recommendation); return structuredClone(recommendation) }
}
