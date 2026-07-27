-- Immutable per-round bot cards for multi-round Career events.
--
-- Additive only. Existing CareerResult totals are untouched: these rows are the
-- deterministic components that sum to them, materialized during field
-- formation so a leaderboard can be revealed one round at a time.

CREATE TABLE "CareerBotRoundResult" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "lockRevisionId" TEXT NOT NULL,
    "slotId" INTEGER NOT NULL,
    "roundNumber" INTEGER NOT NULL,
    "relativeToPar" INTEGER NOT NULL,
    "seed" TEXT NOT NULL,
    "formulaVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CareerBotRoundResult_pkey" PRIMARY KEY ("id")
);

-- One card per competitor slot per round: duplicates are impossible.
CREATE UNIQUE INDEX "CareerBotRoundResult_lockRevisionId_slotId_roundNumber_key"
  ON "CareerBotRoundResult"("lockRevisionId", "slotId", "roundNumber");

CREATE INDEX "CareerBotRoundResult_competitionId_roundNumber_idx"
  ON "CareerBotRoundResult"("competitionId", "roundNumber");

ALTER TABLE "CareerBotRoundResult"
  ADD CONSTRAINT "CareerBotRoundResult_competitionId_fkey"
  FOREIGN KEY ("competitionId") REFERENCES "CareerCompetition"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CareerBotRoundResult"
  ADD CONSTRAINT "CareerBotRoundResult_lockRevisionId_fkey"
  FOREIGN KEY ("lockRevisionId") REFERENCES "CareerLockRevision"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
