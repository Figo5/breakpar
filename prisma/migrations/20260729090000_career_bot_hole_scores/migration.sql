-- Per-hole detail for immutable Career bot cards.
--
-- Additive only. Existing cards keep their relativeToPar untouched and simply
-- carry an empty array until the backfill writes their holes; the read path
-- falls back to whole-round reveal for those rather than inventing a split.

ALTER TABLE "CareerBotRoundResult"
  ADD COLUMN "holeScores" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
