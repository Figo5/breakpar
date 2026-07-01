/**
 * Award a SPECIAL/manual trophy (role or event badge) to an account.
 *
 *   tsx scripts/award-special.ts <username> [trophyId=creator]
 *   DATABASE_URL="<direct-url>" tsx scripts/award-special.ts devmain   # prod
 *
 * One-off, run by hand — deliberately NOT an HTTP endpoint (no self-grant path).
 * Resolves the ACCOUNT (clerkId set) with the given username, prints the
 * resolved userId for confirmation, then upserts a TrophyAward row. Idempotent
 * via @@unique([userId, trophyId]) — re-running does nothing.
 *
 * Only accepts trophyIds that are `special` in the catalogue, so this can never
 * grant a played/earned trophy.
 */
import { prisma } from "@/lib/db";
import { TROPHIES } from "@/lib/trophies";

async function main() {
  const username = process.argv[2];
  const trophyId = process.argv[3] ?? "creator";

  if (!username) {
    console.error("usage: tsx scripts/award-special.ts <username> [trophyId=creator]");
    process.exit(1);
  }

  const trophy = TROPHIES.find((t) => t.id === trophyId);
  if (!trophy || !trophy.special) {
    console.error(`Refusing: "${trophyId}" is not a SPECIAL trophy. Special ids: ${TROPHIES.filter((t) => t.special).map((t) => t.id).join(", ") || "(none)"}`);
    process.exit(1);
  }

  // Accounts only (guests never get a profile/badge). The partial-unique index
  // guarantees at most one account per username.
  const user = await prisma.user.findFirst({
    where: { username, clerkId: { not: null } },
    select: { id: true, username: true, clerkId: true },
  });
  if (!user) {
    console.error(`No account found with username "${username}" (clerkId set).`);
    process.exit(1);
  }

  console.log(`Resolved account: userId=${user.id} username=${user.username} clerkId=${user.clerkId}`);
  console.log(`Awarding special trophy "${trophyId}" ("${trophy.label}")…`);

  const existing = await prisma.trophyAward.findUnique({
    where: { userId_trophyId: { userId: user.id, trophyId } },
  });
  if (existing) {
    console.log(`Already awarded (unlockedAt=${existing.unlockedAt?.toISOString() ?? "null"}). No change.`);
  } else {
    const award = await prisma.trophyAward.create({
      data: { userId: user.id, trophyId, unlockedAt: new Date() },
    });
    console.log(`Awarded ✓ (unlockedAt=${award.unlockedAt?.toISOString()})`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
