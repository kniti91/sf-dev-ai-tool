-- CreateEnum
CREATE TYPE "WorkspaceRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER');

-- CreateEnum
CREATE TYPE "OrgEnvironment" AS ENUM ('PRODUCTION', 'SANDBOX');

-- CreateEnum
CREATE TYPE "OrgConnectionStatus" AS ENUM ('CONNECTED', 'REAUTHORIZATION_REQUIRED', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "ArtifactType" AS ENUM ('APEX_CLASS', 'APEX_TRIGGER', 'LWC_BUNDLE');

-- CreateEnum
CREATE TYPE "AnalysisRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'PARTIAL', 'COMPLETED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "AnalysisItemStatus" AS ENUM ('QUEUED', 'RUNNING', 'REUSED', 'COMPLETED', 'SKIPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFORMATIONAL');

-- CreateEnum
CREATE TYPE "FindingDisposition" AS ENUM ('OPEN', 'RESOLVED', 'ACCEPTED_RISK', 'FALSE_POSITIVE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceMembership" (
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceMembership_pkey" PRIMARY KEY ("workspaceId","userId")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OAuthAuthorizationState" (
    "id" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "environment" "OrgEnvironment" NOT NULL,
    "pkceVerifier" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthAuthorizationState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgConnection" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "connectedByUserId" TEXT NOT NULL,
    "salesforceOrgId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "environment" "OrgEnvironment" NOT NULL,
    "instanceUrl" TEXT NOT NULL,
    "status" "OrgConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
    "lastDiscoveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgOAuthToken" (
    "orgConnectionId" TEXT NOT NULL,
    "encryptedAccessToken" TEXT NOT NULL,
    "encryptedRefreshToken" TEXT,
    "encryptionKeyVersion" INTEGER NOT NULL DEFAULT 1,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgOAuthToken_pkey" PRIMARY KEY ("orgConnectionId")
);

-- CreateTable
CREATE TABLE "Artifact" (
    "id" TEXT NOT NULL,
    "orgConnectionId" TEXT NOT NULL,
    "identityKey" TEXT NOT NULL,
    "salesforceMetadataId" TEXT,
    "type" "ArtifactType" NOT NULL,
    "name" TEXT NOT NULL,
    "namespace" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "currentVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Artifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArtifactVersion" (
    "id" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "sourceCode" TEXT NOT NULL,
    "sourceSizeBytes" INTEGER NOT NULL,
    "apiVersion" TEXT,
    "salesforceModifiedAt" TIMESTAMP(3),
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArtifactVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "orgConnectionId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "AnalysisRunStatus" NOT NULL DEFAULT 'QUEUED',
    "scope" TEXT NOT NULL,
    "requestSnapshot" JSONB NOT NULL,
    "selectedCounts" JSONB NOT NULL,
    "requestedArtifactCount" INTEGER NOT NULL,
    "completedArtifactCount" INTEGER NOT NULL DEFAULT 0,
    "reusedArtifactCount" INTEGER NOT NULL DEFAULT 0,
    "overallScore" INTEGER,
    "overallSummary" TEXT,
    "summarySnapshot" JSONB,
    "analyzerVersion" TEXT NOT NULL,
    "ruleSetVersion" TEXT NOT NULL,
    "analysisProfileHash" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalysisRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisRunItem" (
    "id" TEXT NOT NULL,
    "analysisRunId" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "artifactVersionId" TEXT NOT NULL,
    "componentAnalysisResultId" TEXT,
    "status" "AnalysisItemStatus" NOT NULL DEFAULT 'QUEUED',
    "score" INTEGER,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalysisRunItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComponentAnalysisResult" (
    "id" TEXT NOT NULL,
    "artifactVersionId" TEXT NOT NULL,
    "analysisProfileHash" TEXT NOT NULL,
    "analyzerVersion" TEXT NOT NULL,
    "ruleSetVersion" TEXT NOT NULL,
    "aiProvider" TEXT,
    "aiModel" TEXT,
    "promptVersion" TEXT,
    "deterministicScore" INTEGER NOT NULL,
    "deterministicSummary" TEXT,
    "aiSummary" TEXT,
    "metrics" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComponentAnalysisResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Finding" (
    "id" TEXT NOT NULL,
    "componentAnalysisResultId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "ruleVersion" TEXT NOT NULL,
    "severity" "Severity" NOT NULL,
    "category" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "lineStart" INTEGER,
    "lineEnd" INTEGER,
    "confidence" DOUBLE PRECISION NOT NULL,
    "deterministic" BOOLEAN NOT NULL DEFAULT true,
    "disposition" "FindingDisposition" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Finding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "proposedCode" TEXT,
    "confidence" DOUBLE PRECISION,
    "inputHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisCategoryScore" (
    "id" TEXT NOT NULL,
    "analysisRunId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "findingCount" INTEGER NOT NULL,
    "summary" TEXT,

    CONSTRAINT "AnalysisCategoryScore_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "WorkspaceMembership_userId_idx" ON "WorkspaceMembership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_expiresAt_idx" ON "Session"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthAuthorizationState_stateHash_key" ON "OAuthAuthorizationState"("stateHash");

-- CreateIndex
CREATE INDEX "OAuthAuthorizationState_expiresAt_idx" ON "OAuthAuthorizationState"("expiresAt");

-- CreateIndex
CREATE INDEX "OAuthAuthorizationState_workspaceId_userId_idx" ON "OAuthAuthorizationState"("workspaceId", "userId");

-- CreateIndex
CREATE INDEX "OrgConnection_workspaceId_status_idx" ON "OrgConnection"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OrgConnection_workspaceId_salesforceOrgId_key" ON "OrgConnection"("workspaceId", "salesforceOrgId");

-- CreateIndex
CREATE UNIQUE INDEX "Artifact_currentVersionId_key" ON "Artifact"("currentVersionId");

-- CreateIndex
CREATE INDEX "Artifact_orgConnectionId_type_isDeleted_idx" ON "Artifact"("orgConnectionId", "type", "isDeleted");

-- CreateIndex
CREATE INDEX "Artifact_orgConnectionId_name_idx" ON "Artifact"("orgConnectionId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Artifact_orgConnectionId_identityKey_key" ON "Artifact"("orgConnectionId", "identityKey");

-- CreateIndex
CREATE INDEX "ArtifactVersion_artifactId_retrievedAt_idx" ON "ArtifactVersion"("artifactId", "retrievedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ArtifactVersion_artifactId_contentHash_key" ON "ArtifactVersion"("artifactId", "contentHash");

-- CreateIndex
CREATE INDEX "AnalysisRun_workspaceId_createdAt_idx" ON "AnalysisRun"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "AnalysisRun_orgConnectionId_createdAt_idx" ON "AnalysisRun"("orgConnectionId", "createdAt");

-- CreateIndex
CREATE INDEX "AnalysisRun_workspaceId_status_idx" ON "AnalysisRun"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "AnalysisRunItem_analysisRunId_status_idx" ON "AnalysisRunItem"("analysisRunId", "status");

-- CreateIndex
CREATE INDEX "AnalysisRunItem_componentAnalysisResultId_idx" ON "AnalysisRunItem"("componentAnalysisResultId");

-- CreateIndex
CREATE UNIQUE INDEX "AnalysisRunItem_analysisRunId_artifactId_key" ON "AnalysisRunItem"("analysisRunId", "artifactId");

-- CreateIndex
CREATE INDEX "ComponentAnalysisResult_createdAt_idx" ON "ComponentAnalysisResult"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ComponentAnalysisResult_artifactVersionId_analysisProfileHa_key" ON "ComponentAnalysisResult"("artifactVersionId", "analysisProfileHash");

-- CreateIndex
CREATE INDEX "Finding_severity_category_idx" ON "Finding"("severity", "category");

-- CreateIndex
CREATE INDEX "Finding_fingerprint_idx" ON "Finding"("fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "Finding_componentAnalysisResultId_fingerprint_key" ON "Finding"("componentAnalysisResultId", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "Recommendation_findingId_provider_model_promptVersion_input_key" ON "Recommendation"("findingId", "provider", "model", "promptVersion", "inputHash");

-- CreateIndex
CREATE UNIQUE INDEX "AnalysisCategoryScore_analysisRunId_category_key" ON "AnalysisCategoryScore"("analysisRunId", "category");

-- AddForeignKey
ALTER TABLE "WorkspaceMembership" ADD CONSTRAINT "WorkspaceMembership_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMembership" ADD CONSTRAINT "WorkspaceMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OAuthAuthorizationState" ADD CONSTRAINT "OAuthAuthorizationState_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OAuthAuthorizationState" ADD CONSTRAINT "OAuthAuthorizationState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgConnection" ADD CONSTRAINT "OrgConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgConnection" ADD CONSTRAINT "OrgConnection_connectedByUserId_fkey" FOREIGN KEY ("connectedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgOAuthToken" ADD CONSTRAINT "OrgOAuthToken_orgConnectionId_fkey" FOREIGN KEY ("orgConnectionId") REFERENCES "OrgConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_orgConnectionId_fkey" FOREIGN KEY ("orgConnectionId") REFERENCES "OrgConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "ArtifactVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtifactVersion" ADD CONSTRAINT "ArtifactVersion_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "Artifact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisRun" ADD CONSTRAINT "AnalysisRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisRun" ADD CONSTRAINT "AnalysisRun_orgConnectionId_fkey" FOREIGN KEY ("orgConnectionId") REFERENCES "OrgConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisRun" ADD CONSTRAINT "AnalysisRun_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisRunItem" ADD CONSTRAINT "AnalysisRunItem_analysisRunId_fkey" FOREIGN KEY ("analysisRunId") REFERENCES "AnalysisRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisRunItem" ADD CONSTRAINT "AnalysisRunItem_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "Artifact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisRunItem" ADD CONSTRAINT "AnalysisRunItem_artifactVersionId_fkey" FOREIGN KEY ("artifactVersionId") REFERENCES "ArtifactVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisRunItem" ADD CONSTRAINT "AnalysisRunItem_componentAnalysisResultId_fkey" FOREIGN KEY ("componentAnalysisResultId") REFERENCES "ComponentAnalysisResult"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComponentAnalysisResult" ADD CONSTRAINT "ComponentAnalysisResult_artifactVersionId_fkey" FOREIGN KEY ("artifactVersionId") REFERENCES "ArtifactVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_componentAnalysisResultId_fkey" FOREIGN KEY ("componentAnalysisResultId") REFERENCES "ComponentAnalysisResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "Finding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisCategoryScore" ADD CONSTRAINT "AnalysisCategoryScore_analysisRunId_fkey" FOREIGN KEY ("analysisRunId") REFERENCES "AnalysisRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
