import type { PrismaClient } from "@prisma/client";
import {
  CURRENT_STANDARD_RULESET,
  requireGameplayRulesetVersion,
  type GameplayRulesetVersion,
} from "@/lib/engine/rulesets";

/**
 * Resolve (and, on first play, persist) the official rules for one Daily day.
 *
 * The historical-round lookup is a defensive bridge for databases that may
 * contain imported Daily rows without a corresponding pin. The migration
 * performs the same backfill for ordinary deployments.
 */
export async function officialDailyRuleset(
  db: PrismaClient,
  dateKey: string,
): Promise<GameplayRulesetVersion> {
  const pin = await db.dailyRulesetPin.findUnique({
    where: { dateKey },
    select: { rulesetVersion: true },
  });
  if (pin) return requireGameplayRulesetVersion(pin.rulesetVersion);

  const historical = await db.round.findFirst({
    where: { mode: "daily", dateKey },
    orderBy: { playedAt: "asc" },
    select: { rulesetVersion: true },
  });
  const rulesetVersion = historical
    ? requireGameplayRulesetVersion(historical.rulesetVersion)
    : CURRENT_STANDARD_RULESET;

  const persisted = await db.dailyRulesetPin.upsert({
    where: { dateKey },
    update: {},
    create: { dateKey, rulesetVersion },
    select: { rulesetVersion: true },
  });
  return requireGameplayRulesetVersion(persisted.rulesetVersion);
}
