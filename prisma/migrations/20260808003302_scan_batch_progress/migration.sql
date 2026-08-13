-- AlterTable
ALTER TABLE "AnalysisRun" ADD COLUMN     "currentBatch" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "currentStage" TEXT NOT NULL DEFAULT 'queued',
ADD COLUMN     "failedArtifactCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "totalBatches" INTEGER NOT NULL DEFAULT 0;
