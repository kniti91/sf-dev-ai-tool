-- AlterTable
ALTER TABLE "AnalysisRun" ADD COLUMN     "aiModel" TEXT,
ADD COLUMN     "aiProvider" TEXT,
ADD COLUMN     "promptVersion" TEXT;

-- AlterTable
ALTER TABLE "ComponentAnalysisResult" ADD COLUMN     "aiScore" INTEGER,
ADD COLUMN     "categoryScores" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "combinedScore" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "requiresHumanReview" BOOLEAN NOT NULL DEFAULT false;
