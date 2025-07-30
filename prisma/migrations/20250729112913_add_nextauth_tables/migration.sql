/*
  Warnings:

  - The primary key for the `users` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - Made the column `uid` on table `daily_ai_interactions` required. This step will fail if there are existing NULL values in that column.
  - Made the column `interaction_type` on table `daily_ai_interactions` required. This step will fail if there are existing NULL values in that column.
  - Made the column `user_id` on table `task_completions` required. This step will fail if there are existing NULL values in that column.
  - Made the column `task_id` on table `task_completions` required. This step will fail if there are existing NULL values in that column.
  - Made the column `user_id` on table `tweet_analyses` required. This step will fail if there are existing NULL values in that column.
  - Made the column `tweet_id` on table `tweet_analyses` required. This step will fail if there are existing NULL values in that column.
  - Made the column `email` on table `users` required. This step will fail if there are existing NULL values in that column.
  - Made the column `name` on table `watchlists` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "daily_ai_interactions" ALTER COLUMN "uid" SET NOT NULL,
ALTER COLUMN "interaction_type" SET NOT NULL;

-- AlterTable
ALTER TABLE "large_flows" ALTER COLUMN "chain" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "task_completions" ALTER COLUMN "user_id" SET NOT NULL,
ALTER COLUMN "task_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "tweet_analyses" ALTER COLUMN "user_id" SET NOT NULL,
ALTER COLUMN "tweet_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "users" DROP CONSTRAINT "users_pkey",
ALTER COLUMN "id" SET DATA TYPE TEXT,
ALTER COLUMN "email" SET NOT NULL,
ALTER COLUMN "email" SET DATA TYPE TEXT,
ALTER COLUMN "google_id" SET DATA TYPE TEXT,
ALTER COLUMN "google_name" SET DATA TYPE TEXT,
ALTER COLUMN "wallet_address" SET DATA TYPE TEXT,
ALTER COLUMN "tier" SET DATA TYPE TEXT,
ALTER COLUMN "premium_expires_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "api_key" SET DATA TYPE TEXT,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "last_connected" SET DATA TYPE TIMESTAMP(3),
ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "watchlists" ALTER COLUMN "user_id" SET DATA TYPE TEXT,
ALTER COLUMN "wallet_address" SET DATA TYPE TEXT,
ALTER COLUMN "name" SET NOT NULL,
ALTER COLUMN "name" SET DATA TYPE TEXT;

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationToken" ADD CONSTRAINT "VerificationToken_identifier_fkey" FOREIGN KEY ("identifier") REFERENCES "users"("email") ON DELETE CASCADE ON UPDATE CASCADE;
