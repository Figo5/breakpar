-- Restore the Career partial unique indexes.
--
-- Prisma's schema language cannot express a FILTERED unique index, so these
-- invariants have always lived in raw migration SQL. They were dropped when the
-- unshipped Career migrations were consolidated; this migration restores them.
--
-- 1. At most one COMMITTED settlement attempt per aggregate. This is the
--    database-level backstop behind "an aggregate settles exactly once": even a
--    buggy or malicious writer cannot record a second committed revision.
CREATE UNIQUE INDEX IF NOT EXISTS "CareerSettlementAttempt_committed_unique"
  ON "CareerSettlementAttempt" ("aggregateType", "aggregateId")
  WHERE "state" = 'COMMITTED';

-- 2. A competitor may hold at most one slot in a Championship field. Nullable
--    columns mean a plain composite unique would not do (NULLs never conflict),
--    so each side is filtered to its own competitor type.
CREATE UNIQUE INDEX IF NOT EXISTS "CareerChampionshipSlot_profile_unique"
  ON "CareerChampionshipSlot" ("championshipId", "profileId")
  WHERE "profileId" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "CareerChampionshipSlot_bot_unique"
  ON "CareerChampionshipSlot" ("championshipId", "botIdentityId")
  WHERE "botIdentityId" IS NOT NULL;
