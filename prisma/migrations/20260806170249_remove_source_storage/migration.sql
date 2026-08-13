/*
  Warnings:

  - You are about to drop the column `sourceCode` on the `ArtifactVersion` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Artifact" ADD COLUMN     "apiVersion" TEXT,
ADD COLUMN     "salesforceModifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ArtifactVersion" DROP COLUMN "sourceCode";
