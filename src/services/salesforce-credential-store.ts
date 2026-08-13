import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { config } from '../config.js'
import type { OrgEnvironment } from '../domain/types.js'
import type { PrismaClient } from '../generated/prisma/client.js'
import { OrgEnvironment as DatabaseOrgEnvironment } from '../generated/prisma/enums.js'
import { ApiError } from '../lib/errors.js'

export interface StoredTokens { accessToken: string; refreshToken?: string }
export interface PendingAuthorization { tenantId: string; userId: string; environment: OrgEnvironment; verifier: string }

class SecretCipher {
  private key() {
    if (!config.TOKEN_ENCRYPTION_KEY) throw new ApiError(503, 'TOKEN_ENCRYPTION_NOT_CONFIGURED', 'Salesforce token encryption is not configured.')
    return Buffer.from(config.TOKEN_ENCRYPTION_KEY, 'hex')
  }

  encrypt(value: string, purpose: string) {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv)
    cipher.setAAD(Buffer.from(purpose))
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
    return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`
  }

  decrypt(envelope: string, purpose: string) {
    const [version, ivValue, tagValue, ciphertextValue] = envelope.split('.')
    if (version !== 'v1' || !ivValue || !tagValue || !ciphertextValue) throw new ApiError(409, 'ENCRYPTED_CREDENTIAL_INVALID', 'The stored Salesforce credential is invalid. Reconnect the org.')
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key(), Buffer.from(ivValue, 'base64url'))
      decipher.setAAD(Buffer.from(purpose))
      decipher.setAuthTag(Buffer.from(tagValue, 'base64url'))
      return Buffer.concat([decipher.update(Buffer.from(ciphertextValue, 'base64url')), decipher.final()]).toString('utf8')
    } catch {
      throw new ApiError(409, 'ENCRYPTED_CREDENTIAL_INVALID', 'The stored Salesforce credential cannot be decrypted. Reconnect the org.')
    }
  }
}

export class SalesforceCredentialStore {
  private readonly cipher = new SecretCipher()
  constructor(private readonly database: PrismaClient) {}

  async saveAuthorization(state: string, pending: PendingAuthorization, expiresAt: Date) {
    const stateHash = this.hash(state)
    await this.database.oAuthAuthorizationState.deleteMany({ where: { expiresAt: { lt: new Date() } } })
    await this.database.oAuthAuthorizationState.create({ data: {
      stateHash,
      workspaceId: pending.tenantId,
      userId: pending.userId,
      environment: pending.environment === 'sandbox' ? DatabaseOrgEnvironment.SANDBOX : DatabaseOrgEnvironment.PRODUCTION,
      pkceVerifier: this.cipher.encrypt(pending.verifier, `oauth-state:${stateHash}`),
      expiresAt,
    } })
  }

  async consumeAuthorization(state: string, tenantId: string, userId: string): Promise<PendingAuthorization | undefined> {
    const stateHash = this.hash(state)
    const record = await this.database.oAuthAuthorizationState.findUnique({ where: { stateHash } })
    if (!record || record.workspaceId !== tenantId || record.userId !== userId || record.consumedAt || record.expiresAt <= new Date()) return undefined
    const consumed = await this.database.oAuthAuthorizationState.updateMany({ where: { id: record.id, consumedAt: null }, data: { consumedAt: new Date() } })
    if (consumed.count !== 1) return undefined
    return {
      tenantId: record.workspaceId,
      userId: record.userId,
      environment: record.environment === DatabaseOrgEnvironment.SANDBOX ? 'sandbox' : 'production',
      verifier: this.cipher.decrypt(record.pkceVerifier, `oauth-state:${stateHash}`),
    }
  }

  async saveTokens(connectionId: string, tokens: StoredTokens) {
    const existing = await this.database.orgOAuthToken.findUnique({ where: { orgConnectionId: connectionId } })
    const encryptedRefreshToken = tokens.refreshToken
      ? this.cipher.encrypt(tokens.refreshToken, `salesforce-refresh:${connectionId}`)
      : existing?.encryptedRefreshToken ?? null
    await this.database.orgOAuthToken.upsert({
      where: { orgConnectionId: connectionId },
      update: { encryptedAccessToken: this.cipher.encrypt(tokens.accessToken, `salesforce-access:${connectionId}`), encryptedRefreshToken, encryptionKeyVersion: 1 },
      create: { orgConnectionId: connectionId, encryptedAccessToken: this.cipher.encrypt(tokens.accessToken, `salesforce-access:${connectionId}`), encryptedRefreshToken, encryptionKeyVersion: 1 },
    })
  }

  async getTokens(connectionId: string): Promise<StoredTokens | undefined> {
    const record = await this.database.orgOAuthToken.findUnique({ where: { orgConnectionId: connectionId } })
    if (!record) return undefined
    return {
      accessToken: this.cipher.decrypt(record.encryptedAccessToken, `salesforce-access:${connectionId}`),
      ...(record.encryptedRefreshToken ? { refreshToken: this.cipher.decrypt(record.encryptedRefreshToken, `salesforce-refresh:${connectionId}`) } : {}),
    }
  }

  async deleteTokens(connectionId: string) {
    await this.database.orgOAuthToken.deleteMany({ where: { orgConnectionId: connectionId } })
  }

  private hash(value: string) { return createHash('sha256').update(value).digest('hex') }
}
