/**
 * Career Mode operator CLI — READ-ONLY diagnostics plus one bounded, opt-in
 * retry. Never performs unbounded "repair everything" mutation.
 *
 *   npx tsx scripts/career-ops.ts list
 *   npx tsx scripts/career-ops.ts inspect <EVENT|SEASON|CHAMPIONSHIP> <id>
 *   npx tsx scripts/career-ops.ts retry  <EVENT|SEASON|CHAMPIONSHIP> <id> [--commit]
 *
 * `retry` is a dry-run unless `--commit` is passed. It reuses the settlement
 * services (same engine claim entrypoint, trigger="manual"); it never
 * reimplements settlement math.
 */
import { prisma } from "@/lib/db";
import {
  careerManualRetry,
  careerReconcileChampionship,
  careerSettlementCensus,
  type CareerAggregateKind,
} from "@/lib/career/reconcile";

function parseKind(value: string | undefined): CareerAggregateKind {
  if (value === "EVENT" || value === "SEASON" || value === "CHAMPIONSHIP") return value;
  throw new Error(`aggregate type must be EVENT | SEASON | CHAMPIONSHIP, got "${value ?? ""}"`);
}

async function listCommand(): Promise<void> {
  const now = new Date();
  const census = await careerSettlementCensus(prisma, now);
  console.log(JSON.stringify(census, null, 2));

  const endedEvents = await prisma.careerCompetition.findMany({
    where: { kind: "EVENT", state: "ENDED" },
    select: { id: true, deadlineAt: true },
    orderBy: { deadlineAt: "asc" },
    take: 50,
  });
  const endedCohorts = await prisma.careerCohort.findMany({
    where: { state: "ENDED" },
    select: { id: true, worldId: true, seasonNumber: true, tier: true, createdAt: true },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
  const endedChampionships = await prisma.careerChampionship.findMany({
    where: { state: "ENDED" },
    select: { id: true, worldId: true, cycleNumber: true, createdAt: true },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
  console.log("\nENDED EVENT aggregates:", endedEvents);
  console.log("ENDED SEASON aggregates:", endedCohorts);
  console.log("ENDED CHAMPIONSHIP aggregates:", endedChampionships);
}

async function inspectCommand(kind: CareerAggregateKind, id: string): Promise<void> {
  const attempts = await prisma.careerSettlementAttempt.findMany({
    where: { aggregateType: kind, aggregateId: id },
    orderBy: { fencingToken: "desc" },
    select: { fencingToken: true, state: true, owner: true, trigger: true, leaseExpiresAt: true, error: true, updatedAt: true },
  });
  const dry = await careerManualRetry(prisma, kind, id);
  console.log(JSON.stringify({ aggregate: { kind, id, state: dry.state, eligible: dry.eligible }, attempts }, null, 2));
  if (kind === "CHAMPIONSHIP") {
    const issues = await careerReconcileChampionship(prisma, id);
    console.log("championship invariant issues:", issues.length ? issues : "(none)");
  }
}

async function retryCommand(kind: CareerAggregateKind, id: string, commit: boolean): Promise<void> {
  const result = await careerManualRetry(prisma, kind, id, { commit });
  console.log(JSON.stringify(result, null, 2));
  if (!commit) {
    console.log(result.eligible
      ? "\nDRY RUN — pass --commit to settle this aggregate."
      : `\nNot eligible (state ${result.state ?? "not-found"}); nothing to retry.`);
  }
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case "list":
      await listCommand();
      break;
    case "inspect":
      await inspectCommand(parseKind(rest[0]), requireId(rest[1]));
      break;
    case "retry":
      await retryCommand(parseKind(rest[0]), requireId(rest[1]), rest.includes("--commit"));
      break;
    default:
      console.error("usage: career-ops <list|inspect|retry> [EVENT|SEASON|CHAMPIONSHIP] [id] [--commit]");
      process.exitCode = 1;
  }
}

function requireId(value: string | undefined): string {
  if (!value || value.startsWith("--")) throw new Error("an aggregate id is required");
  return value;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
