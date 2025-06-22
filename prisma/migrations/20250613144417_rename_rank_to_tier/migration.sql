/*
  Warnings:

  - You are about to drop the column `rank` on the `User` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "User" DROP COLUMN "rank",
ADD COLUMN     "tier" TEXT NOT NULL DEFAULT 'Basic';
