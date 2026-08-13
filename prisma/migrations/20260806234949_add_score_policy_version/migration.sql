/*
  Warnings:

  - Added the required column `scorePolicyVersion` to the `AnalysisRun` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "AnalysisRun" ADD COLUMN     "scorePolicyVersion" TEXT NOT NULL;
