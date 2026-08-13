import { randomUUID } from 'node:crypto'
import type { Artifact, ComponentAnalysis, Finding, Severity } from '../domain/types.js'
import type { AiProvider } from './ai-provider.js'
import type { DeterministicAnalyzer, DeterministicViolation } from './code-analyzer-service.js'

interface RuleMatch { ruleId: string; severity: Severity; category: string; message: string; evidence: string; index: number }
const penalties: Record<Severity, number> = { critical: 15, high: 8, medium: 4, low: 1, informational: 0 }
const PROMPT_VERSION = 'salesforce-component-analysis-v1'

export class AnalysisService {
  constructor(private readonly provider?: AiProvider, private readonly deterministicAnalyzer?: DeterministicAnalyzer) {}

  async analyzeComponent(scanId: string, artifact: Artifact, source: string, precomputed?: DeterministicViolation[]): Promise<{ analysis: ComponentAnalysis; findings: Finding[] }> {
    const deterministic = precomputed ? this.toFindings(scanId, artifact.id, precomputed) : await this.deterministicFindings(scanId, artifact, source)
    const deterministicScore = this.score(deterministic)
    if (!this.provider) {
      return { analysis: { artifactId: artifact.id, deterministicScore, aiScore: null, combinedScore: deterministicScore, deterministicSummary: this.summary(deterministic, 'deterministic'), aiSummary: null, categoryScores: this.categoryScores(deterministic), requiresHumanReview: deterministic.some(({ severity }) => severity === 'critical'), aiProvider: null, aiModel: null, promptVersion: null }, findings: deterministic }
    }

    const output = await this.provider.analyzeComponent({ artifact, deterministicFindings: deterministic, source })
    const aiFindings: Finding[] = output.findings.map((finding) => ({
      id: randomUUID(), scanId, artifactId: artifact.id, ruleId: `AI-${finding.issueType.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-')}`,
      ruleVersion: PROMPT_VERSION, severity: finding.severity, category: finding.category, message: finding.title,
      evidence: finding.evidence, lineStart: finding.lineStart ?? 0, lineEnd: finding.lineEnd ?? finding.lineStart ?? 0,
      engine: this.provider!.name, confidence: finding.confidence, deterministic: false,
      suggestedRecommendation: finding.recommendation, proposedCode: finding.proposedCode, requiresHumanReview: finding.requiresHumanReview,
    }))
    const merged = this.mergeFindings(deterministic, aiFindings)
    const combinedScore = Math.round(deterministicScore * 0.6 + output.score * 0.4)
    return {
      analysis: {
        artifactId: artifact.id, deterministicScore, aiScore: output.score, combinedScore,
        deterministicSummary: this.summary(deterministic, 'deterministic'), aiSummary: output.summary,
        categoryScores: output.categoryScores, requiresHumanReview: output.requiresHumanReview || merged.some(({ requiresHumanReview }) => requiresHumanReview),
        aiProvider: this.provider.name, aiModel: this.provider.model, promptVersion: PROMPT_VERSION,
      },
      findings: merged,
    }
  }

  private async deterministicFindings(scanId: string, artifact: Artifact, source: string): Promise<Finding[]> {
    if (this.deterministicAnalyzer) {
      try {
        return this.toFindings(scanId, artifact.id, await this.deterministicAnalyzer.analyze(artifact, source))
      } catch (error) {
        console.warn(JSON.stringify({ level: 'warn', message: 'salesforce_code_analyzer_unavailable', artifactId: artifact.id, error: error instanceof Error ? error.message : 'Unknown analyzer error' }))
      }
    }
    return this.runFallbackRules(source, artifact.type).map((match): Finding => {
      const line = source.slice(0, match.index).split('\n').length
      return { id: randomUUID(), scanId, artifactId: artifact.id, ruleId: match.ruleId, ruleVersion: '1.0.0', severity: match.severity, category: match.category, message: match.message, evidence: match.evidence, lineStart: line, lineEnd: line, engine: 'vibesafe-custom', confidence: 0.85, deterministic: true }
    })
  }

  private toFindings(scanId: string, artifactId: string, violations: DeterministicViolation[]): Finding[] { return violations.map((violation) => ({ id: randomUUID(), scanId, artifactId, ...violation, deterministic: true })) }

  private mergeFindings(deterministic: Finding[], ai: Finding[]) {
    const result = [...deterministic]
    for (const candidate of ai) {
      const duplicate = deterministic.some((finding) => finding.category === candidate.category && Math.abs(finding.lineStart - candidate.lineStart) <= 2 && (this.issueKey(finding.ruleId) === this.issueKey(candidate.ruleId) || this.tokens(finding.message).some((token) => this.tokens(candidate.message).includes(token))))
      if (!duplicate) result.push(candidate)
    }
    return result
  }

  private tokens(value: string) { return value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 4) }
  private issueKey(value: string) { return value.replace(/^(?:APEX|LWC|AI)-/, '').replace(/[^A-Z0-9]/gi, '').toLowerCase() }
  private score(findings: Pick<Finding, 'severity'>[]) { return Math.max(0, 100 - findings.reduce((total, finding) => total + penalties[finding.severity], 0)) }
  private categoryScores(findings: Finding[]) { return Object.fromEntries(['security', 'governor_limits', 'performance', 'maintainability', 'reliability', 'testability'].map((category) => [category, this.score(findings.filter((finding) => finding.category === category))])) }
  private summary(findings: Finding[], kind: string) { return findings.length ? `${findings.length} ${kind} finding${findings.length === 1 ? '' : 's'} identified.` : `No ${kind} findings identified.` }

  private runFallbackRules(source: string, type: Artifact['type']): RuleMatch[] {
    const results: RuleMatch[] = []
    const add = (pattern: RegExp, ruleId: string, severity: Severity, category: string, message: string) => { for (const match of source.matchAll(pattern)) results.push({ ruleId, severity, category, message, evidence: `${ruleId} matched at the reported source location. Source text was not retained.`, index: match.index ?? 0 }) }
    if (type === 'Apex Class' || type === 'Trigger') {
      add(/['"](?:001|003|005|006|00Q|500)[A-Za-z0-9]{12,15}['"]/g, 'APEX-HARDCODED-ID', 'medium', 'maintainability', 'Source contains a likely hardcoded Salesforce record ID.')
      add(/catch\s*\([^)]*\)\s*\{\s*\}/g, 'APEX-EMPTY-CATCH', 'medium', 'reliability', 'An exception is swallowed by an empty catch block.')
      add(/\bwithout\s+sharing\b/gi, 'APEX-SHARING', 'high', 'security', 'The class explicitly runs without record-sharing enforcement.')
      add(/\bSystem\.debug\s*\(/gi, 'APEX-DEBUG-STATEMENT', 'low', 'maintainability', 'A System.debug statement should be removed or replaced with controlled logging.')
    } else if (type === 'LWC') {
      add(/\binnerHTML\s*=/g, 'LWC-UNSAFE-DOM', 'high', 'security', 'Direct innerHTML assignment can introduce unsafe DOM content.')
      add(/\bconsole\.(?:log|debug|info)\s*\(/g, 'LWC-CONSOLE', 'low', 'maintainability', 'Component contains unmanaged console output.')
    } else if (type === 'Flow') {
      add(/"faultConnector"\s*:\s*null/g, 'FLOW-MISSING-FAULT-PATH', 'medium', 'reliability', 'A Flow operation does not define a fault path.')
      add(/"processType"\s*:\s*"AutoLaunchedFlow"/g, 'FLOW-AUTOLAUNCHED-REVIEW', 'informational', 'maintainability', 'Autolaunched Flow behavior should be reviewed for entry conditions and recursion controls.')
      add(/"loops"\s*:/g, 'FLOW-LOOP-REVIEW', 'low', 'performance', 'Flow contains loop logic that should be reviewed for database operations and collection handling.')
    } else if (type === 'Validation Rule') {
      add(/(?:001|003|005|006|00Q|500)[A-Za-z0-9]{12,15}/g, 'VALIDATION-HARDCODED-ID', 'high', 'maintainability', 'Validation formula contains a likely hardcoded Salesforce record ID.')
      add(/\$Profile\.Name|\$UserRole\.Name/g, 'VALIDATION-NAME-BASED-BYPASS', 'medium', 'security', 'Validation bypass depends on a mutable profile or role name.')
      add(/Formula:\s*.{1000,}/gs, 'VALIDATION-COMPLEX-FORMULA', 'medium', 'maintainability', 'Validation formula is unusually large and should be decomposed or documented.')
    }
    return results
  }
}
