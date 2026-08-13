export type OrgEnvironment = 'production' | 'sandbox'
export type ArtifactType = 'Apex Class' | 'Trigger' | 'LWC' | 'Flow' | 'Validation Rule'
export type ScanStatus = 'queued' | 'running' | 'partial' | 'completed' | 'cancelled' | 'failed'
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'informational'
export type MetadataComponentType = 'Object' | 'Field' | 'Flow' | 'Validation Rule' | 'Profile' | 'Permission Set' | 'Sharing Setting'
export type DiscoverComponentType = ArtifactType | MetadataComponentType

export interface OrgConnection {
  id: string
  tenantId: string
  salesforceOrgId: string
  label: string
  username: string
  environment: OrgEnvironment
  instanceUrl: string
  status: 'connected' | 'reauthorization_required'
  lastDiscoveredAt: string | null
}

export interface Artifact {
  id: string
  orgConnectionId: string
  salesforceMetadataId: string
  name: string
  type: ArtifactType
  namespace: string | null
  apiVersion: string
  modifiedAt: string
  contentHash: string
}

export interface MetadataComponent {
  id: string
  orgConnectionId: string
  identityKey: string
  salesforceMetadataId: string | null
  type: MetadataComponentType
  name: string
  label: string | null
  namespace: string | null
  parentIdentityKey: string | null
  active: boolean | null
  attributes: Record<string, unknown>
  modifiedAt: string | null
}

export interface Scan {
  id: string
  tenantId: string
  requestedByUserId: string
  orgConnectionId: string
  name: string
  scope: 'selected' | 'supported'
  artifactIds: string[]
  requestSnapshot: unknown
  selectedCounts: unknown
  status: ScanStatus
  progress: { completed: number; total: number; stage?: 'queued' | 'retrieving' | 'static_analysis' | 'ai_analysis' | 'finalizing' | 'completed' | 'failed'; currentBatch?: number; totalBatches?: number; failed?: number }
  reusedArtifactCount: number
  ruleSetVersion: string
  scorePolicyVersion: string
  score: number | null
  overallSummary: string | null
  aiProvider: string | null
  aiModel: string | null
  promptVersion: string | null
  createdAt: string
  completedAt: string | null
}

export interface Finding {
  id: string
  scanId: string
  artifactId: string
  ruleId: string
  ruleVersion: string
  severity: Severity
  category: string
  message: string
  evidence: string
  lineStart: number
  lineEnd: number
  engine: string
  confidence: number
  deterministic: boolean
  suggestedRecommendation?: string
  proposedCode?: string | null
  requiresHumanReview?: boolean
}

export interface ComponentAnalysis {
  artifactId: string
  deterministicScore: number
  aiScore: number | null
  combinedScore: number
  deterministicSummary: string
  aiSummary: string | null
  categoryScores: Record<string, number>
  requiresHumanReview: boolean
  aiProvider: string | null
  aiModel: string | null
  promptVersion: string | null
}

export interface ScanItem {
  artifactId: string
  artifactName: string
  artifactType: ArtifactType
  status: 'queued' | 'running' | 'reused' | 'completed' | 'skipped' | 'failed'
  score: number | null
  errorCode: string | null
  errorMessage: string | null
  analysis: ComponentAnalysis | null
}

export interface Recommendation {
  id: string
  findingId: string
  provider: string
  model: string
  promptVersion: string
  content: string
  proposedCode: string | null
  confidence: number | null
  inputHash: string
  createdAt: string
}
