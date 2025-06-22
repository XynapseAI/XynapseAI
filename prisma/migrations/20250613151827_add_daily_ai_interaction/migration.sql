/*
  Warnings:

  - A unique constraint covering the columns `[userId,taskId,completedAt]` on the table `TaskCompletion` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "TaskCompletion_userId_taskId_key";

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "isDaily" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "maxCompletions" INTEGER,
ALTER COLUMN "link" DROP NOT NULL;

-- AlterTable
ALTER TABLE "TaskCompletion" ADD COLUMN     "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "completionCount" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "DailyAIInteraction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "count" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "DailyAIInteraction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DailyAIInteraction_userId_date_key" ON "DailyAIInteraction"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "TaskCompletion_userId_taskId_completedAt_key" ON "TaskCompletion"("userId", "taskId", "completedAt");

-- AddForeignKey
ALTER TABLE "DailyAIInteraction" ADD CONSTRAINT "DailyAIInteraction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
