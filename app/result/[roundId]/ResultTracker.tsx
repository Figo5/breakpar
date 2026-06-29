"use client";

import { useEffect } from "react";
import { track, identifyUser, type RoundMeta } from "@/lib/analytics";

/**
 * Fires result_viewed once on load. `ownRound` distinguishes the player's own
 * card from an incoming share link (the share -> visitor signal). A signed-out
 * share visitor has no durable id yet (userId null) and stays anonymous until
 * they start a round; identify() then merges them into one person.
 */
export function ResultTracker({
  meta,
  ownRound,
  userId,
}: {
  meta: RoundMeta;
  ownRound: boolean;
  userId: string | null;
}) {
  useEffect(() => {
    if (userId) identifyUser(userId);
    track.resultViewed(meta, ownRound);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
