import { currentUser } from "@clerk/nextjs/server";

/**
 * Admin gate. The allowlist lives in env vars — comma-separated lists:
 *   ADMIN_USERNAMES — Clerk usernames (use this for username/password sign-in)
 *   ADMIN_EMAILS    — email addresses (if your Clerk account has an email)
 * Empty/unset on both means "no admins", so the panel is locked by default.
 */
function parseList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function adminEmails(): string[] {
  return parseList(process.env.ADMIN_EMAILS);
}

export function adminUsernames(): string[] {
  return parseList(process.env.ADMIN_USERNAMES);
}

/** True if anyone is configured as an admin (either list is non-empty). */
export function adminConfigured(): boolean {
  return adminEmails().length > 0 || adminUsernames().length > 0;
}

/** True if the signed-in Clerk user matches the email OR username allowlist. */
export async function isAdmin(): Promise<boolean> {
  if (!adminConfigured()) return false;
  const user = await currentUser();
  if (!user) return false;

  const emails = adminEmails();
  if (emails.length && user.emailAddresses.some((e) => emails.includes(e.emailAddress.toLowerCase())))
    return true;

  const usernames = adminUsernames();
  if (usernames.length && user.username && usernames.includes(user.username.toLowerCase()))
    return true;

  return false;
}
