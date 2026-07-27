# Career Mode formula freeze — Gate 3

**Status: PASS.** Candidate H and the balanced award schedule remain frozen.
The player-paced v2 milestone display scale is now also frozen after the
Iteration 8 long-horizon validation below.

Versioned package: `career-v1-freeze-candidate`.

## Scope and reproducibility

```sh
npm run career:freeze -- --seed career-v1-review --bank-samples 256
```

The final matrix covers fields 20/30/50/100/500, human ratios 25%/50%/80%, horizons 4/8/16/32, and 3 deterministic seeds. Independent 16-season validation uses 20 seeds. Coverage includes 13,032 human careers across all 3 abilities, 4 tendencies, and 3 activity patterns.

## Frozen event points

`rawEventPoints = 100 × (lockedFieldSize - occupiedPosition) / (lockedFieldSize - 1)`.

- Keep full precision and round only for display.
- Tied competitors receive the average of the points for every occupied tied position.
- A no-show receives zero; the locked field remains the denominator.
- Season points are the best three of four event-point results.
- The v5 season tiebreak chain remains unchanged.

| Field | Point step | Untied mean | Pair-tie total | Untied total |
|---:|---:|---:|---:|---:|
| 20 | 5.2632 | 50.0 | 1000.0000 | 1000.0000 |
| 30 | 3.4483 | 50.0 | 1500.0000 | 1500.0000 |
| 50 | 2.0408 | 50.0 | 2500.0000 | 2500.0000 |
| 100 | 1.0101 | 50.0 | 5000.0000 | 5000.0000 |
| 500 | 0.2004 | 50.0 | 25000.0000 | 25000.0000 |

The mean remains 50 at every field size and averaging occupied positions preserves the exact point pool under ties. Larger fields create finer percentile resolution rather than a field-size point advantage. Freeze unchanged.

## Frozen ability and movement package

- Ability model: shared near-optimal engine policy plus deterministic decision-error probability.
- Error rates: Rusty **0.65**, Scratch **0.14**, Ace **0.02**.
- Retain the latest two **active-season** percentiles. Inactive seasons neither add zero nor break the window.
- Promote when the two-season average is **at least 0.65** and both values are **at least 0.58**.
- Relegate when the two-season average is **at most 0.32**.
- Local cannot relegate; Pro cannot normally promote.
- After promotion retain one evidence value: `0.5 + 0.25 × (priorAverage - 0.5)`.
- A relegation or inactivity-driven tier change clears rolling evidence.
- Per-direction human capacity: `clamp(ceil(activeHumanCount × 0.20), 4, 40)`.
- Bots never consume human capacity. Exact performance ties soft-expand the boundary.

| Ability | Error rate | Mean real-engine score to par |
|---|---:|---:|
| rusty | 0.65 | 2.33 |
| scratch | 0.14 | 1.09 |
| ace | 0.02 | 0.80 |

| Validation | Ace→Pro | Scratch→Pro | Rusty→Pro | Ace median active seasons | Immediate reversal | Oscillation | Pro survival | Max human promoted/relegated |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Final matrix | 62.5% | 50.1% | 7.6% | 7.0 | 9.6% | 30.0% | 89.7% | 40/26 |
| Independent 20-seed | 62.4% | 48.7% | 7.0% | 8.0 | 9.2% | 29.3% | 91.3% | 40/28 |

Ordering is fixed: calculate the active-season percentile, update the two-entry window, evaluate floor/average and tier boundary, apply the per-direction human cap with exact ties, transform promotion evidence or clear relegation evidence, then record the resulting tier.

## Frozen tier strength

| Mix | Local R/S/A | Challenger R/S/A | Pro R/S/A | Ace→Pro | Rusty→Pro | Ace median | Pro survival A/S/R | Rating overlap | Human Championship share |
|---|---|---|---|---:|---:|---:|---:|---:|---:|
| uniform | uniform | uniform | uniform | 65.0% | 8.4% | 8.0 | 96.3%/93.3%/77.2% | 32.7% | 5.4% |
| gentler | 55/40/5 | 15/50/35 | 5/35/60 | 64.2% | 7.9% | 7.0 | 93.5%/89.5%/71.3% | 35.5% | 4.6% |
| proposed | 60/35/5 | 10/45/45 | 2/28/70 | 62.5% | 7.6% | 7.0 | 92.3%/89.1%/69.9% | 34.3% | 4.2% |
| steeper | 70/27/3 | 8/42/50 | 1/19/80 | 62.7% | 7.9% | 7.0 | 91.6%/88.9%/69.8% | 35.7% | 4.3% |

| Mix | Pro top six | Pro event winner | Pro pass-down | Challenger top two | Elite bot |
|---|---:|---:|---:|---:|---:|
| uniform | 26.3% | 10.3% | 7.3% | 9.8% | 46.3% |
| gentler | 26.3% | 10.9% | 6.7% | 9.8% | 46.3% |
| proposed | 26.3% | 10.8% | 6.8% | 9.7% | 46.4% |
| steeper | 26.5% | 11.1% | 6.6% | 9.9% | 45.9% |

Freeze the proposed static field assignment: Local **60/35/5**, Challenger **10/45/45**, Pro **2/28/70** Rusty/Scratch/Ace. Uniform, gentler, and steeper alternatives are retained as labelled sensitivities; none supplies a complete progression, survival, rating-overlap, and qualification-source improvement large enough to displace the proposed tier identity. Bots remain static tier texture, not autonomous careers.

## Frozen Tour Rating

`seasonPercentile = (activeFieldSize - activeRank) / (activeFieldSize - 1)`

`seasonRating = 100 × seasonPercentile × tierMultiplier`

`tourRating = sum(best 6 ratings from the last 8 chronological regular seasons)`

An inactive season contributes zero and occupies a chronological slot. Championships do not contribute. Freeze multipliers at Local **1.0**, Challenger **1.5**, Pro **2.25**.

| Multipliers L/C/P | Rusty median | Scratch median | Ace median | Strong Challenger | Weak Pro | Challenger overlap | Returning recovery | Catch-up R/S/A |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| 1/1.4/2 (compressed) | 299.2 | 459.2 | 509.2 | 485.3 | 530.6 | 35.1% | 1.0 active | 7.0/7.0/8.0 |
| 1/1.45/2.1 (middle) | 299.6 | 467.7 | 525.3 | 496.6 | 545.2 | 34.5% | 1.0 active | 7.0/8.0/8.0 |
| 1/1.5/2.25 (proposed) | 300.2 | 477.1 | 540.9 | 510.3 | 565.6 | 34.3% | 1.0 active | 7.0/8.0/8.0 |

All multiplier candidates produced identical movement histories: **yes**. The proposed multipliers preserve meaningful tier reward while still allowing strong Challenger ratings to overlap weak Pro ratings; the compressed alternatives reduce tier identity without improving movement or recovery.

## Frozen Legacy Points

All awards stack. Legacy Points are clamped to non-negative award counts and values, never decrease, never affect gameplay probabilities, and have no global leaderboard.

| Award | Participation-heavy | Balanced (frozen) | Prestige-heavy |
|---|---:|---:|---:|
| eventCompletion | 3 | 1 | 1 |
| eventTopFive | 2 | 5 | 8 |
| eventWin | 6 | 15 | 25 |
| activeSeasonCompletion | 8 | 3 | 2 |
| promotion | 10 | 20 | 30 |
| proSurvival | 6 | 12 | 18 |
| seasonChampionship | 12 | 30 | 50 |
| championshipQualification | 18 | 35 | 60 |
| championshipWin | 45 | 100 | 175 |

| Candidate / horizon | P25 | Median | P75 | P90 | Completion share |
|---|---:|---:|---:|---:|---:|
| participation-heavy / 4 | 80 | 80 | 90 | 100 | 91.0% |
| participation-heavy / 8 | 130 | 154 | 172 | 192 | 90.1% |
| participation-heavy / 16 | 290 | 324 | 354 | 390 | 88.8% |
| participation-heavy / 32 | 610 | 672 | 732 | 784 | 88.1% |
| balanced / 4 | 28 | 33 | 48 | 73 | 61.6% |
| balanced / 8 | 56 | 72 | 96 | 133 | 59.4% |
| balanced / 16 | 126 | 162 | 216 | 277 | 56.1% |
| balanced / 32 | 270 | 344 | 450 | 554 | 54.8% |
| prestige-heavy / 4 | 24 | 32 | 57 | 95 | 46.7% |
| prestige-heavy / 8 | 48 | 78 | 115 | 170 | 44.5% |
| prestige-heavy / 16 | 126 | 178 | 258 | 357 | 41.3% |
| prestige-heavy / 32 | 280 | 391 | 546 | 704 | 40.1% |

Freeze the balanced schedule: 1 event completion, 5 top five, 15 event win, 3 active-season completion, 20 promotion, 12 Pro survival, 30 season championship, 35 Championship qualification, and 100 Championship win. It keeps ordinary participation meaningful without letting completion alone swamp competitive awards; the participation-heavy option overweights attendance, while the prestige-heavy option creates excessively bursty elite pacing.

Balanced 32-season pacing by ability and activity:

| Ability | Activity | Careers | P25 | Median | P75 |
|---|---|---:|---:|---:|---:|
| rusty | full | 444 | 264 | 304 | 359 |
| rusty | occasional | 357 | 200 | 223 | 254 |
| rusty | returning | 306 | 245 | 266 | 295 |
| scratch | full | 435 | 378 | 445 | 533 |
| scratch | occasional | 351 | 254 | 286 | 335 |
| scratch | returning | 297 | 332 | 380 | 436 |
| ace | full | 426 | 435 | 501 | 620 |
| ace | occasional | 345 | 287 | 335 | 403 |
| ace | returning | 297 | 386 | 443 | 491 |

The balanced 32-season population has P25/median/P75/P90 of **270/344/450/554**. The 500-player slice is **258/319/407/479**, showing stable large-field pacing.

Balanced 32-season contribution by award source:

| Award source | Share of Legacy Points |
|---|---:|
| eventCompletion | 31.3% |
| eventTopFive | 7.5% |
| eventWin | 5.8% |
| activeSeasonCompletion | 23.4% |
| promotion | 15.6% |
| proSurvival | 13.4% |
| seasonChampionship | 1.7% |
| championshipQualification | 1.0% |
| championshipWin | 0.2% |

### Player-paced v2 milestone freeze

The original 50 / 100 / 250 / 500 / 1,000 display ladder was calibrated for the
synchronized, bounded horizon. It is superseded for player-paced Career by:

- **250 — Club Regular**
- **1,000 — Tour Veteran**
- **2,500 — Established Pro**
- **5,000 — Tour Legend**
- **10,000 — Hall of Fame**
- **25,000 — Immortal**

The award schedule above is unchanged. Only these display/prestige thresholds
change; they affect no probability, movement, rating, settlement, or leaderboard.

`npm run career:simulate:player-paced -- --seed career-player-paced-v1
--bank-samples 256 --careers-per-ability 200 --seasons 500` simulated 600
deterministic personal careers and 300,000 settled seasons through the real-engine
score bank and `career-v2-player-paced`. Median seasons to each threshold:

| Ability | 250 | 1,000 | 2,500 | 5,000 | 10,000 | 25,000 |
|---|---:|---:|---:|---:|---:|---:|
| Rusty | 15 | 53 | 133 | 264 | ~520 | ~1,300 |
| Scratch | 9 | 33 | 81 | 164 | 323 | ~805 |
| Ace | 8 | 29 | 72 | 144 | 289 | ~715 |

Values marked `~` extend beyond the 500-season exact horizon and are scale
estimates, not observed threshold crossings. Exact percentile curves and
progression metrics are recorded in
[`career-player-paced-simulator-report.md`](./career-player-paced-simulator-report.md).
The spacing is meaningful across skill levels and keeps the final milestone rare
but reachable in an unlimited mode, so the ladder freezes unchanged from the
player-paced design proposal.

## Frozen edge cases

- A one-player event awards 100 points; a one-player active season percentile is 1.
- No-shows receive zero event points and no event-completion Legacy award. Missing an event never deducts points.
- Rank ties share occupied-position event points. Every competitor tied at rank one receives the event-win Legacy award; fixed-field Championship qualification still uses the deterministic standings fallback.
- Movement uses a `1e-12` numerical tolerance so mathematically exact threshold equality is not lost to floating-point representation.
- Exact movement-boundary performance ties soft-expand beyond the human limit; bots never consume that limit.
- Inactive seasons are skipped by movement evidence but occupy Tour Rating chronology at zero. A second consecutive inactive Pro season relegates to Challenger and clears movement evidence; inactivity never pushes a player below Challenger.
- Championship qualification awards qualification Legacy Points once. Only the settled winner receives the Championship-win award. Championship results never alter movement or Tour Rating.
- All Legacy awards stack, and negative counts or values are treated as zero.

## Rejected alternatives

- v5 one-season 20% slot movement: excessive weak promotion and reversal.
- symmetric confirmation: stable only because progression nearly stops.
- relegation protection: retains weak upward variance rather than improving selection.
- fixed human caps: starve large-field progression; H's bounded percentage is scale-sensitive.
- rolling three-season evidence: moves strong-player timing beyond the target.
- gentler/steeper tier mixes: do not improve the complete movement/fairness balance enough to replace the proposed mix.
- compressed Tour Rating multipliers: narrow tier identity with no movement or recovery benefit.
- participation-heavy Legacy: attendance contributes too much of total value.
- prestige-heavy Legacy: elite outcomes create too much variance in permanent progression.

## Remaining risks and next gate

- Score banks deterministically sample real-engine rounds for matrix speed; settlement-scale implementation tests should also execute direct complete rounds.
- The 500-player movement cap is soft: an exact tie may move 41+ humans rather than arbitrarily split identical performances.
- Championship winners are simulated against Ace-level elite bot opposition for Legacy pacing; production settlement must use actual Championship results.
- Static bot tier assignment is intentionally the v1 boundary; this does not authorize autonomous bot careers.
- **Championship and regular-season concurrency still requires human playtesting.** Simulation cannot determine whether the extra event feels delightful or burdensome.

## Player-paced Iteration 8 findings

- Candidate H remains frozen unchanged. In 500-season personal careers, Pro
  reach by season 10 was Rusty 7.0%, Scratch 36.0%, Ace 61.5%; median seasons to
  Pro among eventual arrivals were 84 / 14 / 9.
- First Championship mean/median seasons were Rusty 21.9/16, Scratch 7.6/4,
  Ace 6.2/4. Every tested career eventually qualified within the 500-season
  horizon.
- Pro survival was Rusty 67.5%, Scratch 82.5%, Ace 85.9%. Relegations per total
  season were 0.065 / 0.108 / 0.104; stronger players face more relegation
  opportunities because they spend more time above Local.
- Tour Rating is numerically volume-neutral: identical final-eight form produced
  750.00 after both a short history and a 200-season history.
- The perfect-play Local→Challenger after season 2 and Challenger→Pro after
  season 3 remains a mastery edge case. Realistic Ace median 9 and Scratch median
  14 provide meaningful progression without a new formula package. No formula
  change was proposed or applied.

Gate 3 is mechanically complete and ready for product approval. Approval should advance only to Gate 4 settlement failure/recovery requirements—not schema or production implementation.
