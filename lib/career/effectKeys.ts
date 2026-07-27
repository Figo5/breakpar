type KeyPart = string | number;

function part(value: KeyPart, label: string): string {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new TypeError(`${label} must be a positive safe integer`);
    }
    return String(value);
  }
  if (value.length === 0) throw new TypeError(`${label} must not be empty`);
  return encodeURIComponent(value);
}

function key(namespace: string, values: ReadonlyArray<readonly [KeyPart, string]>): string {
  return `career:${namespace}:${values.map(([value, label]) => part(value, label)).join(":")}`;
}

export const careerEffectKey = {
  fieldLock: (competitionId: string, lockRevision: number) =>
    key("field-lock", [[competitionId, "competitionId"], [lockRevision, "lockRevision"]]),

  botResult: (competitionId: string, lockRevision: number, slotId: number, formulaVersion: string) =>
    key("bot-result", [
      [competitionId, "competitionId"],
      [lockRevision, "lockRevision"],
      [slotId, "slotId"],
      [formulaVersion, "formulaVersion"],
    ]),

  eventFinal: (eventId: string, lockRevision: number, formulaVersion: string) =>
    key("event-final", [
      [eventId, "eventId"],
      [lockRevision, "lockRevision"],
      [formulaVersion, "formulaVersion"],
    ]),

  eventStanding: (eventFinalId: string, competitorId: string) =>
    key("event-standing", [[eventFinalId, "eventFinalId"], [competitorId, "competitorId"]]),

  seasonSettlement: (cohortId: string, season: number, formulaVersion: string) =>
    key("season-settlement", [
      [cohortId, "cohortId"],
      [season, "season"],
      [formulaVersion, "formulaVersion"],
    ]),

  seasonHistory: (profileId: string, cohortId: string, season: number) =>
    key("season-history", [
      [profileId, "profileId"],
      [cohortId, "cohortId"],
      [season, "season"],
    ]),

  movement: (profileId: string, cohortId: string, season: number) =>
    key("movement", [[profileId, "profileId"], [cohortId, "cohortId"], [season, "season"]]),

  rating: (profileId: string, cohortId: string, season: number) =>
    key("rating", [[profileId, "profileId"], [cohortId, "cohortId"], [season, "season"]]),

  legacy: (
    profileId: string,
    sourceType: string,
    sourceId: string,
    awardType: string,
  ) => key("legacy", [
    [profileId, "profileId"],
    [sourceType, "sourceType"],
    [sourceId, "sourceId"],
    [awardType, "awardType"],
  ]),

  trophy: (
    profileId: string,
    sourceType: string,
    sourceId: string,
    trophyType: string,
  ) => key("trophy", [
    [profileId, "profileId"],
    [sourceType, "sourceType"],
    [sourceId, "sourceId"],
    [trophyType, "trophyType"],
  ]),

  qualificationInput: (championshipId: string, cohortId: string, season: number) =>
    key("qualification-input", [
      [championshipId, "championshipId"],
      [cohortId, "cohortId"],
      [season, "season"],
    ]),

  qualification: (championshipId: string, competitorId: string) =>
    key("qualification", [
      [championshipId, "championshipId"],
      [competitorId, "competitorId"],
    ]),

  championshipSlot: (championshipId: string, slotNumber: number) =>
    key("championship-slot", [
      [championshipId, "championshipId"],
      [slotNumber, "slotNumber"],
    ]),

  championshipResult: (championshipId: string, competitorId: string) =>
    key("championship-result", [
      [championshipId, "championshipId"],
      [competitorId, "competitorId"],
    ]),

  championshipSettlement: (championshipId: string, formulaVersion: string) =>
    key("championship-settlement", [
      [championshipId, "championshipId"],
      [formulaVersion, "formulaVersion"],
    ]),

  championshipFinal: (championshipId: string, formulaVersion: string) =>
    key("championship-final", [
      [championshipId, "championshipId"],
      [formulaVersion, "formulaVersion"],
    ]),

  enrollment: (profileId: string, worldId: string, nextSeason: number) =>
    key("enrollment", [
      [profileId, "profileId"],
      [worldId, "worldId"],
      [nextSeason, "nextSeason"],
    ]),

  outbox: (committedRevisionId: string, effectType: string, recipientOrScope: string) =>
    key("outbox", [
      [committedRevisionId, "committedRevisionId"],
      [effectType, "effectType"],
      [recipientOrScope, "recipientOrScope"],
    ]),
} as const;

export type CareerEffectKeyBuilder = keyof typeof careerEffectKey;
