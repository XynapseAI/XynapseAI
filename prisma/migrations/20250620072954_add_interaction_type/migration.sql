/*
  Warnings:

  - A unique constraint covering the columns `[userId,date,interactionType]` on the table `DailyAIInteraction` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "DailyAIInteraction_userId_date_key";

-- AlterTable
ALTER TABLE "AIInteraction" ADD COLUMN     "interactionType" TEXT NOT NULL DEFAULT 'chat';

-- AlterTable
ALTER TABLE "DailyAIInteraction" ADD COLUMN     "interactionType" TEXT NOT NULL DEFAULT 'chat';

-- CreateIndex
CREATE UNIQUE INDEX "DailyAIInteraction_userId_date_interactionType_key" ON "DailyAIInteraction"("userId", "date", "interactionType");
