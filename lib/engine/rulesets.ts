/**
 * Immutable gameplay-engine versions.
 *
 * A Round stores one of these IDs and every resolver/read path dispatches from
 * that stored value. Never reinterpret an existing ID: add a new version when
 * gameplay math changes.
 */
export const STANDARD_V1_RULESET = "standard-v1";
export const STANDARD_V2_RULESET = "standard-v2-casual";

export const GAMEPLAY_RULESET_VERSIONS = [
  STANDARD_V1_RULESET,
  STANDARD_V2_RULESET,
] as const;

export type GameplayRulesetVersion = (typeof GAMEPLAY_RULESET_VERSIONS)[number];

/** Safe default for rows created before ruleset persistence existed. */
export const LEGACY_GAMEPLAY_RULESET: GameplayRulesetVersion = STANDARD_V1_RULESET;

/** Official rules for newly formed non-Career play after the fairness release. */
export const CURRENT_STANDARD_RULESET: GameplayRulesetVersion = STANDARD_V2_RULESET;

const LABELS: Readonly<Record<GameplayRulesetVersion, string>> = {
  [STANDARD_V1_RULESET]: "Standard v1",
  [STANDARD_V2_RULESET]: "Standard",
};

export function isGameplayRulesetVersion(value: unknown): value is GameplayRulesetVersion {
  return typeof value === "string"
    && (GAMEPLAY_RULESET_VERSIONS as readonly string[]).includes(value);
}

export function requireGameplayRulesetVersion(value: unknown): GameplayRulesetVersion {
  if (!isGameplayRulesetVersion(value)) {
    throw new Error(`Unsupported gameplay ruleset "${String(value)}"`);
  }
  return value;
}

/** Resolve an official competitive container's immutable ruleset and, when a
 * stored round is supplied, prove the round still matches that pin. */
export function requirePinnedGameplayRuleset(
  official: unknown,
  storedRound?: unknown,
): GameplayRulesetVersion {
  const version = requireGameplayRulesetVersion(official);
  if (storedRound !== undefined && storedRound !== version) {
    throw new Error(
      `Stored round ruleset "${String(storedRound)}" does not match official "${version}"`,
    );
  }
  return version;
}

export function gameplayRulesetLabel(version: GameplayRulesetVersion): string {
  return LABELS[version];
}

export function usesCasualFairness(version: GameplayRulesetVersion): boolean {
  return version === STANDARD_V2_RULESET;
}

/** Phase 1 accepts no client-selected rules. Routes use this exact presence
 * check so even `null`, an unknown ID, or a forged official ID is rejected
 * rather than silently ignored. */
export function hasClientRulesetOverride(body: unknown): boolean {
  return typeof body === "object"
    && body !== null
    && Object.prototype.hasOwnProperty.call(body, "rulesetVersion");
}
