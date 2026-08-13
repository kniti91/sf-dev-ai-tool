import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import type { Artifact, Severity } from '../domain/types.js'
import { config } from '../config.js'

export interface DeterministicViolation { ruleId: string; ruleVersion: string; severity: Severity; category: string; message: string; evidence: string; lineStart: number; lineEnd: number; engine: string; confidence: number }
export interface DeterministicAnalyzer { analyze(artifact: Artifact, source: string): Promise<DeterministicViolation[]> }
export interface BatchDeterministicAnalyzer extends DeterministicAnalyzer { analyzeBatch(artifacts: Artifact[], sources: ReadonlyMap<string, string>): Promise<Map<string, DeterministicViolation[]>> }
interface AnalyzerLocation { file: string; startLine: number; endLine: number }
export interface AnalyzerViolation { rule: string; engine: string; severity: number; tags: string[]; primaryLocationIndex: number; locations: AnalyzerLocation[]; message: string; resources?: string[] }
export interface AnalyzerOutput { versions?: Record<string, string>; violations: AnalyzerViolation[] }

export function normalizeAnalyzerOutput(result: AnalyzerOutput): DeterministicViolation[] {
  const version = result.versions?.['code-analyzer'] ?? 'v5'
  const normalized = result.violations.map((violation) => {
    const location = violation.locations[violation.primaryLocationIndex] ?? violation.locations[0]
    return {
      ruleId: `SFCA-${violation.engine.toUpperCase()}-${violation.rule}`, ruleVersion: version,
      severity: analyzerSeverity(violation.severity), category: analyzerCategory(violation.tags, violation.rule), message: violation.message,
      evidence: `${violation.rule} was reported by Salesforce Code Analyzer.${violation.resources?.[0] ? ` Reference: ${violation.resources[0]}` : ''}`,
      lineStart: location?.startLine ?? 0, lineEnd: location?.endLine ?? location?.startLine ?? 0,
      engine: `salesforce-code-analyzer:${violation.engine}`, confidence: 1,
    }
  })
  return normalized.filter((finding, index, values) => !(finding.ruleId.endsWith('DebugsShouldUseLoggingLevel') && values.some((candidate, candidateIndex) => candidateIndex !== index && candidate.lineStart === finding.lineStart && candidate.ruleId.endsWith('AvoidDebugStatements'))))
}

function analyzerSeverity(value: number): Severity { return value <= 1 ? 'critical' : value === 2 ? 'high' : value === 3 ? 'medium' : value === 4 ? 'low' : 'informational' }
function analyzerCategory(tags: string[], rule: string) { if (/limitsinloop|soql.*loop|dml.*loop/i.test(rule)) return 'governor_limits'; const values = new Set(tags.map((tag) => tag.toLowerCase())); if (values.has('security')) return 'security'; if (values.has('performance')) return 'performance'; if (values.has('errorprone')) return 'reliability'; if (values.has('design') || values.has('bestpractices') || values.has('codestyle')) return 'maintainability'; return 'maintainability' }

export class SalesforceCodeAnalyzer implements BatchDeterministicAnalyzer {
  async analyze(artifact: Artifact, source: string) {
    return (await this.analyzeBatch([artifact], new Map([[artifact.id, source]]))).get(artifact.id) ?? []
  }

  async analyzeBatch(artifacts: Artifact[], sources: ReadonlyMap<string, string>) {
    const empty = new Map(artifacts.map(({ id }) => [id, [] as DeterministicViolation[]]))
    if (!config.SALESFORCE_CODE_ANALYZER_ENABLED) return empty
    const root = await mkdtemp(join(tmpdir(), 'vibesafe-code-analyzer-'))
    const workspace = join(root, 'workspace')
    const output = join(root, 'results.json')
    try {
      await mkdir(workspace)
      const pathOwners = new Map<string, string>()
      for (let index = 0; index < artifacts.length; index++) {
        const artifact = artifacts[index]!
        const source = sources.get(artifact.id)
        if (source === undefined) continue
        const folder = `component-${String(index + 1).padStart(5, '0')}`
        for (const file of await this.writeWorkspace(join(workspace, folder), artifact, source)) pathOwners.set(`${folder}/${file}`.toLowerCase(), artifact.id)
      }
      await this.execute(['code-analyzer', 'run', '--workspace', workspace, '--rule-selector', 'Recommended', '--output-file', output], root)
      const result = JSON.parse(await readFile(output, 'utf8')) as AnalyzerOutput
      for (const violation of result.violations) {
        const location = violation.locations[violation.primaryLocationIndex] ?? violation.locations[0]
        const normalizedPath = (location?.file ?? '').replaceAll('\\', '/').toLowerCase()
        const owner = [...pathOwners].find(([path]) => normalizedPath.endsWith(path))?.[1]
        if (!owner) continue
        empty.set(owner, [...(empty.get(owner) ?? []), ...normalizeAnalyzerOutput({ ...(result.versions ? { versions: result.versions } : {}), violations: [violation] })])
      }
      for (const [artifactId, findings] of empty) empty.set(artifactId, this.dedupe(findings))
      return empty
    } finally {
      const resolved = resolve(root)
      const allowedRoot = resolve(tmpdir()) + sep
      if (resolved.startsWith(allowedRoot) && basename(resolved).startsWith('vibesafe-code-analyzer-')) await rm(resolved, { recursive: true, force: true })
    }
  }

  private async writeWorkspace(workspace: string, artifact: Artifact, source: string) {
    await mkdir(workspace, { recursive: true })
    const files: string[] = []
    if (artifact.type === 'LWC') {
      const sections = source.split(/^\/\/ (.+)$/gm)
      if (sections.length > 1) {
        for (let index = 1; index < sections.length; index += 2) {
          const originalPath = sections[index] ?? ''
          const content = sections[index + 1] ?? ''
          const safeName = basename(originalPath).replace(/[^a-zA-Z0-9._-]/g, '_')
          if (safeName) { await writeFile(join(workspace, safeName), content.trimStart(), 'utf8'); files.push(safeName) }
        }
        return files
      }
    }
    const extension = artifact.type === 'Trigger' ? '.trigger' : artifact.type === 'Apex Class' ? '.cls' : '.js'
    const safeName = artifact.name.replace(/[^a-zA-Z0-9_-]/g, '_') || 'component'
    const file = `${safeName}${extension}`
    await writeFile(join(workspace, file), source, 'utf8')
    return [file]
  }

  private execute(args: string[], cwd: string) {
    return new Promise<void>((resolvePromise, reject) => {
      const child = spawn(config.SALESFORCE_CODE_ANALYZER_COMMAND, args, { cwd, shell: process.platform === 'win32', windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
      let stderr = ''
      child.stderr.on('data', (chunk: Buffer) => { if (stderr.length < 4_000) stderr += chunk.toString() })
      const timeout = setTimeout(() => { child.kill(); reject(new Error('Salesforce Code Analyzer timed out.')) }, config.SALESFORCE_CODE_ANALYZER_TIMEOUT_MS)
      child.once('error', (error) => { clearTimeout(timeout); reject(error) })
      child.once('exit', (code) => { clearTimeout(timeout); if (code === 0 || code === 1) resolvePromise(); else reject(new Error(`Salesforce Code Analyzer exited with code ${code}: ${stderr.slice(-1_000)}`)) })
    })
  }

  private dedupe(findings: DeterministicViolation[]) {
    return findings.filter((finding, index, values) => !(finding.ruleId.endsWith('DebugsShouldUseLoggingLevel') && values.some((candidate, candidateIndex) => candidateIndex !== index && candidate.lineStart === finding.lineStart && candidate.ruleId.endsWith('AvoidDebugStatements'))))
  }

}
