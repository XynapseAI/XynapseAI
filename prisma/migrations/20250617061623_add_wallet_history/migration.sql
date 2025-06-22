-- CreateTable
CREATE TABLE "WalletHistory" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletHistory_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "WalletHistory" ADD CONSTRAINT "WalletHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
