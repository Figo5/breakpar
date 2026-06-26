import { currentUser } from "@clerk/nextjs/server";

/**
 * Admin gate. The allowlist lives in the ADMIN_EMAILS env var — a comma-
 * separated list of email addresses. Empty/unset means "no admins", so the
 * panel is locked by default until you set it.
 */
export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** True if the signed-in Clerk user's email is on the allowlist. */
export async function isAdmin(): Promise<boolean> {
  const allow = adminEmails();
  if (allow.length === 0) return false;
  const user = await currentUser();
  if (!user) return false;
  return user.emailAddresses.some((e) => allow.includes(e.emailAddress.toLowerCase()));
}
