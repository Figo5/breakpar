import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  CAREER_CANONICAL_VERSION,
  canonicalHash,
  canonicalStringify,
  careerCalendarInstant,
  inputHash,
  outputHash,
  payloadHash,
} from "@/lib/career/canonical";
import {
  CAREER_BOT_ROSTER_SIZE,
  CAREER_RECURRING_BOT_COUNT,
  assignCareerBotSlots,
  botInitials,
  generateCareerBotRoster,
  validateCareerBotRoster,
} from "@/lib/career/botRoster";
import { careerEffectKey } from "@/lib/career/effectKeys";
import {
  CAREER_COMPONENT_VERSIONS,
  CAREER_FORMULA_VERSION,
  CAREER_V1_FORMULA_BUNDLE,
  CAREER_V1_FORMULA_VERSION,
  CAREER_V2_FORMULA_BUNDLE,
  CAREER_V3_FORMULA_BUNDLE,
  getCareerFormulaBundle,
  listCareerFormulaVersions,
  pinCareerFormulaBundle,
  requireCareerFormulaBundle,
} from "@/lib/career/formulaBundle";
import { botAbilityForSlot } from "@/lib/career/simulator";
import {
  CAREER_BASE_FIELD_SIZE,
  CAREER_EVENTS_PER_SEASON,
  CAREER_NO_DEADLINE,
  careerJourneyKey,
} from "@/lib/career/constants";
import { calculateCareerEventStandings } from "@/lib/career/eventSettlement";

describe("Career canonical serialization", () => {
  it("sorts object keys recursively while preserving array order and explicit nulls", () => {
    const first = { z: [{ b: 2, a: 1 }, null], a: "value" };
    const second = { a: "value", z: [{ a: 1, b: 2 }, null] };
    expect(canonicalStringify(first)).toBe('{"a":"value","z":[{"a":1,"b":2},null]}');
    expect(canonicalStringify(second)).toBe(canonicalStringify(first));
    expect(canonicalHash(second)).toBe(canonicalHash(first));
    expect(canonicalHash({ values: [1, 2] })).not.toBe(canonicalHash({ values: [2, 1] }));
    expect(canonicalHash({ value: null })).not.toBe(canonicalHash({}));
  });

  it("normalizes UTC Dates and negative zero", () => {
    expect(canonicalStringify({
      instant: new Date("2026-07-23T12:34:56.789Z"),
      score: -0,
    })).toBe('{"instant":"2026-07-23T12:34:56.789Z","score":0}');
  });

  it("produces standard SHA-256 hashes and named snapshot aliases", () => {
    const value = { a: 1, b: 2 };
    const expected = createHash("sha256").update('{"a":1,"b":2}').digest("hex");
    expect(canonicalHash(value)).toBe(expected);
    expect(inputHash(value)).toBe(expected);
    expect(outputHash(value)).toBe(expected);
    expect(payloadHash(value)).toBe(expected);
    expect(CAREER_CANONICAL_VERSION).toBe("career-canonical-json-v1");
  });

  it("emits fractions that survive a PostgreSQL jsonb round trip", () => {
    // A double needs up to 17 significant digits to round-trip exactly, but
    // jsonb normalizes to 16 — which yields a DIFFERENT double on read-back and
    // fails snapshot hash verification. Canonical form uses 15 digits so that
    // serialize → persist → read → serialize is stable.
    // 19 competitors tied at rank one in a 20-field average to this value.
    const tiedPoints = Array.from({ length: 19 }, (_, index) => (100 * (20 - (index + 1))) / 19)
      .reduce((sum, value) => sum + value, 0) / 19;
    expect(JSON.stringify(tiedPoints)).toBe("52.631578947368425"); // 17 digits, unsafe
    expect(canonicalStringify({ points: tiedPoints })).toBe('{"points":52.6315789473684}');

    // Re-serializing the parsed canonical form is a fixed point.
    const once = canonicalStringify({ points: tiedPoints });
    expect(canonicalStringify(JSON.parse(once))).toBe(once);
    expect(canonicalHash(JSON.parse(once))).toBe(canonicalHash({ points: tiedPoints }));

    // Integers and exact fractions are untouched.
    expect(canonicalStringify({ a: 100, b: 0.5, c: -3 })).toBe('{"a":100,"b":0.5,"c":-3}');
  });

  it("rejects values that persisted JSON could silently lose or round", () => {
    expect(() => canonicalStringify({ missing: undefined })).toThrow(/explicit null/);
    expect(() => canonicalStringify([, 1])).toThrow(/sparse arrays/);
    expect(() => canonicalStringify(Number.NaN)).toThrow(/finite/);
    expect(() => canonicalStringify(Number.POSITIVE_INFINITY)).toThrow(/finite/);
    expect(() => canonicalStringify(Number.MAX_SAFE_INTEGER + 1)).toThrow(/safe integer/);
    expect(() => canonicalStringify(1n)).toThrow(/bigint/);
    expect(() => canonicalStringify({ [Symbol("hidden")]: 1 })).toThrow(/symbol properties/);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => canonicalStringify(circular)).toThrow(/circular/);
  });

  it("pairs UTC instants with DST-aware Eastern civil keys", () => {
    expect(careerCalendarInstant(new Date("2026-03-08T04:59:59.000Z"))).toEqual({
      utcInstant: "2026-03-08T04:59:59.000Z",
      easternDateKey: "2026-03-07",
    });
    expect(careerCalendarInstant(new Date("2026-03-08T05:00:00.000Z"))).toEqual({
      utcInstant: "2026-03-08T05:00:00.000Z",
      easternDateKey: "2026-03-08",
    });
  });
});

describe("Career effect keys", () => {
  it("implements every exact Gate 4 idempotency namespace", () => {
    expect(careerEffectKey.fieldLock("event", 2)).toBe("career:field-lock:event:2");
    expect(careerEffectKey.botResult("event", 2, 7, "v1")).toBe("career:bot-result:event:2:7:v1");
    expect(careerEffectKey.eventFinal("event", 2, "v1")).toBe("career:event-final:event:2:v1");
    expect(careerEffectKey.eventStanding("final", "player")).toBe("career:event-standing:final:player");
    expect(careerEffectKey.seasonSettlement("cohort", 4, "v1")).toBe("career:season-settlement:cohort:4:v1");
    expect(careerEffectKey.seasonHistory("profile", "cohort", 4)).toBe("career:season-history:profile:cohort:4");
    expect(careerEffectKey.movement("profile", "cohort", 4)).toBe("career:movement:profile:cohort:4");
    expect(careerEffectKey.rating("profile", "cohort", 4)).toBe("career:rating:profile:cohort:4");
    expect(careerEffectKey.legacy("profile", "event", "source", "win")).toBe(
      "career:legacy:profile:event:source:win",
    );
    expect(careerEffectKey.trophy("profile", "event", "source", "winner")).toBe(
      "career:trophy:profile:event:source:winner",
    );
    expect(careerEffectKey.qualificationInput("champ", "cohort", 4)).toBe(
      "career:qualification-input:champ:cohort:4",
    );
    expect(careerEffectKey.qualification("champ", "player")).toBe(
      "career:qualification:champ:player",
    );
    expect(careerEffectKey.championshipSlot("champ", 20)).toBe(
      "career:championship-slot:champ:20",
    );
    expect(careerEffectKey.championshipResult("champ", "player")).toBe(
      "career:championship-result:champ:player",
    );
    expect(careerEffectKey.championshipSettlement("champ", "v1")).toBe(
      "career:championship-settlement:champ:v1",
    );
    expect(careerEffectKey.enrollment("profile", "world", 5)).toBe(
      "career:enrollment:profile:world:5",
    );
    expect(careerEffectKey.outbox("revision", "notification", "player")).toBe(
      "career:outbox:revision:notification:player",
    );
  });

  it("escapes separators to prevent composite-key collisions and rejects invalid values", () => {
    expect(careerEffectKey.qualification("champ:a", "player")).toBe(
      "career:qualification:champ%3Aa:player",
    );
    expect(careerEffectKey.qualification("champ", "a:player")).toBe(
      "career:qualification:champ:a%3Aplayer",
    );
    expect(careerEffectKey.qualification("champ:a", "player")).not.toBe(
      careerEffectKey.qualification("champ", "a:player"),
    );
    expect(() => careerEffectKey.fieldLock("", 1)).toThrow(/must not be empty/);
    expect(() => careerEffectKey.fieldLock("event", 0)).toThrow(/positive/);
  });
});

describe("Career formula bundle", () => {
  it("pins every frozen Career v1 formula and component version", () => {
    const bundle = CAREER_V1_FORMULA_BUNDLE;
    expect(bundle.id).toBe("career-v1-freeze-candidate");
    expect(bundle.ability.errorRates).toEqual({ rusty: 0.65, scratch: 0.14, ace: 0.02 });
    expect(bundle.bots.tierMix).toEqual({
      local: { rusty: 0.6, scratch: 0.35, ace: 0.05 },
      challenger: { rusty: 0.1, scratch: 0.45, ace: 0.45 },
      pro: { rusty: 0.02, scratch: 0.28, ace: 0.7 },
    });
    expect(bundle.movement).toMatchObject({
      rollingPromoteThreshold: 0.65,
      rollingPromotionFloor: 0.58,
      rollingRelegateThreshold: 0.32,
      rollingPromotionCarryWeight: 0.25,
      humanMovementLimitMin: 4,
      humanMovementLimitScale: 0.2,
      humanMovementLimitMax: 40,
    });
    expect(bundle.tourRating).toEqual({
      chronologicalWindow: 8,
      countingRatings: 6,
      inactiveRating: 0,
      tierMultipliers: { local: 1, challenger: 1.5, pro: 2.25 },
    });
    expect(bundle.legacyPoints).toEqual({
      eventCompletion: 1,
      eventTopFive: 5,
      eventWin: 15,
      activeSeasonCompletion: 3,
      promotion: 20,
      proSurvival: 12,
      seasonChampionship: 30,
      championshipQualification: 35,
      championshipWin: 100,
    });
    expect(bundle.championship).toMatchObject({
      fieldSize: 20,
      proTop: 6,
      proEventWinnerSlots: 4,
      challengerTop: 2,
      duplicatePolicy: "pro-standings-passdown",
    });
    expect(Object.keys(CAREER_COMPONENT_VERSIONS)).toHaveLength(14);
  });

  it("player-paced v2 retires the movement cap and personalises qualification, and changes nothing else", () => {
    const v1 = CAREER_V1_FORMULA_BUNDLE;
    const v2 = CAREER_V2_FORMULA_BUNDLE;

    // The cap is gone; every calibrated rolling threshold is untouched.
    expect(v2.movement.humanMovementLimitModel).toBe("none");
    expect(v2.movement.humanMovementLimitMin).toBeUndefined();
    expect(v2.movement.humanMovementLimitScale).toBeUndefined();
    expect(v2.movement.humanMovementLimitMax).toBeUndefined();
    expect(v2.movement.rollingWindow).toBe(v1.movement.rollingWindow);
    expect(v2.movement.rollingMinEntries).toBe(v1.movement.rollingMinEntries);
    expect(v2.movement.rollingPromoteThreshold).toBe(v1.movement.rollingPromoteThreshold);
    expect(v2.movement.rollingPromotionFloor).toBe(v1.movement.rollingPromotionFloor);
    expect(v2.movement.rollingRelegateThreshold).toBe(v1.movement.rollingRelegateThreshold);
    expect(v2.movement.rollingPromotionCarryWeight).toBe(v1.movement.rollingPromotionCarryWeight);

    // Championship qualification becomes a personal, Challenger-gated cycle.
    expect(v2.championship).toEqual({
      fieldSize: 20,
      qualification: "personal-cycle",
      seasonsPerCycle: 4,
      minimumTier: "challenger",
      humanSlots: 1,
      remainingSlots: "elite-bots",
      affectsMovement: false,
      affectsTourRating: false,
    });

    // Everything else — the calibrated scoring surface — is identical to v1.
    expect(v2.ability).toEqual(v1.ability);
    expect(v2.bots).toEqual(v1.bots);
    expect(v2.eventPoints).toEqual(v1.eventPoints);
    expect(v2.tourRating).toEqual(v1.tourRating);
    expect(v2.legacyPoints).toEqual(v1.legacyPoints);
  });

  it("is immutable and never substitutes an unknown formula version", () => {
    // v1 stays registered and byte-identical so historical snapshots resolve.
    expect(CAREER_V1_FORMULA_VERSION).toBe("career-v1-freeze-candidate");
    expect(getCareerFormulaBundle(CAREER_V1_FORMULA_VERSION)).toBe(CAREER_V1_FORMULA_BUNDLE);
    // New settlements pin the player-paced package.
    expect(CAREER_FORMULA_VERSION).toBe("career-v3-four-round-events");
    expect(getCareerFormulaBundle(CAREER_FORMULA_VERSION)).toBe(CAREER_V3_FORMULA_BUNDLE);
    expect(listCareerFormulaVersions()).toEqual([
      "career-v1-freeze-candidate",
      "career-v2-player-paced",
      "career-v3-four-round-events",
    ]);
    expect(Object.isFrozen(CAREER_V1_FORMULA_BUNDLE)).toBe(true);
    expect(Object.isFrozen(CAREER_V1_FORMULA_BUNDLE.movement)).toBe(true);
    expect(Object.isFrozen(CAREER_V1_FORMULA_BUNDLE.bots.tierMix.pro)).toBe(true);
    expect(Object.isFrozen(CAREER_V2_FORMULA_BUNDLE)).toBe(true);
    expect(Object.isFrozen(CAREER_V3_FORMULA_BUNDLE)).toBe(true);
    expect(getCareerFormulaBundle("future-version")).toBeUndefined();
    expect(() => requireCareerFormulaBundle("future-version")).toThrow(/manual review/);
    expect(pinCareerFormulaBundle(CAREER_FORMULA_VERSION, "build-abc")).toEqual({
      formulaPackageVersion: CAREER_FORMULA_VERSION,
      runtimeRevision: "build-abc",
      bundle: CAREER_V3_FORMULA_BUNDLE,
    });
    expect(Object.isFrozen(pinCareerFormulaBundle(CAREER_FORMULA_VERSION, "build-abc"))).toBe(true);
    expect(() => pinCareerFormulaBundle(CAREER_FORMULA_VERSION, " ")).toThrow(/must not be empty/);
  });
});

describe("Career bot roster", () => {
  it("generates 30 stable, unique world identities with exactly 8 recurring rivals", () => {
    const first = generateCareerBotRoster("2026-07-23");
    const replay = generateCareerBotRoster("2026-07-23");
    const anotherWorld = generateCareerBotRoster("2026-07-24");
    expect(first).toEqual(replay);
    expect(first).not.toEqual(anotherWorld);
    expect(first).toHaveLength(CAREER_BOT_ROSTER_SIZE);
    expect(first.filter((identity) => identity.recurring)).toHaveLength(CAREER_RECURRING_BOT_COUNT);
    expect(new Set(first.map((identity) => identity.botKey)).size).toBe(30);
    expect(new Set(first.map((identity) => identity.displayName)).size).toBe(30);
    expect(first.every((identity) =>
      ["conservative", "balanced", "aggressive", "situational"].includes(identity.tendency)
    )).toBe(true);
    expect(canonicalHash(first)).toBe(
      "93e2f8648242b8d09ae7779d58243414b0d30c6b3d14861b7263447b8be83ee9",
    );
    expect(() => validateCareerBotRoster(first)).not.toThrow();
    expect(botInitials("Alex Mercer")).toBe("AM");
  });

  it("assigns unique deterministic identities and independent frozen tier abilities", () => {
    const options = {
      worldKey: "2026-07-23",
      seasonNumber: 3,
      tier: "challenger" as const,
      eventNumber: 2,
      slots: Array.from({ length: 20 }, (_, index) => ({
        slotId: index + 1,
        slotIndex: index,
      })),
    };
    const first = assignCareerBotSlots(options);
    const replay = assignCareerBotSlots(options);
    expect(first).toEqual(replay);
    expect(new Set(first.map((slot) => slot.identity.botKey)).size).toBe(20);
    expect(first.map((slot) => slot.slotId)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 1),
    );
    for (const [index, assignment] of first.entries()) {
      expect(assignment.abilityBand).toBe(
        botAbilityForSlot(
          "challenger",
          index,
          "2026-07-23:s3:challenger",
          "tier-scaled",
        ),
      );
      expect(assignment.tendency).toBe(assignment.identity.tendency);
    }
    expect(first.filter((slot) => slot.identity.recurring)).toHaveLength(8);
    expect(canonicalHash(first)).toBe(
      "4a5c34b49b5dcb357525fdcf6d887ccb9abe4e34c635130d5b5cc3c59e46604e",
    );
  });

  it("rejects invalid worlds and impossible or ambiguous assignments", () => {
    // A Journey key is any stable non-empty string; only emptiness is invalid.
    expect(() => generateCareerBotRoster("   ")).toThrow(/non-empty stable key/);
    expect(generateCareerBotRoster("journey:user-abc")).toHaveLength(CAREER_BOT_ROSTER_SIZE);
    expect(() => assignCareerBotSlots({
      worldKey: "2026-07-23",
      seasonNumber: 1,
      tier: "local",
      eventNumber: 1,
      slots: [{ slotId: 1 }, { slotId: 1 }],
    })).toThrow(/duplicate slot IDs/);
    expect(() => assignCareerBotSlots({
      worldKey: "2026-07-23",
      seasonNumber: 1,
      tier: "local",
      eventNumber: 1,
      slots: [{ slotId: 1, slotIndex: 2 }, { slotId: 2, slotIndex: 2 }],
    })).toThrow(/duplicate slot indexes/);
    expect(() => assignCareerBotSlots({
      worldKey: "2026-07-23",
      seasonNumber: 1,
      tier: "local",
      eventNumber: 1,
      slots: Array.from({ length: 31 }, (_, index) => ({ slotId: index + 1 })),
    })).toThrow(/30 identities for 31 slots/);
  });
});

describe("Career journey identity (player-paced)", () => {
  it("keys a Journey to its player, so uniqueness enforces one Journey each", () => {
    expect(careerJourneyKey("user-abc")).toBe("journey:user-abc");
    expect(careerJourneyKey("  user-abc  ")).toBe("journey:user-abc");
    expect(careerJourneyKey("a")).not.toBe(careerJourneyKey("b"));
    expect(() => careerJourneyKey("   ")).toThrow(/requires a user ID/);
  });

  it("fixes the field at one human plus nineteen bots over four events", () => {
    expect(CAREER_BASE_FIELD_SIZE).toBe(20);
    expect(CAREER_EVENTS_PER_SEASON).toBe(4);
  });

  it("expresses 'never expires' as a far-future sentinel, not a real deadline", () => {
    // The column is non-null, so a sentinel stands in for "no deadline"; any
    // residual `deadlineAt <= now` comparison must therefore never fire.
    expect(CAREER_NO_DEADLINE.getTime()).toBeGreaterThan(new Date("3000-01-01").getTime());
  });
});

describe("Career event settlement", () => {
  it("uses frozen tie averaging and assigns zero points to no-shows", () => {
    const standings = calculateCareerEventStandings([
      {
        slotId: 1,
        competitorType: "HUMAN",
        profileId: "p1",
        botIdentityId: null,
        relativeToPar: -2,
        completed: true,
      },
      {
        slotId: 2,
        competitorType: "BOT",
        profileId: null,
        botIdentityId: "b1",
        relativeToPar: 0,
        completed: true,
      },
      {
        slotId: 3,
        competitorType: "HUMAN",
        profileId: "p2",
        botIdentityId: null,
        relativeToPar: 0,
        completed: true,
      },
      {
        slotId: 4,
        competitorType: "HUMAN",
        profileId: "p3",
        botIdentityId: null,
        relativeToPar: null,
        completed: false,
      },
    ]);
    expect(standings[0]).toMatchObject({ rank: 1, points: 100, noShow: false });
    expect(standings[1]).toMatchObject({
      rank: 2,
      points: (200 / 3 + 100 / 3) / 2,
      noShow: false,
    });
    expect(standings[2].points).toBe(standings[1].points);
    expect(standings[3]).toMatchObject({
      completed: false,
      noShow: true,
      rank: null,
      points: 0,
    });
  });

  it("rejects duplicate slots and missing competitor identities", () => {
    expect(() => calculateCareerEventStandings([
      {
        slotId: 1,
        competitorType: "HUMAN",
        profileId: "p1",
        botIdentityId: null,
        relativeToPar: 0,
        completed: true,
      },
      {
        slotId: 1,
        competitorType: "BOT",
        profileId: null,
        botIdentityId: "b1",
        relativeToPar: 0,
        completed: true,
      },
    ])).toThrow(/duplicate slot/i);
    expect(() => calculateCareerEventStandings([{
      slotId: 1,
      competitorType: "HUMAN",
      profileId: null,
      botIdentityId: null,
      relativeToPar: 0,
      completed: true,
    }])).toThrow(/no identity/i);
  });
});
