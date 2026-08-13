import { randomBytes, randomUUID } from 'node:crypto'
import type { PrismaClient } from '../generated/prisma/client.js'
import { WorkspaceRole } from '../generated/prisma/enums.js'
import { ApiError } from '../lib/errors.js'
import { hashPassword, hashSessionToken, sessionLifetimeMs, verifyPassword, type AuthResult, type AuthService, type PublicUser } from './auth-service.js'

export class PrismaAuthService implements AuthService {
  constructor(private readonly database: PrismaClient) {}

  async signup(email: string, password: string, displayName: string): Promise<AuthResult> {
    const normalizedEmail = email.trim().toLowerCase()
    if (await this.database.user.findUnique({ where: { email: normalizedEmail }, select: { id: true } })) {
      throw new ApiError(409, 'EMAIL_ALREADY_REGISTERED', 'An account already exists for this email address.')
    }
    const rawToken = randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + sessionLifetimeMs)
    try {
      const identity = await this.database.$transaction(async (transaction) => {
        const user = await transaction.user.create({ data: { email: normalizedEmail, displayName: displayName.trim(), passwordHash: await hashPassword(password) } })
        const workspace = await transaction.workspace.create({ data: { name: `${user.displayName}'s workspace` } })
        await transaction.workspaceMembership.create({ data: { userId: user.id, workspaceId: workspace.id, role: WorkspaceRole.OWNER } })
        await transaction.session.create({ data: { userId: user.id, tokenHash: hashSessionToken(rawToken), expiresAt } })
        return { user: this.toPublic(user), tenantId: workspace.id }
      })
      return { token: rawToken, ...identity }
    } catch (error) {
      if (await this.database.user.findUnique({ where: { email: normalizedEmail }, select: { id: true } })) {
        throw new ApiError(409, 'EMAIL_ALREADY_REGISTERED', 'An account already exists for this email address.')
      }
      throw error
    }
  }

  async login(email: string, password: string): Promise<AuthResult> {
    const user = await this.database.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      include: { memberships: { orderBy: { createdAt: 'asc' }, take: 1 } },
    })
    if (!user || !await verifyPassword(password, user.passwordHash)) throw new ApiError(401, 'INVALID_CREDENTIALS', 'The email address or password is incorrect.')
    const membership = user.memberships[0]
    if (!membership) throw new ApiError(409, 'WORKSPACE_MEMBERSHIP_REQUIRED', 'This account is not assigned to a workspace.')
    return this.createSession(user, membership.workspaceId)
  }

  async bypassLogin(identifier: string): Promise<AuthResult> {
    const normalized = identifier.trim().toLowerCase() || `developer-${randomUUID()}@local.test`
    let user = await this.database.user.findUnique({ where: { email: normalized }, include: { memberships: { take: 1 } } })
    if (!user) {
      await this.database.$transaction(async (transaction) => {
        const created = await transaction.user.create({ data: { email: normalized, displayName: identifier.trim() || 'VibeSafe Developer', passwordHash: await hashPassword(randomBytes(32).toString('base64url')) } })
        const workspace = await transaction.workspace.create({ data: { name: `${created.displayName}'s workspace` } })
        await transaction.workspaceMembership.create({ data: { userId: created.id, workspaceId: workspace.id, role: WorkspaceRole.OWNER } })
      })
      user = await this.database.user.findUniqueOrThrow({ where: { email: normalized }, include: { memberships: { take: 1 } } })
    }
    const membership = user.memberships[0]
    if (!membership) throw new ApiError(409, 'WORKSPACE_MEMBERSHIP_REQUIRED', 'This account is not assigned to a workspace.')
    return this.createSession(user, membership.workspaceId)
  }

  async authenticate(token: string | undefined) {
    if (!token) return undefined
    const tokenHash = hashSessionToken(token)
    const session = await this.database.session.findUnique({
      where: { tokenHash },
      include: { user: { include: { memberships: { orderBy: { createdAt: 'asc' }, take: 1 } } } },
    })
    if (!session) return undefined
    if (session.expiresAt <= new Date()) { await this.database.session.delete({ where: { id: session.id } }); return undefined }
    const membership = session.user.memberships[0]
    return membership ? { user: this.toPublic(session.user), tenantId: membership.workspaceId } : undefined
  }

  async developmentIdentity() {
    const user = await this.database.user.upsert({
      where: { email: 'developer@local.test' },
      update: {},
      create: { id: 'user_development', email: 'developer@local.test', displayName: 'VibeSafe Developer', passwordHash: '' },
    })
    const workspace = await this.database.workspace.upsert({ where: { id: 'tenant_development' }, update: {}, create: { id: 'tenant_development', name: 'VibeSafe Development Workspace' } })
    await this.database.workspaceMembership.upsert({
      where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } },
      update: {},
      create: { workspaceId: workspace.id, userId: user.id, role: WorkspaceRole.OWNER },
    })
    return { user: this.toPublic(user), tenantId: workspace.id }
  }

  async logout(token: string | undefined) {
    if (token) await this.database.session.deleteMany({ where: { tokenHash: hashSessionToken(token) } })
  }

  async requestPasswordReset(email: string) { void email }

  private async createSession(user: PublicUser, tenantId: string): Promise<AuthResult> {
    const token = randomBytes(32).toString('base64url')
    await this.database.session.create({ data: { userId: user.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + sessionLifetimeMs) } })
    return { token, user: this.toPublic(user), tenantId }
  }

  private toPublic({ id, email, displayName }: PublicUser): PublicUser { return { id, email, displayName } }
}
