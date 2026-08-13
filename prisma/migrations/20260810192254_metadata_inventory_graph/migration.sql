-- CreateTable
CREATE TABLE "MetadataComponent" (
    "id" TEXT NOT NULL,
    "orgConnectionId" TEXT NOT NULL,
    "identityKey" TEXT NOT NULL,
    "salesforceMetadataId" TEXT,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "label" TEXT,
    "namespace" TEXT,
    "parentIdentityKey" TEXT,
    "active" BOOLEAN,
    "attributes" JSONB NOT NULL,
    "salesforceModifiedAt" TIMESTAMP(3),
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetadataComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DependencyEdge" (
    "id" TEXT NOT NULL,
    "orgConnectionId" TEXT NOT NULL,
    "sourceComponentId" TEXT NOT NULL,
    "targetComponentId" TEXT NOT NULL,
    "relationshipType" TEXT NOT NULL,
    "evidenceType" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "sourceLocation" JSONB,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DependencyEdge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MetadataComponent_orgConnectionId_type_active_idx" ON "MetadataComponent"("orgConnectionId", "type", "active");

-- CreateIndex
CREATE INDEX "MetadataComponent_orgConnectionId_name_idx" ON "MetadataComponent"("orgConnectionId", "name");

-- CreateIndex
CREATE INDEX "MetadataComponent_orgConnectionId_parentIdentityKey_idx" ON "MetadataComponent"("orgConnectionId", "parentIdentityKey");

-- CreateIndex
CREATE UNIQUE INDEX "MetadataComponent_orgConnectionId_identityKey_key" ON "MetadataComponent"("orgConnectionId", "identityKey");

-- CreateIndex
CREATE INDEX "DependencyEdge_orgConnectionId_relationshipType_idx" ON "DependencyEdge"("orgConnectionId", "relationshipType");

-- CreateIndex
CREATE INDEX "DependencyEdge_targetComponentId_idx" ON "DependencyEdge"("targetComponentId");

-- CreateIndex
CREATE UNIQUE INDEX "DependencyEdge_sourceComponentId_targetComponentId_relation_key" ON "DependencyEdge"("sourceComponentId", "targetComponentId", "relationshipType");

-- AddForeignKey
ALTER TABLE "MetadataComponent" ADD CONSTRAINT "MetadataComponent_orgConnectionId_fkey" FOREIGN KEY ("orgConnectionId") REFERENCES "OrgConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DependencyEdge" ADD CONSTRAINT "DependencyEdge_orgConnectionId_fkey" FOREIGN KEY ("orgConnectionId") REFERENCES "OrgConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DependencyEdge" ADD CONSTRAINT "DependencyEdge_sourceComponentId_fkey" FOREIGN KEY ("sourceComponentId") REFERENCES "MetadataComponent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DependencyEdge" ADD CONSTRAINT "DependencyEdge_targetComponentId_fkey" FOREIGN KEY ("targetComponentId") REFERENCES "MetadataComponent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
