/**
 * X (Twitter) handle storage + rendering. We store the HANDLE ONLY (no "@",
 * no URL) on the durable User row, validated to X's username rules, and render
 * it as `x.com/handle` — never a raw/clickable URL string we don't control.
 *
 * X usernames: 1–15 chars, letters/digits/underscore only.
 */
const X_HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;

/**
 * Normalise a raw handle (from Clerk's external account, user input, etc.) into
 * the canonical stored form, or null if it isn't a valid X handle. Strips a
 * leading "@" and surrounding whitespace; does NOT accept full URLs.
 */
export function normalizeXHandle(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const h = raw.trim().replace(/^@/, "");
  return X_HANDLE_RE.test(h) ? h : null;
}

/** Display label — what users SEE. Always `x.com/handle`, never a raw URL. */
export function xHandleLabel(handle: string): string {
  return `x.com/${handle}`;
}

/** href target for a link, built from the validated handle. */
export function xHandleUrl(handle: string): string {
  return `https://x.com/${handle}`;
}
