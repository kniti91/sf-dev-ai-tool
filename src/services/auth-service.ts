import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { ApiError } from '../lib/errors.js'

const scrypt = promisify(scryptCallback)
const sessionLifetimeMs = 7 * 24 * 60 * 60 * 1000

export interface PublicUser { id: string; email: string; displayName: string }
export interface AuthIdentity { user: PublicUser; tenantId: string }
export interface AuthResult extends AuthIdentity { token: string }

export interface AuthService {
  signup(email: string, password: string, displayName: string): Promise<AuthResult>
  login(email: string, password: string): Promise<AuthResult>
  bypassLogin(identifier: string): Promise<AuthResult>
  authenticate(token: string | undefined): Promise<AuthIdentity | undefined>
  developmentIdentity(): Promise<AuthIdentity>
  logout(token: string | undefined): Promise<void>
  requestPasswordReset(email: string): Promise<void>
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex')
  const derived = await scrypt(password, salt, 64) as Buffer
  return `${salt}:${derived.toString('hex')}`
}

export async function verifyPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const derived = await scrypt(password, salt, 64) as Buffer
  const expected = Buffer.from(hash, 'hex')
  return expected.length === derived.length && timingSafeEqual(expected, derived)
}

export function hashSessionToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

interface MemoryUser extends PublicUser { passwordHash: string; tenantId: string }
interface MemorySession { userId: string; expiresAt: number }

export class MemoryAuthService implements AuthService {
  private readonly users = new Map<string, MemoryUser>()
  private readonly sessions = new Map<string, MemorySession>()

  async signup(email: string, password: string, displayName: string) {
    const normalizedEmail = email.trim().toLowerCase()
    if (this.users.has(normalizedEmail)) throw new ApiError(409, 'EMAIL_ALREADY_REGISTERED', 'An account already exists for this email address.')
    const user: MemoryUser = { id: randomUUID(), email: normalizedEmail, displayName: displayName.trim(), passwordHash: await hashPassword(password), tenantId: randomUUID() }
    this.users.set(normalizedEmail, user)
    return this.createSession(user)
  }

  async login(email: string, password: string) {
    const user = this.users.get(email.trim().toLowerCase())
    if (!user || !await verifyPassword(password, user.passwordHash)) throw new ApiError(401, 'INVALID_CREDENTIALS', 'The email address or password is incorrect.')
    return this.createSession(user)
  }

  async bypassLogin(identifier: string) {
    const normalized = identifier.trim().toLowerCase() || `developer-${randomUUID()}@local.test`
    let user = this.users.get(normalized)
    if (!user) {
      user = { id: randomUUID(), email: normalized, displayName: identifier.trim() || 'VibeSafe Developer', passwordHash: '', tenantId: 'tenant_development' }
      this.users.set(normalized, user)
    }
    return this.createSession(user)
  }

  async authenticate(token: string | undefined) {
    if (!token) return undefined
    const session = this.sessions.get(token)
    if (!session || session.expiresAt <= Date.now()) { if (session) this.sessions.delete(token); return undefined }
    const user = [...this.users.values()].find(({ id }) => id === session.userId)
    return user ? { user: this.toPublic(user), tenantId: user.tenantId } : undefined
  }

  async developmentIdentity() {
    return { user: { id: 'user_development', email: 'developer@local.test', displayName: 'VibeSafe Developer' }, tenantId: 'tenant_development' }
  }

  async logout(token: string | undefined) { if (token) this.sessions.delete(token) }
  async requestPasswordReset(email: string) { void email }

  private createSession(user: MemoryUser) {
    const token = randomBytes(32).toString('base64url')
    this.sessions.set(token, { userId: user.id, expiresAt: Date.now() + sessionLifetimeMs })
    return { token, user: this.toPublic(user), tenantId: user.tenantId }
  }

  private toPublic({ id, email, displayName }: MemoryUser): PublicUser { return { id, email, displayName } }
}

export { sessionLifetimeMs }
