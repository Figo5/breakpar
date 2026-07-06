-- Tournaments (additive). New tables + new nullable columns on Round.
-- No changes to existing data: all new columns are nullable, all new tables empty.

-- Round: tournament linkage (nullable — existing rows untouched)
ALTER TABLE "Round" ADD COLUMN "tournamentEntryId" TEXT;
ALTER TABLE "Round" ADD COLUMN "tournamentRoundNo" INTEGER;

-- Tournament
CREATE TABLE "Tournament" (
  "id" TEXT NOT NULL,
  "weekKey" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "name" TEXT NOT NULL DEFAULT 'Weekly Tournament',
  "startsAt" TIMESTAMP(3) NOT NULL,
  "cutAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "cutPercent" INTEGER NOT NULL DEFAULT 30,
  "cutMin" INTEGER NOT NULL DEFAULT 20,
  "status" TEXT NOT NULL DEFAULT 'upcoming',
  "cutComputedAt" TIMESTAMP(3),
  "winnerUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Tournament_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Tournament_weekKey_key" ON "Tournament"("weekKey");
CREATE INDEX "Tournament_status_idx" ON "Tournament"("status");

-- TournamentEntry
CREATE TABLE "TournamentEntry" (
  "id" TEXT NOT NULL,
  "tournamentId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "madeCut" BOOLEAN,
  "withdrawn" BOOLEAN NOT NULL DEFAULT false,
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TournamentEntry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TournamentEntry_tournamentId_userId_key" ON "TournamentEntry"("tournamentId", "userId");
CREATE INDEX "TournamentEntry_tournamentId_idx" ON "TournamentEntry"("tournamentId");
CREATE INDEX "TournamentEntry_userId_idx" ON "TournamentEntry"("userId");

-- Round unique on (tournamentEntryId, tournamentRoundNo): one attempt per round.
-- Postgres treats NULLs as distinct, so non-tournament rounds (both null) are unaffected.
CREATE UNIQUE INDEX "Round_tournamentEntryId_tournamentRoundNo_key" ON "Round"("tournamentEntryId", "tournamentRoundNo");

-- Foreign keys
ALTER TABLE "Tournament" ADD CONSTRAINT "Tournament_courseId_fkey"
  FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TournamentEntry" ADD CONSTRAINT "TournamentEntry_tournamentId_fkey"
  FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TournamentEntry" ADD CONSTRAINT "TournamentEntry_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Round" ADD CONSTRAINT "Round_tournamentEntryId_fkey"
  FOREIGN KEY ("tournamentEntryId") REFERENCES "TournamentEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
