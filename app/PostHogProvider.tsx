"use client";

import { useEffect } from "react";
import { initAnalytics } from "@/lib/analytics";

/** Initializes PostHog once on the client. No-ops without the env key. */
export function PostHogProvider() {
  useEffect(() => {
    initAnalytics();
  }, []);
  return null;
}
