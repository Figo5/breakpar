/**
 * Clears the PREVIEW/test entries (and their rounds, via cascade) from the
 * CURRENT tournament, so it launches with an empty board and your attempts reset.
 *
 * Safe + scoped: only deletes TournamentEntry rows for the active tournament.
 * Deleting an entry cascades to its tournament rounds ONLY (Round.tournamentEntryId
 * onDelete: Cascade). It NEVER touches daily/challenge/unlimited rounds, other
 * tournaments, users, or any other data.
 *
 * Runs a DRY RUN first (prints what it would delete). Set CONFIRM=1 to actually delete.
 *
 * Usage:
 *   npx tsx scripts/clear-tournament-preview.ts            # dry run (shows what it'd delete)
 *   CONFIRM=1 npx tsx scripts/clear-tournament-preview.ts  # actually delete
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const now = new Date();

  // Find the current/upcoming tournament (the one about to go live).
  const t = await prisma.tournament.findFirst({
    where: { endsAt: { gt: now } },
    orderBy: { startsAt: "asc" },
  });

  if (!t) {
    console.log("No active/upcoming tournament found. Nothing to do.");
    return;
  }

  console.log(`Tournament: ${t.name} (weekKey ${t.weekKey}, id ${t.id})`);
  console.log(`  starts ${t.startsAt.toISOString()}  ends ${t.endsAt.toISOString()}`);

  // Show the entries that would be deleted.
  const entries = await prisma.tournamentEntry.findMany({
    where: { tournamentId: t.id },
    select: {
      id: true,
      user: { select: { username: true } },
      _count: { select: { rounds: true } },
    },
  });

  if (entries.length === 0) {
    console.log("No entries in this tournament — already clean.");
    return;
  }

  console.log(`\nEntries to delete (${entries.length}):`);
  for (const e of entries) {
    console.log(`  - ${e.user.username}  (${e._count.rounds} tournament round(s), entryId ${e.id})`);
  }

  if (process.env.CONFIRM !== "1") {
    console.log(`\n[DRY RUN] Nothing deleted. Re-run with CONFIRM=1 to delete the above.`);
    return;
  }

  // Delete — cascade removes the linked tournament rounds automatically.
  const result = await prisma.tournamentEntry.deleteMany({ where: { tournamentId: t.id } });
  // Also clear the cut cache so a fresh cut computes later if needed.
  await prisma.tournament.update({
    where: { id: t.id },
    data: { cutComputedAt: null, status: "upcoming", winnerUserId: null },
  });

  console.log(`\n✅ Deleted ${result.count} ent(y|ies) and their tournament rounds (cascade).`);
  console.log(`   Tournament reset to a clean 'upcoming' state. Board is now empty.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
