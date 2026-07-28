-- Career v4 is additive and keeps every existing season, Championship, round,
-- score, Legacy row, and settlement snapshot immutable.

ALTER TABLE "Round"
ADD COLUMN "careerSkillSnapshot" JSONB;

ALTER TABLE "CareerProfile"
ADD COLUMN "careerNumber" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "drivingRank" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "approachRank" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "shortGameRank" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "puttingRank" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "developmentPoints" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "foundationPointsEarned" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "retiredAt" TIMESTAMP(3);

ALTER TABLE "CareerCohort"
ADD COLUMN "formulaVersion" TEXT NOT NULL DEFAULT 'career-v3-four-round-events';

ALTER TABLE "CareerChampionship"
ADD COLUMN "formulaVersion" TEXT NOT NULL DEFAULT 'career-v3-four-round-events';

-- All pre-existing worlds have one profile. Number them deterministically
-- before enforcing one numbered Career per player.
WITH numbered AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "userId"
      ORDER BY "createdAt" ASC, "id" ASC
    ) AS career_number
  FROM "CareerProfile"
)
UPDATE "CareerProfile" AS profile
SET "careerNumber" = numbered.career_number
FROM numbered
WHERE profile."id" = numbered."id";

CREATE UNIQUE INDEX "CareerProfile_userId_careerNumber_key"
ON "CareerProfile"("userId", "careerNumber");

CREATE INDEX "CareerProfile_userId_status_idx"
ON "CareerProfile"("userId", "status");

ALTER TABLE "CareerProfile"
ADD CONSTRAINT "CareerProfile_skill_ranks_check"
CHECK (
  "drivingRank" BETWEEN 1 AND 5
  AND "approachRank" BETWEEN 1 AND 5
  AND "shortGameRank" BETWEEN 1 AND 5
  AND "puttingRank" BETWEEN 1 AND 5
),
ADD CONSTRAINT "CareerProfile_development_points_check"
CHECK (
  "developmentPoints" >= 0
  AND "foundationPointsEarned" BETWEEN 0 AND 4
);

CREATE TABLE "CareerDevelopmentLedger" (
  "id" TEXT NOT NULL,
  "profileId" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "seasonNumber" INTEGER,
  "skill" TEXT,
  "points" INTEGER NOT NULL,
  "rankBefore" INTEGER,
  "rankAfter" INTEGER,
  "reason" JSONB NOT NULL,
  "revisionId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CareerDevelopmentLedger_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CareerDevelopmentLedger_profileId_fkey"
    FOREIGN KEY ("profileId") REFERENCES "CareerProfile"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CareerDevelopmentLedger_profileId_sourceType_sourceId_key"
ON "CareerDevelopmentLedger"("profileId", "sourceType", "sourceId");

CREATE INDEX "CareerDevelopmentLedger_profileId_createdAt_idx"
ON "CareerDevelopmentLedger"("profileId", "createdAt");
