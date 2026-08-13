import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { config } from '../config.js'
import { prisma } from '../database/prisma.js'
import type { Artifact, ArtifactType, DiscoverComponentType, MetadataComponent, MetadataComponentType, OrgConnection, OrgEnvironment } from '../domain/types.js'
import type { PrismaClient } from '../generated/prisma/client.js'
import { ApiError } from '../lib/errors.js'
import type { VibeSafeRepository } from '../repositories/vibesafe-repository.js'
import { SalesforceCredentialStore, type StoredTokens } from './salesforce-credential-store.js'

interface TokenResponse { access_token: string; refresh_token?: string; instance_url: string; id: string; token_type: string }
interface OAuthErrorResponse { error?: string; error_description?: string }
interface IdentityResponse { organization_id: string; username: string; display_name?: string }
interface ToolingQuery<T> { records: T[]; done: boolean; nextRecordsUrl?: string }
interface ApexRecord { Id: string; Name: string; NamespacePrefix: string | null; ApiVersion: number; LastModifiedDate: string; Body?: string }
interface ApexSourceRecord { Id: string; Body: string }
interface BundleRecord { Id: string; DeveloperName: string; NamespacePrefix: string | null; ApiVersion: number; LastModifiedDate: string }
interface ResourceRecord { LightningComponentBundleId: string; FilePath: string; Source: string }
interface EntityDefinitionRecord { DurableId: string; QualifiedApiName: string; Label: string; NamespacePrefix: string | null; IsCustomizable: boolean; IsCustomSetting: boolean; InternalSharingModel: string | null; ExternalSharingModel: string | null }
interface FieldDefinitionRecord { DurableId: string; QualifiedApiName: string; Label: string; DataType: string; EntityDefinition: { QualifiedApiName: string }; IsNillable: boolean; IsCalculated: boolean }
interface FlowDefinitionRecord { DurableId: string; ApiName: string; Label: string; NamespacePrefix: string | null; ProcessType: string; TriggerType: string | null; IsActive: boolean; ActiveVersionId: string | null; LatestVersionId: string | null; LastModifiedDate: string | null }
interface ValidationRuleRecord { Id: string; ValidationName: string; Active: boolean; EntityDefinition: { QualifiedApiName: string }; Description: string | null; ErrorDisplayField: string | null; LastModifiedDate: string; NamespacePrefix: string | null }
interface ValidationRuleSourceRecord { Id: string; ErrorConditionFormula: string; ErrorMessage: string }
interface FlowSourceRecord { Id: string; Metadata: unknown }
interface PermissionSetRecord { Id: string; Name: string; Label: string; IsOwnedByProfile: boolean; ProfileId: string | null; Profile: { Name: string } | null; License: { Name: string } | null; NamespacePrefix: string | null; PermissionsModifyAllData: boolean; PermissionsViewAllData: boolean; PermissionsManageUsers: boolean; PermissionsAuthorApex: boolean; PermissionsCustomizeApplication: boolean }
interface ToolingCreateResponse { id?: string; success?: boolean; errors?: unknown[] }
interface ContainerRequestRecord { State: string; ErrorMsg?: string | null; DeployDetails?: unknown }
interface CompilerErrorRecord { CompilerErrors?: string | null }

export class SalesforceOAuthService {
  private readonly credentialStore: SalesforceCredentialStore
  constructor(private readonly repository: VibeSafeRepository, database: PrismaClient = prisma) { this.credentialStore = new SalesforceCredentialStore(database) }

  async start(tenantId: string, userId: string, environment: OrgEnvironment) {
    this.requireConfiguration()
    const state = randomBytes(32).toString('base64url'); const verifier = randomBytes(64).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    await this.credentialStore.saveAuthorization(state, { tenantId, userId, environment, verifier }, new Date(Date.now() + 10 * 60_000))
    const url = new URL('/services/oauth2/authorize', this.loginOrigin(environment))
    url.search = new URLSearchParams({ response_type: 'code', client_id: config.SALESFORCE_CLIENT_ID!, redirect_uri: config.SALESFORCE_REDIRECT_URI, scope: 'api refresh_token id', state, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'login consent', display: 'popup' }).toString()
    return { authorizationUrl: url.toString(), state }
  }

  async complete(state: string, code: string, tenantId: string, userId: string): Promise<OrgConnection> {
    this.requireConfiguration()
    const pending = await this.credentialStore.consumeAuthorization(state, tenantId, userId)
    if (!pending) {
      console.warn(JSON.stringify({ level: 'warn', message: 'salesforce_oauth_state_invalid', tenantId, userId }))
      throw new ApiError(400, 'OAUTH_STATE_INVALID', 'The Salesforce authorization request is invalid or expired.')
    }
    const tokenResponse = await fetch(new URL('/services/oauth2/token', this.loginOrigin(pending.environment)), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: this.tokenParameters({ grant_type: 'authorization_code', code, redirect_uri: config.SALESFORCE_REDIRECT_URI, code_verifier: pending.verifier }) })
    if (!tokenResponse.ok) {
      const providerError = await tokenResponse.json().catch(() => ({})) as OAuthErrorResponse
      const description = providerError.error_description?.trim() || providerError.error?.trim() || 'Salesforce rejected the token request.'
      console.error(JSON.stringify({
        level: 'error',
        message: 'salesforce_token_exchange_failed',
        providerStatus: tokenResponse.status,
        providerError: providerError.error,
        providerErrorDescription: providerError.error_description,
        loginOrigin: this.loginOrigin(pending.environment),
        redirectUri: config.SALESFORCE_REDIRECT_URI,
        clientIdLength: config.SALESFORCE_CLIENT_ID?.length,
        clientSecretConfigured: Boolean(config.SALESFORCE_CLIENT_SECRET),
      }))
      throw new ApiError(502, 'SALESFORCE_TOKEN_EXCHANGE_FAILED', `Salesforce token exchange failed: ${description}`, { providerStatus: tokenResponse.status, providerError: providerError.error })
    }
    const tokens = await tokenResponse.json() as TokenResponse
    this.validateSalesforceUrl(tokens.instance_url); this.validateSalesforceUrl(tokens.id)
    const identityResponse = await fetch(tokens.id, { headers: { authorization: `Bearer ${tokens.access_token}` } })
    if (!identityResponse.ok) throw new ApiError(502, 'SALESFORCE_IDENTITY_FAILED', 'Unable to retrieve Salesforce organization identity.')
    const identity = await identityResponse.json() as IdentityResponse
    const id = randomUUID()
    const connection: OrgConnection = { id, tenantId, salesforceOrgId: identity.organization_id, label: identity.display_name || identity.username, username: identity.username, environment: pending.environment, instanceUrl: tokens.instance_url, status: 'connected', lastDiscoveredAt: null }
    const storedConnection = await this.repository.saveOrgConnection(connection, userId)
    await this.credentialStore.saveTokens(storedConnection.id, { accessToken: tokens.access_token, ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}) })
    return storedConnection
  }

  async disconnect(id: string, tenantId: string) {
    const connection = await this.repository.getOrgConnection(id, tenantId)
    if (!connection) throw new ApiError(404, 'ORG_CONNECTION_NOT_FOUND', 'The Salesforce organization connection was not found.')
    const tokens = await this.credentialStore.getTokens(id)
    if (tokens) { const token = tokens.refreshToken ?? tokens.accessToken; await fetch(`${this.loginOrigin(connection.environment)}/services/oauth2/revoke`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }) }).catch(() => undefined) }
    await this.credentialStore.deleteTokens(id); await this.repository.deleteOrgConnection(id, tenantId)
  }

  async discover(connectionId: string, tenantId: string, requestedTypes: DiscoverComponentType[] = this.allDiscoverTypes()) {
    const sourceTypes = requestedTypes.filter((type): type is ArtifactType => type === 'Apex Class' || type === 'Trigger' || type === 'LWC')
    const metadataTypes = requestedTypes.filter((type): type is MetadataComponentType => !sourceTypes.includes(type as ArtifactType))
    const artifacts = sourceTypes.length ? await this.listComponents(connectionId, tenantId, sourceTypes) : await this.repository.listArtifacts(connectionId)
    const metadata = metadataTypes.length ? await this.discoverMetadataInventory(connectionId, tenantId, metadataTypes) : await this.repository.listMetadataComponents(connectionId)
    return { total: artifacts.length + metadata.length, sourceComponents: artifacts.length, apexClasses: artifacts.filter(({ type }) => type === 'Apex Class').length, triggers: artifacts.filter(({ type }) => type === 'Trigger').length, lwcBundles: artifacts.filter(({ type }) => type === 'LWC').length, objects: metadata.filter(({ type }) => type === 'Object').length, fields: metadata.filter(({ type }) => type === 'Field').length, flows: metadata.filter(({ type }) => type === 'Flow').length, validationRules: metadata.filter(({ type }) => type === 'Validation Rule').length, profiles: metadata.filter(({ type }) => type === 'Profile').length, permissionSets: metadata.filter(({ type }) => type === 'Permission Set').length, sharingSettings: metadata.filter(({ type }) => type === 'Sharing Setting').length }
  }

  async discoverMetadataInventory(connectionId: string, tenantId: string, requestedTypes: MetadataComponentType[] = ['Object', 'Field', 'Flow', 'Validation Rule', 'Profile', 'Permission Set', 'Sharing Setting']) {
    const connection = await this.repository.getOrgConnection(connectionId, tenantId)
    if (!connection) throw new ApiError(404, 'ORG_CONNECTION_NOT_FOUND', 'The Salesforce organization connection was not found.')
    const selected = new Set(requestedTypes)
    const needsObjects = selected.has('Object') || selected.has('Field') || selected.has('Sharing Setting')
    const objects = needsObjects ? await this.toolingQuery<EntityDefinitionRecord>(connection, 'SELECT DurableId, QualifiedApiName, Label, NamespacePrefix, IsCustomizable, IsCustomSetting, InternalSharingModel, ExternalSharingModel FROM EntityDefinition WHERE IsCustomizable = true') : []
    const fields: FieldDefinitionRecord[] = []
    for (const objectBatch of selected.has('Field') ? this.batches(objects, 10) : []) {
      const fieldPages = await Promise.all(objectBatch.map(({ DurableId }) =>
        this.toolingQuery<FieldDefinitionRecord>(connection, `SELECT DurableId, QualifiedApiName, Label, DataType, EntityDefinition.QualifiedApiName, IsNillable, IsCalculated FROM FieldDefinition WHERE EntityDefinitionId = '${this.soqlString(DurableId)}' LIMIT 2000`),
      ))
      fields.push(...fieldPages.flat())
    }
    const flows = selected.has('Flow') ? await this.dataQuery<FlowDefinitionRecord>(connection, 'SELECT DurableId, ApiName, Label, NamespacePrefix, ProcessType, TriggerType, IsActive, ActiveVersionId, LatestVersionId, LastModifiedDate FROM FlowDefinitionView').catch((error) => { this.rethrowConnectionError(error); console.warn(JSON.stringify({ level: 'warn', message: 'salesforce_flow_inventory_unavailable', error: error instanceof Error ? error.message : 'Unknown error', details: error instanceof ApiError ? error.details : undefined })); return [] }) : []
    const validationRules = selected.has('Validation Rule') ? await this.toolingQuery<ValidationRuleRecord>(connection, 'SELECT Id, ValidationName, Active, EntityDefinition.QualifiedApiName, Description, ErrorDisplayField, LastModifiedDate, NamespacePrefix FROM ValidationRule') : []
    const permissionSets = selected.has('Profile') || selected.has('Permission Set') ? await this.dataQuery<PermissionSetRecord>(connection, 'SELECT Id, Name, Label, IsOwnedByProfile, ProfileId, Profile.Name, License.Name, NamespacePrefix, PermissionsModifyAllData, PermissionsViewAllData, PermissionsManageUsers, PermissionsAuthorApex, PermissionsCustomizeApplication FROM PermissionSet') : []
    const objectNames = new Set(objects.map(({ QualifiedApiName }) => QualifiedApiName))
    const components: MetadataComponent[] = []
    for (const object of selected.has('Object') ? objects : []) components.push({
      id: this.metadataComponentId(connectionId, `Object:${object.QualifiedApiName}`), orgConnectionId: connectionId, identityKey: `Object:${object.QualifiedApiName}`,
      salesforceMetadataId: object.DurableId, type: 'Object', name: object.QualifiedApiName, label: object.Label, namespace: object.NamespacePrefix,
      parentIdentityKey: null, active: true, attributes: { customizable: object.IsCustomizable, customSetting: object.IsCustomSetting, custom: object.QualifiedApiName.endsWith('__c') }, modifiedAt: null,
    })
    for (const object of selected.has('Sharing Setting') ? objects : []) {
      const identityKey = `Sharing Setting:${object.QualifiedApiName}`
      components.push({ id: this.metadataComponentId(connectionId, identityKey), orgConnectionId: connectionId, identityKey, salesforceMetadataId: object.DurableId,
        type: 'Sharing Setting', name: object.QualifiedApiName, label: `${object.Label} sharing defaults`, namespace: object.NamespacePrefix, parentIdentityKey: `Object:${object.QualifiedApiName}`, active: true,
        attributes: { internalSharingModel: object.InternalSharingModel, externalSharingModel: object.ExternalSharingModel }, modifiedAt: null })
    }
    for (const field of selected.has('Field') ? fields : []) {
      const parent = field.EntityDefinition?.QualifiedApiName
      if (!parent || !objectNames.has(parent)) continue
      const identityKey = `Field:${parent}.${field.QualifiedApiName}`
      components.push({ id: this.metadataComponentId(connectionId, identityKey), orgConnectionId: connectionId, identityKey, salesforceMetadataId: field.DurableId,
        type: 'Field', name: `${parent}.${field.QualifiedApiName}`, label: field.Label, namespace: null, parentIdentityKey: `Object:${parent}`, active: true,
        attributes: { objectApiName: parent, fieldApiName: field.QualifiedApiName, dataType: field.DataType, nillable: field.IsNillable, calculated: field.IsCalculated, custom: field.QualifiedApiName.endsWith('__c') }, modifiedAt: null })
    }
    for (const flow of flows) {
      const identityKey = `Flow:${flow.ApiName}`
      components.push({ id: this.metadataComponentId(connectionId, identityKey), orgConnectionId: connectionId, identityKey, salesforceMetadataId: flow.DurableId,
        type: 'Flow', name: flow.ApiName, label: flow.Label, namespace: flow.NamespacePrefix, parentIdentityKey: null, active: flow.IsActive,
        attributes: { processType: flow.ProcessType, triggerType: flow.TriggerType, activeVersionId: flow.ActiveVersionId, latestVersionId: flow.LatestVersionId }, modifiedAt: flow.LastModifiedDate })
    }
    for (const rule of validationRules) {
      const parent = rule.EntityDefinition?.QualifiedApiName
      if (!parent) continue
      const identityKey = `Validation Rule:${parent}.${rule.ValidationName}`
      components.push({ id: this.metadataComponentId(connectionId, identityKey), orgConnectionId: connectionId, identityKey, salesforceMetadataId: rule.Id,
        type: 'Validation Rule', name: `${parent}.${rule.ValidationName}`, label: rule.ValidationName, namespace: rule.NamespacePrefix, parentIdentityKey: `Object:${parent}`, active: rule.Active,
        attributes: { objectApiName: parent, description: rule.Description, errorDisplayField: rule.ErrorDisplayField }, modifiedAt: rule.LastModifiedDate })
    }
    for (const permission of permissionSets) {
      const isProfile = permission.IsOwnedByProfile && Boolean(permission.ProfileId)
      const type = isProfile ? 'Profile' as const : 'Permission Set' as const
      if (!selected.has(type)) continue
      const name = isProfile ? permission.Profile?.Name ?? permission.Label : permission.Name
      const identityKey = `${type}:${isProfile ? permission.ProfileId : permission.Id}`
      components.push({ id: this.metadataComponentId(connectionId, identityKey), orgConnectionId: connectionId, identityKey, salesforceMetadataId: isProfile ? permission.ProfileId : permission.Id,
        type, name, label: isProfile ? permission.Profile?.Name ?? permission.Label : permission.Label, namespace: permission.NamespacePrefix, parentIdentityKey: null, active: true,
        attributes: { license: permission.License?.Name ?? null, modifyAllData: permission.PermissionsModifyAllData, viewAllData: permission.PermissionsViewAllData, manageUsers: permission.PermissionsManageUsers, authorApex: permission.PermissionsAuthorApex, customizeApplication: permission.PermissionsCustomizeApplication }, modifiedAt: null })
    }
    const existing = await this.repository.listMetadataComponents(connectionId)
    await this.repository.replaceMetadataComponents(connectionId, [...existing.filter(({ type }) => !selected.has(type)), ...components])
    const existingArtifacts = await this.repository.listArtifacts(connectionId)
    const analysisArtifacts: Artifact[] = [
      ...flows.filter((flow) => flow.ActiveVersionId || flow.LatestVersionId).map((flow) => ({ id: `${connectionId}:${flow.ActiveVersionId ?? flow.LatestVersionId}`, orgConnectionId: connectionId, salesforceMetadataId: (flow.ActiveVersionId ?? flow.LatestVersionId)!, name: flow.ApiName, type: 'Flow' as const, namespace: flow.NamespacePrefix, apiVersion: '', modifiedAt: flow.LastModifiedDate ?? new Date().toISOString(), contentHash: '' })),
      ...validationRules.map((rule) => ({ id: `${connectionId}:${rule.Id}`, orgConnectionId: connectionId, salesforceMetadataId: rule.Id, name: `${rule.EntityDefinition?.QualifiedApiName}.${rule.ValidationName}`, type: 'Validation Rule' as const, namespace: rule.NamespacePrefix, apiVersion: '', modifiedAt: rule.LastModifiedDate, contentHash: '' })),
    ]
    const selectedAnalyzable = new Set<ArtifactType>()
    if (selected.has('Flow')) selectedAnalyzable.add('Flow')
    if (selected.has('Validation Rule')) selectedAnalyzable.add('Validation Rule')
    if (selectedAnalyzable.size) await this.repository.replaceArtifacts(connectionId, [...existingArtifacts.filter(({ type }) => !selectedAnalyzable.has(type)), ...analysisArtifacts])
    return this.repository.listMetadataComponents(connectionId)
  }

  async listComponents(connectionId: string, tenantId: string, requestedTypes: ArtifactType[] = ['Apex Class', 'Trigger', 'LWC']) {
    const connection = await this.repository.getOrgConnection(connectionId, tenantId)
    if (!connection) throw new ApiError(404, 'ORG_CONNECTION_NOT_FOUND', 'The Salesforce organization connection was not found.')
    const selected = new Set(requestedTypes)
    const [classes, triggers, bundles] = await Promise.all([
      selected.has('Apex Class') ? this.toolingQuery<ApexRecord>(connection, 'SELECT Id, Name, NamespacePrefix, ApiVersion, LastModifiedDate FROM ApexClass') : [],
      selected.has('Trigger') ? this.toolingQuery<ApexRecord>(connection, 'SELECT Id, Name, NamespacePrefix, ApiVersion, LastModifiedDate FROM ApexTrigger') : [],
      selected.has('LWC') ? this.toolingQuery<BundleRecord>(connection, 'SELECT Id, DeveloperName, NamespacePrefix, ApiVersion, LastModifiedDate FROM LightningComponentBundle').catch((error) => { this.rethrowConnectionError(error); return [] }) : [],
    ])
    const artifacts: Artifact[] = []
    const addApex = (records: ApexRecord[], type: 'Apex Class' | 'Trigger') => records.forEach((record) => { const id = `${connectionId}:${record.Id}`; artifacts.push({ id, orgConnectionId: connectionId, salesforceMetadataId: record.Id, name: record.Name, type, namespace: record.NamespacePrefix, apiVersion: String(record.ApiVersion), modifiedAt: record.LastModifiedDate, contentHash: '' }) })
    addApex(classes, 'Apex Class'); addApex(triggers, 'Trigger')
    for (const bundle of bundles) {
      const id = `${connectionId}:${bundle.Id}`; artifacts.push({ id, orgConnectionId: connectionId, salesforceMetadataId: bundle.Id, name: bundle.DeveloperName, type: 'LWC', namespace: bundle.NamespacePrefix, apiVersion: String(bundle.ApiVersion), modifiedAt: bundle.LastModifiedDate, contentHash: '' })
    }
    const existing = await this.repository.listArtifacts(connectionId)
    await this.repository.replaceArtifacts(connectionId, [...existing.filter(({ type }) => !selected.has(type)), ...artifacts])
    await this.repository.saveOrgConnection({ ...connection, lastDiscoveredAt: new Date().toISOString() })
    return this.repository.listArtifacts(connectionId)
  }

  async loadArtifactSources(connectionId: string, tenantId: string, artifacts: Artifact[]) {
    const connection = await this.repository.getOrgConnection(connectionId, tenantId)
    if (!connection) throw new ApiError(404, 'ORG_CONNECTION_NOT_FOUND', 'The Salesforce organization connection was not found.')
    if (artifacts.some((artifact) => artifact.orgConnectionId !== connectionId)) throw new ApiError(400, 'SCAN_SCOPE_INVALID', 'One or more selected components do not belong to this organization.')
    const sources = new Map<string, string>()
    const classes = artifacts.filter(({ type }) => type === 'Apex Class')
    const triggers = artifacts.filter(({ type }) => type === 'Trigger')
    const bundles = artifacts.filter(({ type }) => type === 'LWC')
    const flows = artifacts.filter(({ type }) => type === 'Flow')
    const validationRules = artifacts.filter(({ type }) => type === 'Validation Rule')

    const loadApex = async (selected: Artifact[], objectName: 'ApexClass' | 'ApexTrigger') => {
      for (const batch of this.batches(selected, 100)) {
        const ids = batch.map(({ salesforceMetadataId }) => this.salesforceId(salesforceMetadataId))
        const records = await this.toolingQuery<ApexSourceRecord>(connection, `SELECT Id, Body FROM ${objectName} WHERE Id IN (${ids.map((id) => `'${id}'`).join(',')})`)
        const byId = new Map(records.map((record) => [record.Id, record.Body]))
        for (const artifact of batch) { const source = byId.get(artifact.salesforceMetadataId); if (source !== undefined) sources.set(artifact.id, source) }
      }
    }
    await loadApex(classes, 'ApexClass')
    await loadApex(triggers, 'ApexTrigger')

    for (const batch of this.batches(bundles, 100)) {
      const ids = batch.map(({ salesforceMetadataId }) => this.salesforceId(salesforceMetadataId))
      const resources = await this.toolingQuery<ResourceRecord>(connection, `SELECT LightningComponentBundleId, FilePath, Source FROM LightningComponentResource WHERE LightningComponentBundleId IN (${ids.map((id) => `'${id}'`).join(',')})`)
      for (const artifact of batch) {
        const source = resources.filter(({ LightningComponentBundleId }) => LightningComponentBundleId === artifact.salesforceMetadataId).sort((a, b) => a.FilePath.localeCompare(b.FilePath)).map((resource) => `// ${resource.FilePath}\n${resource.Source}`).join('\n\n')
        if (source) sources.set(artifact.id, source)
      }
    }
    for (const flow of flows) {
      const records = await this.toolingQuery<FlowSourceRecord>(connection, `SELECT Id, Metadata FROM Flow WHERE Id = '${this.salesforceId(flow.salesforceMetadataId)}' LIMIT 1`)
      if (records[0]) sources.set(flow.id, JSON.stringify(records[0].Metadata, null, 2))
    }
    for (const batch of this.batches(validationRules, 100)) {
      const ids = batch.map(({ salesforceMetadataId }) => this.salesforceId(salesforceMetadataId))
      const records = await this.toolingQuery<ValidationRuleSourceRecord>(connection, `SELECT Id, ErrorConditionFormula, ErrorMessage FROM ValidationRule WHERE Id IN (${ids.map((id) => `'${id}'`).join(',')})`)
      for (const artifact of batch) { const rule = records.find(({ Id }) => Id === artifact.salesforceMetadataId); if (rule) sources.set(artifact.id, `Formula: ${rule.ErrorConditionFormula}\nError message: ${rule.ErrorMessage}`) }
    }

    const missing = artifacts.filter(({ id }) => !sources.has(id))
    if (missing.length) throw new ApiError(409, 'SALESFORCE_SOURCE_NOT_FOUND', 'One or more selected components could not be retrieved. Refresh the component list and try again.', { components: missing.map(({ name, type }) => ({ name, type })) })
    for (const artifact of artifacts) {
      const source = sources.get(artifact.id)!
      const contentHash = this.hash(source)
      artifact.contentHash = contentHash
      await this.repository.recordArtifactVersion(artifact.id, contentHash, Buffer.byteLength(source, 'utf8'))
    }
    return sources
  }

  async deployArtifactSource(connectionId: string, tenantId: string, artifact: Artifact, source: string, expectedSourceHash: string) {
    if (artifact.type === 'LWC') throw new ApiError(400, 'LWC_DEPLOY_NOT_SUPPORTED', 'LWC deployment is not available yet because bundles contain multiple files.')
    if (Buffer.byteLength(source, 'utf8') > 500_000) throw new ApiError(413, 'SOURCE_TOO_LARGE', 'The proposed component is too large to deploy.')
    const connection = await this.repository.getOrgConnection(connectionId, tenantId)
    if (!connection || artifact.orgConnectionId !== connectionId) throw new ApiError(404, 'ARTIFACT_NOT_FOUND', 'The Salesforce component was not found.')
    const currentSources = await this.loadArtifactSources(connectionId, tenantId, [artifact])
    try {
      const currentSource = currentSources.get(artifact.id)
      if (currentSource === undefined) throw new ApiError(409, 'SALESFORCE_SOURCE_NOT_FOUND', 'The current component source could not be retrieved.')
      const currentHash = createHash('sha256').update(currentSource).digest('hex')
      if (currentHash !== expectedSourceHash) throw new ApiError(409, 'SOURCE_CHANGED', 'This component changed in Salesforce after the resolution was generated. Generate a new resolution before deploying.')
      await this.compileApexThroughContainer(connection, artifact, source, false)
      const contentHash = this.hash(source)
      await this.repository.recordArtifactVersion(artifact.id, contentHash, Buffer.byteLength(source, 'utf8'))
      return { artifactId: artifact.id, deployedAt: new Date().toISOString(), contentHash }
    } finally { currentSources.clear() }
  }

  async validateArtifactSource(connectionId: string, tenantId: string, artifact: Artifact, source: string): Promise<{ valid: boolean; errors: unknown[] }> {
    if (artifact.type === 'LWC') return { valid: false, errors: [{ message: 'LWC compilation validation is not supported yet.' }] }
    const connection = await this.repository.getOrgConnection(connectionId, tenantId)
    if (!connection || artifact.orgConnectionId !== connectionId) throw new ApiError(404, 'ARTIFACT_NOT_FOUND', 'The Salesforce component was not found.')
    try { await this.compileApexThroughContainer(connection, artifact, source, true); return { valid: true, errors: [] } }
    catch (error) {
      if (error instanceof ApiError && error.code === 'SALESFORCE_COMPILE_FAILED') return { valid: false, errors: [error.details] }
      throw error
    }
  }

  private async compileApexThroughContainer(connection: OrgConnection, artifact: Artifact, source: string, isCheckOnly: boolean) {
    const containerName = `VS_${randomUUID().replaceAll('-', '').slice(0, 29)}`
    const containerId = await this.createToolingRecord(connection, 'MetadataContainer', { Name: containerName })
    let terminal = false
    try {
      const memberType = artifact.type === 'Trigger' ? 'ApexTriggerMember' : 'ApexClassMember'
      const memberId = await this.createToolingRecord(connection, memberType, { MetadataContainerId: containerId, ContentEntityId: this.salesforceId(artifact.salesforceMetadataId), Body: source })
      const requestId = await this.createToolingRecord(connection, 'ContainerAsyncRequest', { MetadataContainerId: containerId, IsCheckOnly: isCheckOnly })
      for (let attempt = 0; attempt < 90; attempt++) {
        const request = await this.getToolingRecord<ContainerRequestRecord>(connection, 'ContainerAsyncRequest', requestId, ['State', 'ErrorMsg', 'DeployDetails'])
        if (request.State === 'Completed') { terminal = true; return }
        if (['Failed', 'Error', 'Aborted', 'Invalidated'].includes(request.State)) {
          terminal = true
          const member = await this.getToolingRecord<CompilerErrorRecord>(connection, memberType, memberId, ['CompilerErrors'])
          throw new ApiError(422, 'SALESFORCE_COMPILE_FAILED', 'Salesforce could not compile the proposed component.', { state: request.State, message: request.ErrorMsg ?? null, compilerErrors: this.parseCompilerErrors(member.CompilerErrors), deployDetails: request.DeployDetails ?? null })
        }
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000))
      }
      throw new ApiError(504, 'SALESFORCE_DEPLOY_TIMEOUT', 'Salesforce is still processing the deployment. Refresh the component before trying again.')
    } finally {
      if (terminal) {
        const response = await this.salesforceFetch(connection, `/services/data/v${config.SALESFORCE_API_VERSION}/tooling/sobjects/MetadataContainer/${containerId}`, { method: 'DELETE' })
        if (!response.ok && response.status !== 404) console.warn(JSON.stringify({ level: 'warn', message: 'salesforce_metadata_container_cleanup_failed', containerId, providerStatus: response.status }))
      }
    }
  }

  private async createToolingRecord(connection: OrgConnection, objectName: string, body: Record<string, unknown>) {
    const response = await this.salesforceFetch(connection, `/services/data/v${config.SALESFORCE_API_VERSION}/tooling/sobjects/${objectName}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const text = await response.text()
    let result: ToolingCreateResponse | undefined
    try { result = text ? JSON.parse(text) as ToolingCreateResponse : undefined } catch { /* handled below */ }
    if (!response.ok || !result?.success || !result.id) throw new ApiError(502, 'SALESFORCE_DEPLOY_SETUP_FAILED', `Salesforce could not create ${objectName}.`, { providerStatus: response.status, errors: result?.errors ?? this.parseSalesforceResponse(text) })
    return result.id
  }

  private async getToolingRecord<T>(connection: OrgConnection, objectName: string, id: string, fields: string[]): Promise<T> {
    const path = `/services/data/v${config.SALESFORCE_API_VERSION}/tooling/sobjects/${objectName}/${this.salesforceId(id)}?fields=${encodeURIComponent(fields.join(','))}`
    const response = await this.salesforceFetch(connection, path)
    const text = await response.text()
    if (!response.ok) throw new ApiError(502, 'SALESFORCE_DEPLOY_STATUS_FAILED', `Salesforce could not return ${objectName} deployment status.`, { providerStatus: response.status, errors: this.parseSalesforceResponse(text) })
    try { return JSON.parse(text) as T }
    catch { throw new ApiError(502, 'SALESFORCE_DEPLOY_STATUS_INVALID', `Salesforce returned an invalid ${objectName} deployment status.`) }
  }

  private parseCompilerErrors(value?: string | null): unknown[] {
    if (!value) return []
    try { const parsed = JSON.parse(value) as unknown; return Array.isArray(parsed) ? parsed : [parsed] } catch { return [{ message: value }] }
  }

  private parseSalesforceResponse(value: string): unknown {
    try { return JSON.parse(value) as unknown } catch { return value.slice(0, 2_000) }
  }

  private async toolingQuery<T>(connection: OrgConnection, soql: string): Promise<T[]> {
    const records: T[] = []; let path = `/services/data/v${config.SALESFORCE_API_VERSION}/tooling/query?q=${encodeURIComponent(soql)}`
    do {
      const response = await this.salesforceFetch(connection, path)
      if (!response.ok) {
        const providerError = await response.json().catch(() => null) as Array<{ errorCode?: string; message?: string }> | null
        throw new ApiError(502, 'SALESFORCE_DISCOVERY_FAILED', 'Salesforce metadata discovery failed.', {
          providerStatus: response.status,
          providerCode: providerError?.[0]?.errorCode,
          providerMessage: providerError?.[0]?.message,
        })
      }
      const page = await response.json() as ToolingQuery<T>; records.push(...page.records); path = page.done ? '' : page.nextRecordsUrl ?? ''
    } while (path)
    return records
  }

  private async dataQuery<T>(connection: OrgConnection, soql: string): Promise<T[]> {
    const records: T[] = []; let path = `/services/data/v${config.SALESFORCE_API_VERSION}/query?q=${encodeURIComponent(soql)}`
    do {
      const response = await this.salesforceFetch(connection, path)
      if (!response.ok) {
        const providerError = await response.json().catch(() => null) as Array<{ errorCode?: string; message?: string }> | null
        throw new ApiError(502, 'SALESFORCE_DISCOVERY_FAILED', 'Salesforce metadata discovery failed.', { providerStatus: response.status, providerCode: providerError?.[0]?.errorCode, providerMessage: providerError?.[0]?.message })
      }
      const page = await response.json() as ToolingQuery<T>; records.push(...page.records); path = page.done ? '' : page.nextRecordsUrl ?? ''
    } while (path)
    return records
  }

  private async salesforceFetch(connection: OrgConnection, path: string, init: RequestInit = {}) {
    let tokens = await this.credentialStore.getTokens(connection.id)
    if (!tokens) {
      await this.repository.saveOrgConnection({ ...connection, status: 'reauthorization_required' })
      throw new ApiError(409, 'ORG_TOKEN_UNAVAILABLE', 'Reconnect this Salesforce org because its runtime token is unavailable.')
    }
    const headers = new Headers(init.headers); headers.set('authorization', `Bearer ${tokens.accessToken}`)
    let response = await fetch(new URL(path, connection.instanceUrl), { ...init, headers })
    if (response.status === 401 && tokens.refreshToken) {
      tokens = await this.refreshTokens(connection, tokens.refreshToken)
      headers.set('authorization', `Bearer ${tokens.accessToken}`)
      response = await fetch(new URL(path, connection.instanceUrl), { ...init, headers })
    }
    return response
  }

  private async refreshTokens(connection: OrgConnection, refreshToken: string): Promise<StoredTokens> {
    const response = await fetch(new URL('/services/oauth2/token', this.loginOrigin(connection.environment)), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: this.tokenParameters({ grant_type: 'refresh_token', refresh_token: refreshToken }) })
    if (!response.ok) {
      await this.repository.saveOrgConnection({ ...connection, status: 'reauthorization_required' })
      await this.credentialStore.deleteTokens(connection.id)
      throw new ApiError(401, 'ORG_CONNECTION_REVOKED', 'The Salesforce connection must be reauthorized.')
    }
    const result = await response.json() as TokenResponse
    const updated = { accessToken: result.access_token, refreshToken: result.refresh_token ?? refreshToken }
    await this.credentialStore.saveTokens(connection.id, updated)
    return updated
  }

  private hash(source: string) { return `sha256:${createHash('sha256').update(source).digest('hex')}` }
  private rethrowConnectionError(error: unknown) { if (error instanceof ApiError && ['ORG_TOKEN_UNAVAILABLE', 'ORG_CONNECTION_REVOKED'].includes(error.code)) throw error }
  private allDiscoverTypes(): DiscoverComponentType[] { return ['Apex Class', 'Trigger', 'LWC', 'Object', 'Field', 'Flow', 'Validation Rule', 'Profile', 'Permission Set', 'Sharing Setting'] }
  private metadataComponentId(connectionId: string, identityKey: string) { return `meta_${createHash('sha256').update(`${connectionId}:${identityKey}`).digest('hex').slice(0, 32)}` }
  private soqlString(value: string) { return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'") }
  private salesforceId(value: string) { if (!/^[a-zA-Z0-9]{15,18}$/.test(value)) throw new ApiError(400, 'SALESFORCE_METADATA_ID_INVALID', 'A selected component has an invalid Salesforce metadata ID.'); return value }
  private batches<T>(values: T[], size: number) { const result: T[][] = []; for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size)); return result }

  private tokenParameters(values: Record<string, string>) {
    return new URLSearchParams({ ...values, client_id: config.SALESFORCE_CLIENT_ID!, ...(config.SALESFORCE_CLIENT_SECRET ? { client_secret: config.SALESFORCE_CLIENT_SECRET } : {}) })
  }

  private requireConfiguration() { if (!config.SALESFORCE_CLIENT_ID) throw new ApiError(503, 'SALESFORCE_OAUTH_NOT_CONFIGURED', 'Salesforce OAuth credentials are not configured.'); if (!config.TOKEN_ENCRYPTION_KEY) throw new ApiError(503, 'TOKEN_ENCRYPTION_NOT_CONFIGURED', 'Salesforce token encryption is not configured.') }
  private loginOrigin(environment: OrgEnvironment) { return environment === 'sandbox' ? 'https://test.salesforce.com' : 'https://login.salesforce.com' }
  private validateSalesforceUrl(value: string) { const url = new URL(value); if (url.protocol !== 'https:' || !(url.hostname.endsWith('.salesforce.com') || url.hostname === 'salesforce.com' || url.hostname.endsWith('.force.com'))) throw new ApiError(502, 'SALESFORCE_INSTANCE_INVALID', 'Salesforce returned an invalid service URL.') }
}
