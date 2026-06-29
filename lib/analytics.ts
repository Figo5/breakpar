/**
 * Single funnel helper — every PostHog capture routes through here so event
 * names and payloads stay consistent (no scattered posthog.capture calls).
 *
 * Client-only. No-ops cleanly when NEXT_PUBLIC_POSTHOG_KEY is unset, so local
 * dev and CI (which build without the key) never crash. Identity is the
 * server-resolved durable User.id via identifyUser() — that's what makes
 * retention answerable across sessions / guest -> sign-in.
 */
import posthog from "posthog-js";

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";

let ready = false;

/** Init once, client-side, behind the env key. Absent key => stays a no-op. */
export function initAnalytics() {
  if (ready || typeof window === "undefined" || !KEY) return;
  posthog.init(KEY, { api_host: HOST, capture_pageview: true, persistence: "localStorage+cookie" });
  ready = true;
}

/**
 * Tie events to the durable server User.id (behind the guest cookie / Clerk
 * adoption). Calling repeatedly with the same id is idempotent; a returning
 * guest and a guest who later signs in stay ONE PostHog person.
 */
export function identifyUser(userId: string) {
  if (!ready) return;
  posthog.identify(userId);
}

export type Mode = "daily" | "practice";
export interface RoundMeta {
  roundId: string;
  slug: string;
  mode: Mode;
  puzzleNumber?: number | null;
}

function capture(event: string, props: Record<string, unknown>) {
  if (!ready) return;
  posthog.capture(event, props);
}

// Six funnel events. No PII in any payload — ids + game facts only.
export const track = {
  roundStarted: (m: RoundMeta) => capture("round_started", { ...m }),
  holeCompleted: (m: RoundMeta, holeNumber: number, outcome: string) =>
    capture("hole_completed", { ...m, holeNumber, outcome }),
  roundFinished: (m: RoundMeta, score: number, toPar: number, brokePar: boolean) =>
    capture("round_finished", { ...m, score, toPar, brokePar }),
  roundAbandoned: (m: RoundMeta, holesPlayed: number) =>
    capture("round_abandoned", { ...m, holesPlayed }),
  shareClicked: (m: RoundMeta, method: "native" | "clipboard") =>
    capture("share_clicked", { ...m, method }),
  resultViewed: (m: RoundMeta, ownRound: boolean) =>
    capture("result_viewed", { ...m, ownRound }),
};
