ALTER TABLE "CareerCompetition"
ADD COLUMN "roundsPerPlayer" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "CareerEventRound" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "roundNumber" INTEGER NOT NULL,
    "roundId" TEXT NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "relativeToPar" INTEGER,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CareerEventRound_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CareerEventRound_roundId_key"
ON "CareerEventRound"("roundId");
CREATE UNIQUE INDEX "CareerEventRound_entryId_roundNumber_key"
ON "CareerEventRound"("entryId", "roundNumber");
CREATE INDEX "CareerEventRound_entryId_completed_idx"
ON "CareerEventRound"("entryId", "completed");

ALTER TABLE "CareerEventRound"
ADD CONSTRAINT "CareerEventRound_entryId_fkey"
FOREIGN KEY ("entryId") REFERENCES "CareerEventEntry"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CareerEventRound"
ADD CONSTRAINT "CareerEventRound_roundId_fkey"
FOREIGN KEY ("roundId") REFERENCES "Round"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve existing cards as round one. Settled and active events keep their
-- original format; only not-yet-active events switch to four-round play.
INSERT INTO "CareerEventRound" (
    "id", "entryId", "roundNumber", "roundId", "completed",
    "relativeToPar", "submittedAt", "createdAt"
)
SELECT
    'cer_' || md5(entry."id" || ':round:1'),
    entry."id",
    1,
    entry."roundId",
    round."completed",
    CASE WHEN round."completed" THEN round."relativeToPar" ELSE NULL END,
    CASE WHEN round."completed" THEN entry."submittedAt" ELSE NULL END,
    entry."createdAt"
FROM "CareerEventEntry" entry
JOIN "Round" round ON round."id" = entry."roundId"
WHERE entry."roundId" IS NOT NULL;

UPDATE "CareerCompetition" competition
SET "roundsPerPlayer" = 4
WHERE competition."kind" = 'EVENT'
  AND competition."state" IN ('FORMING', 'LOCKING');
