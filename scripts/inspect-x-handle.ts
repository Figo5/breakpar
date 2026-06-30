/**
 * READ-ONLY Step-1 probe: dump external accounts for Clerk users so we can see
 * exactly which field holds the X/Twitter @handle (vs. an opaque provider id).
 * Changes nothing. Run: npx tsx scripts/inspect-x-handle.ts
 */
import { createClerkClient } from "@clerk/backend";

async function main() {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) throw new Error("CLERK_SECRET_KEY not set");
  const clerk = createClerkClient({ secretKey });

  const { data: users } = await clerk.users.getUserList({ limit: 100 });
  console.log(`Scanned ${users.length} Clerk users.\n`);

  for (const u of users) {
    const ext = u.externalAccounts ?? [];
    console.log(`User ${u.id} (${u.username ?? u.firstName ?? "?"}): ${ext.length} external account(s), providers=[${ext.map((e) => e.provider).join(", ")}]`);
    for (const e of ext) {
      console.log(JSON.stringify(
        {
          provider: e.provider,
          providerUserId: e.providerUserId, // opaque id
          username: e.username,             // candidate handle
          firstName: e.firstName,
          lastName: e.lastName,
          emailAddress: e.emailAddress,
          label: e.label,
          publicMetadata: e.publicMetadata,
          approvedScopes: e.approvedScopes,
        },
        null,
        2
      ));
    }
    console.log("");
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
