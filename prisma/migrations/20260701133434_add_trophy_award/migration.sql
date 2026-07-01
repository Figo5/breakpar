-- CreateTable
CREATE TABLE "TrophyAward" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "trophyId" TEXT NOT NULL,
    "unlockedAt" TIMESTAMP(3),

    CONSTRAINT "TrophyAward_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrophyAward_userId_idx" ON "TrophyAward"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TrophyAward_userId_trophyId_key" ON "TrophyAward"("userId", "trophyId");

-- AddForeignKey
ALTER TABLE "TrophyAward" ADD CONSTRAINT "TrophyAward_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
