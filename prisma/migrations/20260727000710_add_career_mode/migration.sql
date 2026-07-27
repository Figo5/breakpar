-- CreateEnum
CREATE TYPE "CareerTier" AS ENUM ('LOCAL', 'CHALLENGER', 'PRO');

-- CreateEnum
CREATE TYPE "CareerAbility" AS ENUM ('RUSTY', 'SCRATCH', 'ACE');

-- CreateEnum
CREATE TYPE "CareerTendency" AS ENUM ('CONSERVATIVE', 'BALANCED', 'AGGRESSIVE', 'SITUATIONAL');

-- CreateEnum
CREATE TYPE "CareerProfileStatus" AS ENUM ('ACTIVE', 'PAUSED', 'RETIRED');

-- CreateEnum
CREATE TYPE "CareerCompetitionKind" AS ENUM ('EVENT', 'CHAMPIONSHIP');

-- CreateEnum
CREATE TYPE "CareerCompetitionState" AS ENUM ('FORMING', 'LOCKING', 'LOCKED', 'ACTIVE', 'ENDED', 'SETTLED', 'MANUAL_REVIEW', 'VOID');

-- CreateEnum
CREATE TYPE "CareerCohortState" AS ENUM ('FORMING', 'ACTIVE', 'ENDED', 'SETTLED', 'MANUAL_REVIEW');

-- CreateEnum
CREATE TYPE "CareerAttemptState" AS ENUM ('CLAIMED', 'SNAPSHOTTED', 'CALCULATED', 'COMMITTED', 'FAILED_RETRYABLE', 'SUPERSEDED', 'MANUAL_REVIEW');

-- CreateEnum
CREATE TYPE "CareerAggregateType" AS ENUM ('EVENT', 'SEASON', 'CHAMPIONSHIP', 'QUALIFICATION', 'FIELD_LOCK');

-- CreateEnum
CREATE TYPE "CareerCompetitorType" AS ENUM ('HUMAN', 'BOT');

-- CreateEnum
CREATE TYPE "CareerMovement" AS ENUM ('PROMOTE', 'HOLD', 'RELEGATE', 'INACTIVE');

-- CreateTable
CREATE TABLE "CareerWorld" (
    "id" TEXT NOT NULL,
    "worldKey" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'ACTIVE',
    "formulaVersion" TEXT NOT NULL DEFAULT 'career-v2-player-paced',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CareerWorld_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareerBotIdentity" (
    "id" TEXT NOT NULL,
    "worldId" TEXT NOT NULL,
    "botKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "homeFlavor" TEXT NOT NULL,
    "tendency" "CareerTendency" NOT NULL,
    "recurring" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CareerBotIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareerProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "worldId" TEXT NOT NULL,
    "tier" "CareerTier" NOT NULL DEFAULT 'LOCAL',
    "status" "CareerProfileStatus" NOT NULL DEFAULT 'ACTIVE',
    "movementEvidence" JSONB NOT NULL DEFAULT '[]',
    "legacyTotal" INTEGER NOT NULL DEFAULT 0,
    "currentSeason" INTEGER NOT NULL DEFAULT 1,
    "settledSeasons" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CareerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareerCohort" (
    "id" TEXT NOT NULL,
    "worldId" TEXT NOT NULL,
    "seasonNumber" INTEGER NOT NULL,
    "tier" "CareerTier" NOT NULL,
    "state" "CareerCohortState" NOT NULL DEFAULT 'FORMING',
    "lockedAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "fencingToken" INTEGER NOT NULL DEFAULT 0,
    "claimOwner" TEXT,
    "claimToken" INTEGER,
    "leaseExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CareerCohort_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareerCohortMember" (
    "id" TEXT NOT NULL,
    "cohortId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "slotId" INTEGER NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CareerCohortMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareerCompetition" (
    "id" TEXT NOT NULL,
    "kind" "CareerCompetitionKind" NOT NULL,
    "cohortId" TEXT,
    "eventNumber" INTEGER,
    "championshipId" TEXT,
    "courseId" TEXT NOT NULL,
    "state" "CareerCompetitionState" NOT NULL DEFAULT 'FORMING',
    "targetFieldSize" INTEGER NOT NULL DEFAULT 20,
    "unlocksAt" TIMESTAMP(3) NOT NULL,
    "deadlineAt" TIMESTAMP(3) NOT NULL,
    "fencingToken" INTEGER NOT NULL DEFAULT 0,
    "claimOwner" TEXT,
    "claimToken" INTEGER,
    "leaseExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CareerCompetition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareerEventEntry" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roundId" TEXT,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "relativeToPar" INTEGER,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CareerEventEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareerLockRevision" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "lockHash" TEXT NOT NULL,
    "formulaBundle" JSONB NOT NULL,
    "rosterSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CareerLockRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareerFieldSlot" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "lockRevisionId" TEXT NOT NULL,
    "slotId" INTEGER NOT NULL,
    "competitorType" "CareerCompetitorType" NOT NULL,
    "profileId" TEXT,
    "botIdentityId" TEXT,
    "abilityBand" "CareerAbility",
    "tendency" "CareerTendency",
    "seedNamespace" TEXT NOT NULL,

    CONSTRAINT "CareerFieldSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareerResult" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "lockRevisionId" TEXT NOT NULL,
    "slotId" INTEGER NOT NULL,
    "competitorType" "CareerCompetitorType" NOT NULL,
    "relativeToPar" INTEGER,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "roundId" TEXT,
    "outputHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CareerResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareerEventFinal" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "lockRevisionId" TEXT NOT NULL,
    "formulaVersion" TEXT NOT NULL,
    "standings" JSONB NOT NULL,
    "outputHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CareerEventFinal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareerSeasonSettlement" (
    "id" TEXT NOT NULL,
    "cohortId" TEXT NOT NULL,
    "seasonNumber" INTEGER NOT NULL,
    "formulaVersion" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "inputHash" TEXT NOT NULL,
    "outputHash" TEXT NOT NULL,
    "committedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CareerSeasonSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareerSeasonHistory" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "cohortId" TEXT NOT NULL,
    "worldId" TEXT NOT NULL,
    "seasonNumber" INTEGER NOT NULL,
    "tier" "CareerTier" NOT NULL,
    "nextTier" "CareerTier" NOT NULL,
    "active" BOOLEAN NOT NULL,
    "completedEvents" INTEGER NOT NULL,
    "rank" INTEGER,
    "activeFieldSize" INTEGER NOT NULL,
    "seasonPoints" DOUBLE PRECISION NOT NULL,
    "movement" "CareerMovement" NOT NULL,
    "evidence" JSONB NOT NULL,
    "revisionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CareerSeasonHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareerRatingHistory" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "worldId" TEXT NOT NULL,
    "seasonNumber" INTEGER NOT NULL,
    "rating" DOUBLE PRECISION NOT NULL,
    "active" BOOLEAN NOT NULL,
    "tier" "CareerTier" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CareerRatingHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareerLegacyLedger" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "awardType" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "revisionId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CareerLegacyLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareerTrophy" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "trophyType" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CareerTrophy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareerChampionship" (
    "id" TEXT NOT NULL,
    "worldId" TEXT NOT NULL,
    "cycleNumber" INTEGER NOT NULL,
    "state" "CareerCompetitionState" NOT NULL DEFAULT 'FORMING',
    "deadlineAt" TIMESTAMP(3) NOT NULL,
    "fencingToken" INTEGER NOT NULL DEFAULT 0,
    "claimOwner" TEXT,
    "claimToken" INTEGER,
    "leaseExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CareerChampionship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareerChampionshipSlot" (
    "id" TEXT NOT NULL,
    "championshipId" TEXT NOT NULL,
    "slotNumber" INTEGER NOT NULL,
    "competitorType" "CareerCompetitorType" NOT NULL,
    "profileId" TEXT,
    "botIdentityId" TEXT,
    "source" TEXT NOT NULL,
    "sourceTrace" JSONB NOT NULL,

    CONSTRAINT "CareerChampionshipSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareerChampionshipResult" (
    "id" TEXT NOT NULL,
    "championshipId" TEXT NOT NULL,
    "slotNumber" INTEGER NOT NULL,
    "competitorType" "CareerCompetitorType" NOT NULL,
    "profileId" TEXT,
    "botIdentityId" TEXT,
    "relativeToPar" INTEGER,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "roundId" TEXT,
    "outputHash" TEXT,
    "rank" INTEGER,
    "isWinner" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "CareerChampionshipResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareerSettlementAttempt" (
    "id" TEXT NOT NULL,
    "aggregateType" "CareerAggregateType" NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "fencingToken" INTEGER NOT NULL,
    "state" "CareerAttemptState" NOT NULL DEFAULT 'CLAIMED',
    "owner" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "codeRevision" TEXT,
    "leaseExpiresAt" TIMESTAMP(3) NOT NULL,
    "formulaBundleVersion" TEXT,
    "inputHash" TEXT,
    "outputHash" TEXT,
    "inputSnapshot" JSONB,
    "outputSnapshot" JSONB,
    "expectedEffectCount" INTEGER,
    "error" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CareerSettlementAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareerStagedEffect" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "effectKey" TEXT NOT NULL,
    "effectType" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "isOutbox" BOOLEAN NOT NULL DEFAULT false,
    "payload" JSONB NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CareerStagedEffect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareerCommittedEffect" (
    "id" TEXT NOT NULL,
    "aggregateType" "CareerAggregateType" NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "committedRevisionId" TEXT NOT NULL,
    "effectKey" TEXT NOT NULL,
    "effectType" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "isOutbox" BOOLEAN NOT NULL DEFAULT false,
    "payload" JSONB NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CareerCommittedEffect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareerOutbox" (
    "id" TEXT NOT NULL,
    "committedRevisionId" TEXT NOT NULL,
    "effectType" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "deliveredAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CareerOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareerOperatorAudit" (
    "id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "aggregateType" "CareerAggregateType" NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "expectedState" TEXT,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CareerOperatorAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CareerWorld_worldKey_key" ON "CareerWorld"("worldKey");

-- CreateIndex
CREATE INDEX "CareerBotIdentity_worldId_recurring_idx" ON "CareerBotIdentity"("worldId", "recurring");

-- CreateIndex
CREATE UNIQUE INDEX "CareerBotIdentity_worldId_botKey_key" ON "CareerBotIdentity"("worldId", "botKey");

-- CreateIndex
CREATE INDEX "CareerProfile_worldId_tier_idx" ON "CareerProfile"("worldId", "tier");

-- CreateIndex
CREATE UNIQUE INDEX "CareerProfile_userId_worldId_key" ON "CareerProfile"("userId", "worldId");

-- CreateIndex
CREATE INDEX "CareerCohort_state_idx" ON "CareerCohort"("state");

-- CreateIndex
CREATE UNIQUE INDEX "CareerCohort_worldId_seasonNumber_tier_key" ON "CareerCohort"("worldId", "seasonNumber", "tier");

-- CreateIndex
CREATE INDEX "CareerCohortMember_profileId_idx" ON "CareerCohortMember"("profileId");

-- CreateIndex
CREATE UNIQUE INDEX "CareerCohortMember_cohortId_profileId_key" ON "CareerCohortMember"("cohortId", "profileId");

-- CreateIndex
CREATE UNIQUE INDEX "CareerCohortMember_cohortId_slotId_key" ON "CareerCohortMember"("cohortId", "slotId");

-- CreateIndex
CREATE INDEX "CareerCompetition_state_deadlineAt_idx" ON "CareerCompetition"("state", "deadlineAt");

-- CreateIndex
CREATE UNIQUE INDEX "CareerCompetition_cohortId_eventNumber_key" ON "CareerCompetition"("cohortId", "eventNumber");

-- CreateIndex
CREATE UNIQUE INDEX "CareerEventEntry_roundId_key" ON "CareerEventEntry"("roundId");

-- CreateIndex
CREATE INDEX "CareerEventEntry_userId_idx" ON "CareerEventEntry"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CareerEventEntry_competitionId_profileId_key" ON "CareerEventEntry"("competitionId", "profileId");

-- CreateIndex
CREATE UNIQUE INDEX "CareerEventEntry_competitionId_memberId_key" ON "CareerEventEntry"("competitionId", "memberId");

-- CreateIndex
CREATE UNIQUE INDEX "CareerLockRevision_competitionId_revision_key" ON "CareerLockRevision"("competitionId", "revision");

-- CreateIndex
CREATE INDEX "CareerFieldSlot_competitionId_competitorType_idx" ON "CareerFieldSlot"("competitionId", "competitorType");

-- CreateIndex
CREATE UNIQUE INDEX "CareerFieldSlot_lockRevisionId_slotId_key" ON "CareerFieldSlot"("lockRevisionId", "slotId");

-- CreateIndex
CREATE UNIQUE INDEX "CareerResult_lockRevisionId_slotId_key" ON "CareerResult"("lockRevisionId", "slotId");

-- CreateIndex
CREATE UNIQUE INDEX "CareerEventFinal_competitionId_lockRevisionId_formulaVersio_key" ON "CareerEventFinal"("competitionId", "lockRevisionId", "formulaVersion");

-- CreateIndex
CREATE UNIQUE INDEX "CareerSeasonSettlement_cohortId_key" ON "CareerSeasonSettlement"("cohortId");

-- CreateIndex
CREATE INDEX "CareerSeasonHistory_worldId_seasonNumber_idx" ON "CareerSeasonHistory"("worldId", "seasonNumber");

-- CreateIndex
CREATE UNIQUE INDEX "CareerSeasonHistory_profileId_cohortId_key" ON "CareerSeasonHistory"("profileId", "cohortId");

-- CreateIndex
CREATE UNIQUE INDEX "CareerRatingHistory_profileId_worldId_seasonNumber_key" ON "CareerRatingHistory"("profileId", "worldId", "seasonNumber");

-- CreateIndex
CREATE INDEX "CareerLegacyLedger_profileId_idx" ON "CareerLegacyLedger"("profileId");

-- CreateIndex
CREATE UNIQUE INDEX "CareerLegacyLedger_profileId_sourceType_sourceId_awardType_key" ON "CareerLegacyLedger"("profileId", "sourceType", "sourceId", "awardType");

-- CreateIndex
CREATE UNIQUE INDEX "CareerTrophy_profileId_sourceType_sourceId_trophyType_key" ON "CareerTrophy"("profileId", "sourceType", "sourceId", "trophyType");

-- CreateIndex
CREATE UNIQUE INDEX "CareerChampionship_worldId_cycleNumber_key" ON "CareerChampionship"("worldId", "cycleNumber");

-- CreateIndex
CREATE UNIQUE INDEX "CareerChampionshipSlot_championshipId_slotNumber_key" ON "CareerChampionshipSlot"("championshipId", "slotNumber");

-- CreateIndex
CREATE UNIQUE INDEX "CareerChampionshipResult_roundId_key" ON "CareerChampionshipResult"("roundId");

-- CreateIndex
CREATE UNIQUE INDEX "CareerChampionshipResult_championshipId_slotNumber_key" ON "CareerChampionshipResult"("championshipId", "slotNumber");

-- CreateIndex
CREATE INDEX "CareerSettlementAttempt_aggregateType_aggregateId_state_idx" ON "CareerSettlementAttempt"("aggregateType", "aggregateId", "state");

-- CreateIndex
CREATE INDEX "CareerSettlementAttempt_state_leaseExpiresAt_idx" ON "CareerSettlementAttempt"("state", "leaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "CareerSettlementAttempt_aggregateType_aggregateId_fencingTo_key" ON "CareerSettlementAttempt"("aggregateType", "aggregateId", "fencingToken");

-- CreateIndex
CREATE INDEX "CareerStagedEffect_attemptId_idx" ON "CareerStagedEffect"("attemptId");

-- CreateIndex
CREATE UNIQUE INDEX "CareerStagedEffect_attemptId_effectKey_key" ON "CareerStagedEffect"("attemptId", "effectKey");

-- CreateIndex
CREATE UNIQUE INDEX "CareerCommittedEffect_effectKey_key" ON "CareerCommittedEffect"("effectKey");

-- CreateIndex
CREATE INDEX "CareerCommittedEffect_aggregateType_aggregateId_idx" ON "CareerCommittedEffect"("aggregateType", "aggregateId");

-- CreateIndex
CREATE INDEX "CareerCommittedEffect_committedRevisionId_idx" ON "CareerCommittedEffect"("committedRevisionId");

-- CreateIndex
CREATE INDEX "CareerOutbox_deliveredAt_idx" ON "CareerOutbox"("deliveredAt");

-- CreateIndex
CREATE UNIQUE INDEX "CareerOutbox_committedRevisionId_effectType_scope_key" ON "CareerOutbox"("committedRevisionId", "effectType", "scope");

-- AddForeignKey
ALTER TABLE "CareerBotIdentity" ADD CONSTRAINT "CareerBotIdentity_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "CareerWorld"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerProfile" ADD CONSTRAINT "CareerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerProfile" ADD CONSTRAINT "CareerProfile_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "CareerWorld"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerCohort" ADD CONSTRAINT "CareerCohort_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "CareerWorld"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerCohortMember" ADD CONSTRAINT "CareerCohortMember_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "CareerCohort"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerCohortMember" ADD CONSTRAINT "CareerCohortMember_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "CareerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerCompetition" ADD CONSTRAINT "CareerCompetition_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "CareerCohort"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerCompetition" ADD CONSTRAINT "CareerCompetition_championshipId_fkey" FOREIGN KEY ("championshipId") REFERENCES "CareerChampionship"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerCompetition" ADD CONSTRAINT "CareerCompetition_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerEventEntry" ADD CONSTRAINT "CareerEventEntry_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "CareerCompetition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerEventEntry" ADD CONSTRAINT "CareerEventEntry_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "CareerCohortMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerEventEntry" ADD CONSTRAINT "CareerEventEntry_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "CareerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerEventEntry" ADD CONSTRAINT "CareerEventEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerEventEntry" ADD CONSTRAINT "CareerEventEntry_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "Round"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerLockRevision" ADD CONSTRAINT "CareerLockRevision_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "CareerCompetition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerFieldSlot" ADD CONSTRAINT "CareerFieldSlot_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "CareerCompetition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerFieldSlot" ADD CONSTRAINT "CareerFieldSlot_lockRevisionId_fkey" FOREIGN KEY ("lockRevisionId") REFERENCES "CareerLockRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerFieldSlot" ADD CONSTRAINT "CareerFieldSlot_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "CareerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerFieldSlot" ADD CONSTRAINT "CareerFieldSlot_botIdentityId_fkey" FOREIGN KEY ("botIdentityId") REFERENCES "CareerBotIdentity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerResult" ADD CONSTRAINT "CareerResult_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "CareerCompetition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerResult" ADD CONSTRAINT "CareerResult_lockRevisionId_fkey" FOREIGN KEY ("lockRevisionId") REFERENCES "CareerLockRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerEventFinal" ADD CONSTRAINT "CareerEventFinal_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "CareerCompetition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerSeasonSettlement" ADD CONSTRAINT "CareerSeasonSettlement_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "CareerCohort"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerSeasonHistory" ADD CONSTRAINT "CareerSeasonHistory_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "CareerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerRatingHistory" ADD CONSTRAINT "CareerRatingHistory_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "CareerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerLegacyLedger" ADD CONSTRAINT "CareerLegacyLedger_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "CareerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerTrophy" ADD CONSTRAINT "CareerTrophy_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "CareerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerChampionship" ADD CONSTRAINT "CareerChampionship_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "CareerWorld"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerChampionshipSlot" ADD CONSTRAINT "CareerChampionshipSlot_championshipId_fkey" FOREIGN KEY ("championshipId") REFERENCES "CareerChampionship"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerChampionshipSlot" ADD CONSTRAINT "CareerChampionshipSlot_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "CareerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerChampionshipSlot" ADD CONSTRAINT "CareerChampionshipSlot_botIdentityId_fkey" FOREIGN KEY ("botIdentityId") REFERENCES "CareerBotIdentity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerChampionshipResult" ADD CONSTRAINT "CareerChampionshipResult_championshipId_fkey" FOREIGN KEY ("championshipId") REFERENCES "CareerChampionship"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerChampionshipResult" ADD CONSTRAINT "CareerChampionshipResult_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "CareerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerChampionshipResult" ADD CONSTRAINT "CareerChampionshipResult_botIdentityId_fkey" FOREIGN KEY ("botIdentityId") REFERENCES "CareerBotIdentity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerChampionshipResult" ADD CONSTRAINT "CareerChampionshipResult_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "Round"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerStagedEffect" ADD CONSTRAINT "CareerStagedEffect_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "CareerSettlementAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
