-- Preserve every pre-release round under the exact engine it originally used.
ALTER TABLE "Round"
ADD COLUMN "rulesetVersion" TEXT NOT NULL DEFAULT 'standard-v1';

-- Competitive containers own the official rules copied into their rounds.
ALTER TABLE "Challenge"
ADD COLUMN "rulesetVersion" TEXT NOT NULL DEFAULT 'standard-v1';

ALTER TABLE "Tournament"
ADD COLUMN "rulesetVersion" TEXT NOT NULL DEFAULT 'standard-v1';

-- Daily needs a day-level pin so a mid-day deployment cannot split the field.
CREATE TABLE "DailyRulesetPin" (
    "dateKey" TEXT NOT NULL,
    "rulesetVersion" TEXT NOT NULL DEFAULT 'standard-v1',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyRulesetPin_pkey" PRIMARY KEY ("dateKey")
);

-- Every Daily day that already has play is historical and therefore v1.
INSERT INTO "DailyRulesetPin" ("dateKey", "rulesetVersion", "createdAt")
SELECT
    "dateKey",
    'standard-v1',
    MIN("playedAt")
FROM "Round"
WHERE "mode" = 'daily' AND "dateKey" IS NOT NULL
GROUP BY "dateKey"
ON CONFLICT ("dateKey") DO NOTHING;
