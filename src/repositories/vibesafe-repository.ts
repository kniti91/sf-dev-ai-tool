import type { Artifact, ComponentAnalysis, Finding, MetadataComponent, OrgConnection, Recommendation, Scan, ScanItem } from '../domain/types.js'

export interface VibeSafeRepository {
  listOrgConnections(tenantId: string): Promise<OrgConnection[]>
  getOrgConnection(id: string, tenantId: string): Promise<OrgConnection | undefined>
  saveOrgConnection(connection: OrgConnection, connectedByUserId?: string): Promise<OrgConnection>
  deleteOrgConnection(id: string, tenantId: string): Promise<boolean>
  listArtifacts(orgConnectionId: string): Promise<Artifact[]>
  getArtifacts(ids: string[]): Promise<Artifact[]>
  replaceArtifacts(orgConnectionId: string, artifacts: Artifact[]): Promise<void>
  replaceMetadataComponents(orgConnectionId: string, components: MetadataComponent[]): Promise<void>
  listMetadataComponents(orgConnectionId: string, type?: MetadataComponent['type']): Promise<MetadataComponent[]>
  recordArtifactVersion(artifactId: string, contentHash: string, sourceSizeBytes: number): Promise<void>
  listScans(tenantId: string, orgConnectionId?: string): Promise<Scan[]>
  getScan(id: string, tenantId: string): Promise<Scan | undefined>
  saveScan(scan: Scan): Promise<Scan>
  updateScan(id: string, update: Partial<Scan>): Promise<Scan | undefined>
  reuseExistingAnalysisResults(scanId: string, artifactId?: string): Promise<Set<string>>
  listFindings(scanId?: string): Promise<Finding[]>
  getFinding(id: string): Promise<Finding | undefined>
  replaceScanFindings(scanId: string, findings: Finding[], analyzedArtifactIds: string[]): Promise<void>
  saveComponentAnalysis(scanId: string, analysis: ComponentAnalysis, findings: Finding[]): Promise<void>
  failScanItem(scanId: string, artifactId: string, code: string, message: string): Promise<void>
  listScanItems(scanId: string): Promise<ScanItem[]>
  listRecommendations(findingId: string): Promise<Recommendation[]>
  saveRecommendation(recommendation: Recommendation): Promise<Recommendation>
}
