/**
 * Backfill immutable per-round bot cards for Career events that were formed
 * before `CareerBotRoundResult` existed.
 *
 * This is an OPS script, deliberately not a read path: reads must never
 * regenerate Career state. It rebuilds each event's cards from that event's own
 * pinned lock revision — the stored seed namespace, each slot's ability and
 * tendency, and the formula package the lock was published under — never from
 * today's current bundle.
 *
 * Nothing is written unless every rebuilt bot total equals the total already
 * stored in `CareerResult`. An event that does not verify is reported and left
 * exactly as it is: a lossy split would silently change a live player's rivals.
 *
 *   npx tsx scripts/career-backfill-bot-rounds.ts            # report only
 *   npx tsx scripts/career-backfill-bot-rounds.ts --apply    # write verified cards
 */
import { prisma } from "@/lib/db";
import { rebuildCareerBotRounds } from "@/lib/career/botRounds";

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");

  const competitions = await prisma.careerCompetition.findMany({
    where: { kind: "EVENT", roundsPerPlayer: { gt: 1 } },
    select: { id: true, eventNumber: true, roundsPerPlayer: true },
    orderBy: { createdAt: "asc" },
  });

  let alreadyStored = 0;
  let verified = 0;
  let written = 0;
  const failures: string[] = [];

  for (const competition of competitions) {
    const existing = await prisma.careerBotRoundResult.findMany({
      where: { competitionId: competition.id },
      select: { slotId: true, roundNumber: true, relativeToPar: true, holeScores: true },
    });
    // Cards written before hole detail existed are complete totals with an empty
    // hole array. They still need filling, so "has rows" is not "done".
    const missingHoles = existing.filter((card) => card.holeScores.length === 0);
    if (existing.length > 0 && missingHoles.length === 0) {
      alreadyStored++;
      continue;
    }
    const rebuilt = await rebuildCareerBotRounds(prisma, competition.id);
    if (!rebuilt) {
      failures.push(`${competition.id}: no lock revision to rebuild from`);
      continue;
    }
    if (!rebuilt.verified) {
      const mismatches = rebuilt.slots
        .filter((slot) => !slot.matchesStoredTotal)
        .map((slot) => `slot ${slot.slotId} rebuilt ${slot.total} vs stored ${slot.storedTotal}`);
      failures.push(`${competition.id}: ${mismatches.join("; ")}`);
      continue;
    }

    // Filling hole detail must never move a stored round total. Verify each
    // rebuilt card against the total already on the row before touching it.
    const storedByCard = new Map(
      existing.map((card) => [`${card.slotId}:${card.roundNumber}`, card.relativeToPar]),
    );
    const drifted = rebuilt.slots.flatMap((slot) =>
      slot.cards
        .filter((card) => {
          const stored = storedByCard.get(`${slot.slotId}:${card.roundNumber}`);
          return stored != null && stored !== card.relativeToPar;
        })
        .map((card) => `slot ${slot.slotId} r${card.roundNumber}`));
    if (drifted.length > 0) {
      failures.push(`${competition.id}: rebuilt round total differs at ${drifted.join(", ")}`);
      continue;
    }
    const holeSumDrift = rebuilt.slots.flatMap((slot) =>
      slot.cards
        .filter((card) =>
          card.holeScores.reduce((sum, hole) => sum + hole, 0) !== card.relativeToPar)
        .map((card) => `slot ${slot.slotId} r${card.roundNumber}`));
    if (holeSumDrift.length > 0) {
      failures.push(`${competition.id}: holes do not sum to the round total at ${holeSumDrift.join(", ")}`);
      continue;
    }
    verified++;
    if (!apply) continue;

    if (existing.length === 0) {
      await prisma.careerBotRoundResult.createMany({
        data: rebuilt.slots.flatMap((slot) =>
          slot.cards.map((card) => ({
            competitionId: rebuilt.competitionId,
            lockRevisionId: rebuilt.lockRevisionId,
            slotId: slot.slotId,
            roundNumber: card.roundNumber,
            relativeToPar: card.relativeToPar,
            holeScores: [...card.holeScores],
            seed: card.seed,
            formulaVersion: rebuilt.formulaVersion,
          }))),
        skipDuplicates: true,
      });
    } else {
      // Hole detail only. relativeToPar is deliberately not in the update.
      for (const slot of rebuilt.slots) {
        for (const card of slot.cards) {
          await prisma.careerBotRoundResult.updateMany({
            where: {
              lockRevisionId: rebuilt.lockRevisionId,
              slotId: slot.slotId,
              roundNumber: card.roundNumber,
              holeScores: { isEmpty: true },
            },
            data: { holeScores: [...card.holeScores] },
          });
        }
      }
    }
    written++;
  }

  console.log(`multi-round events:      ${competitions.length}`);
  console.log(`already had cards:       ${alreadyStored}`);
  console.log(`verified reconstruction: ${verified}`);
  console.log(`${apply ? "backfilled" : "would backfill"}:${apply ? "        " : "     "} ${apply ? written : verified}`);
  if (failures.length > 0) {
    console.log(`\nNOT backfilled — exact reconstruction failed (${failures.length}):`);
    for (const failure of failures) console.log(`  ${failure}`);
    console.log("\nThese events keep their locked totals unchanged. Their leaderboards");
    console.log("stay sealed until the player completes every round, at which point the");
    console.log("immutable total is used. No approximation is published.");
  }
  if (!apply && verified > 0) console.log("\nRe-run with --apply to write these cards.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
