/*
  Warnings:

  - Added the required column `engine` to the `Finding` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "AnalysisRunItem" DROP CONSTRAINT "AnalysisRunItem_artifactVersionId_fkey";

-- AlterTable
ALTER TABLE "AnalysisRunItem" ALTER COLUMN "artifactVersionId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Finding" ADD COLUMN     "engine" TEXT NOT NULL;

-- AddForeignKey
ALTER TABLE "AnalysisRunItem" ADD CONSTRAINT "AnalysisRunItem_artifactVersionId_fkey" FOREIGN KEY ("artifactVersionId") REFERENCES "ArtifactVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
