# Career Mode simulator report

Status: historical synchronized-career simulator evidence. Production Career
Mode was subsequently implemented as a personal player-paced Journey. Use
[`career-player-paced-simulator-report.md`](./career-player-paced-simulator-report.md)
for the current long-horizon release calibration.

Gate 3 follow-up: the product owner subsequently approved Candidate H's wide 0.65/0.14/0.02 ability calibration. The complete five-part freeze proposal and later sensitivity evidence are in [`career-formula-freeze.md`](./career-formula-freeze.md). Historical conditional language below is preserved as evidence of the decision that was pending when this report was generated.

## Reproduction

```sh
npm run career:simulate -- --seed career-v1-review --bank-samples 256
```

The report uses explicit seed `career-v1-review`, 256 real-engine rounds per ability/tendency archetype, field sizes 20/30/50/100/500, human ratios 25%/50%/80%, horizons 4/8/16, and 3 deterministic world seeds.

## Engine-backed policy score bank

| Ability | Conservative | Balanced | Aggressive | Situational |
|---|---:|---:|---:|---:|
| rusty | 2.57 | 1.49 | 2.14 | 1.57 |
| scratch | 2.06 | 0.91 | 1.51 | 1.03 |
| ace | 1.60 | 1.08 | 2.14 | 1.24 |

Naive-to-strong policy gap (Rusty/Balanced minus Ace/Situational): **0.25 strokes/round**. Lower scores are better.

Ability-ordering check: Scratch/Balanced averages **0.91**, while Ace/Balanced averages **1.08**. A non-positive Ace advantage is a failed ordering check, not something tier multipliers can repair.

### Why v5 fails: the engine's decision-EV curve

A direct engine probe (2,000 rounds/decision, random course+seed) forcing every decision to a single level:

| Forced decision | Mean rel-to-par | Std | Break-par |
|---|---:|---:|---:|
| all-safe | +2.92 | 2.85 | 11.5% |
| all-normal | +1.54 | 3.56 | 28.4% |
| all-aggressive | +2.26 | 4.12 | 25.9% |

`normal` is the score-minimising decision; both `safe` (+1.38) and `aggressive` (+0.72) deviations are EV-negative. There is almost no headroom for "better tactical aggression" to separate ability bands, and the v5 Ace policy chases (adds aggression when at/above par) — EV-negative — so it scores WORSE than the calmer Scratch. This is an engine truth, not a coding bug: the same effect appears in `scripts/calibrate.ts`, where the strong `good` and `skilled` policies post near-identical average scores.

### Corrected candidate ability model (error-model)

One shared near-optimal reference policy (no chasing); ability = a per-band seeded probability of deviating to a worse, EV-negative decision, resolved through the same engine. Tendency only skews WHICH wrong decision is chosen, never the rate.

| Ability | Conservative | Balanced | Aggressive | Situational |
|---|---:|---:|---:|---:|
| rusty | 1.75 | 1.75 | 1.84 | 1.75 |
| scratch | 1.08 | 1.15 | 1.19 | 1.15 |
| ace | 0.86 | 0.84 | 0.86 | 0.84 |

Corrected band averages: Rusty **1.77**, Scratch **1.14**, Ace **0.85** — monotonic, with an Ace-over-Rusty gap of **0.92 strokes/round** (v5: 0.43, non-monotonic). Within-band tendency spread stays below 0.1 strokes, so tendency is flavour rather than a second skill axis — matching v5's "identity remains separate from decision policy".

### Corrected-model signal sensitivity

These are labelled calibrations of the same decision-error model, not movement rules keyed to hidden cohorts. Movement sees only completed season results.

| Profile | Rusty errors | Scratch errors | Ace errors | Rusty mean | Scratch mean | Ace mean | Ace–Rusty gap |
|---|---:|---:|---:|---:|---:|---:|---:|
| standard | 0.42 | 0.18 | 0.05 | 1.77 | 1.14 | 0.85 | 0.92 |
| moderate | 0.55 | 0.16 | 0.03 | 2.12 | 1.13 | 0.82 | 1.30 |
| wide | 0.65 | 0.14 | 0.02 | 2.33 | 1.09 | 0.80 | 1.53 |

## Baseline progression

Median active seasons to reach Pro (only careers that reached Pro):

| Ability / tendency | Conservative | Balanced | Aggressive | Situational |
|---|---:|---:|---:|---:|
| rusty | 11.0 | 6.0 | 6.0 | 5.0 |
| scratch | 6.0 | 4.0 | 5.0 | 4.0 |
| ace | 6.0 | 5.0 | 6.0 | 5.0 |

Final human tier distribution by ability:

| Horizon | Ability | Local | Challenger | Pro |
|---:|---|---:|---:|---:|
| 4 | rusty | 68.2% | 23.8% | 7.9% |
| 4 | scratch | 47.9% | 33.1% | 19.0% |
| 4 | ace | 53.2% | 32.5% | 14.3% |
| 8 | rusty | 61.1% | 25.8% | 13.1% |
| 8 | scratch | 40.0% | 30.6% | 29.5% |
| 8 | ace | 43.9% | 33.5% | 22.6% |
| 16 | rusty | 55.0% | 26.2% | 18.8% |
| 16 | scratch | 34.4% | 30.4% | 35.2% |
| 16 | ace | 34.5% | 31.6% | 34.0% |

Pro reach rate within 16 seasons by policy archetype:

| Ability / tendency | Conservative | Balanced | Aggressive | Situational |
|---|---:|---:|---:|---:|
| rusty | 5.4% | 49.6% | 41.9% | 67.0% |
| scratch | 25.3% | 84.6% | 67.0% | 77.6% |
| ace | 44.9% | 78.7% | 44.4% | 78.0% |

- Weak-player variance: **40.0%** of Rusty careers reached Pro within 16 seasons.
- Pro one-season survival: **82.4%**.
- Immediate promote-then-relegate reversal: **19.9%**.
- Longer alternating movement sequence: **20.9%** of careers.
- Returning-player recovery to pre-absence Tour Rating: median **1.0 active seasons** after return (900 measurable careers).
- New-player catch-up to 80% of the established same-ability 16-season median: Rusty **7.0**, Scratch **7.0**, Ace **8.0** seasons.

## Rating overlap

Strong Challenger (Ace) median: **472.0**. Weak Pro (Rusty) median: **687.2**. **18.7%** of strong Challengers meet or exceed the weak-Pro median.

## Movement boundaries and large fields

Across 3,267 tier-seasons, exact boundary ties expanded movement in **2.0%**, adding **1.06** slots on average when expansion occurred.

In the required 500-player scenarios, the largest human tier population was **400**, the largest cohort was **500**, and baseline movement slots ranged from **81 to 100** per direction. This confirms the mechanical result can approach 100 simultaneous movers; product judgment on bounded movement/flights remains necessary.

Sixteen-season population behavior by configured cohort floor:

| Field floor | Simulated humans | Local | Challenger | Pro | Largest cohort | Max base slots/direction |
|---:|---:|---:|---:|---:|---:|---:|
| 20 | 93 | 39.8% | 32.3% | 28.0% | 20 | 4 |
| 30 | 141 | 40.4% | 30.5% | 29.1% | 30 | 6 |
| 50 | 234 | 38.0% | 27.8% | 34.2% | 50 | 10 |
| 100 | 465 | 44.5% | 27.1% | 28.4% | 100 | 20 |
| 500 | 2325 | 41.3% | 29.8% | 28.9% | 500 | 100 |

## Championship qualification

| Source | All qualifiers | Human qualifiers |
|---|---:|---:|
| pro-top-six | 1734 (27.5%) | 205 |
| pro-event-winner | 658 (10.4%) | 39 |
| pro-passdown | 498 (7.9%) | 63 |
| challenger-top-two | 626 (9.9%) | 109 |
| elite-bot | 2784 (44.2%) | 0 |

## Explicit candidates

Every row runs the same field-size, human-ratio, horizon, and seed matrix as the baseline. "Uniform" preserves the original simulator field; "scaled" uses Local 60/35/5, Challenger 10/45/45, and Pro 2/28/70 Rusty/Scratch/Ace bot mixes. All candidates share world seeds and score banks so the labelled dimensions are isolated.

### Operational interpretation of the v5 targets

V5 deliberately uses qualitative targets. To prevent post-hoc declarations, this report treats a freeze candidate as credible only when the complete matrix shows: Ace reach at least 55% with a 4–8 active-season median; Rusty reach at most 10%; Ace > Scratch > Rusty with at least a 10-point Ace/Scratch gap; first-season Pro survival between 70% and 95% (credible but not structurally guaranteed); immediate reversal at most 15%; longer oscillation reported and materially below the v5 baseline; returning-player rating recovery within eight active seasons; and a bounded large-field human movement rule with exact ties still honored. V5 does not assign numeric limits to oscillation or large-field movement, so those remain visible product judgments rather than invented pass/fail gates.

### Progression and rating

| Candidate | Model | Field | Movement | Confirmation | Ace→Pro | Scratch→Pro | Rusty→Pro | Ace median | Reversal | Oscillation | Pro survival | Ace survival | Scratch survival | Rusty survival | Strong Chall. | Weak Pro | Overlap |
|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| v5 20% · uniform | v5 | uniform | slot | none | 62.7% | 66.1% | 42.9% | 7.0 | 21.1% | 47.8% | 81.0% | 78.6% | 83.1% | 81.2% | 500.0 | 724.9 | 13.4% |
| v5 20% · scaled | v5 | tier-scaled | slot | none | 62.4% | 64.7% | 41.2% | 7.0 | 22.8% | 50.9% | 79.5% | 76.9% | 82.0% | 79.2% | 491.4 | 709.1 | 12.9% |
| Corrected 20% · uniform | error | uniform | slot | none | 74.0% | 64.2% | 32.9% | 6.0 | 22.0% | 48.3% | 81.4% | 85.4% | 82.0% | 70.3% | 514.3 | 612.4 | 35.3% |
| Corrected 20% · scaled | error | tier-scaled | slot | none | 71.7% | 63.3% | 33.2% | 7.0 | 25.2% | 55.3% | 77.0% | 80.5% | 78.4% | 65.1% | 519.5 | 600.7 | 32.0% |
| Corrected 12% · uniform | error | uniform | slot | none | 53.9% | 43.7% | 15.9% | 8.0 | 13.1% | 22.3% | 89.5% | 91.8% | 88.9% | 83.3% | 489.8 | 666.5 | 14.9% |
| Corrected 12% · scaled | error | tier-scaled | slot | none | 52.8% | 42.8% | 14.8% | 8.0 | 15.2% | 27.9% | 86.8% | 88.9% | 86.3% | 80.6% | 501.1 | 636.2 | 18.4% |
| Corrected 20% compressed · uniform | error | uniform | slot | none | 74.0% | 64.2% | 32.9% | 6.0 | 22.0% | 48.3% | 81.4% | 85.4% | 82.0% | 70.3% | 487.3 | 564.8 | 33.8% |
| Corrected 20% compressed · scaled | error | tier-scaled | slot | none | 71.7% | 63.3% | 33.2% | 7.0 | 25.2% | 55.3% | 77.0% | 80.5% | 78.4% | 65.1% | 489.3 | 562.4 | 30.5% |
| Corrected 15% · scaled | error | tier-scaled | slot | none | 62.2% | 51.9% | 21.1% | 7.0 | 19.5% | 38.9% | 82.3% | 85.0% | 82.4% | 73.1% | 504.9 | 626.5 | 23.3% |
| Corrected 18% · scaled | error | tier-scaled | slot | none | 67.9% | 58.8% | 27.1% | 7.0 | 23.0% | 48.7% | 79.5% | 82.5% | 80.3% | 68.5% | 507.9 | 606.8 | 28.2% |
| Corrected 20% symmetric · scaled | error | tier-scaled | slot | symmetric | 14.7% | 7.5% | 1.0% | 11.0 | 0.0% | 1.4% | 100.0% | 100.0% | 100.0% | 100.0% | 516.3 | 606.1 | 19.0% |
| Corrected 18% symmetric · scaled | error | tier-scaled | slot | symmetric | 11.3% | 5.6% | 0.9% | 11.0 | 0.0% | 0.8% | 100.0% | 100.0% | 100.0% | 100.0% | 521.3 | 604.1 | 22.2% |
| A rolling-2 top quartile · scaled | error | tier-scaled | rolling-2 | none | 45.5% | 32.4% | 8.3% | 9.0 | 0.0% | 15.9% | 100.0% | 100.0% | 100.0% | 100.0% | 496.4 | 639.2 | 15.9% |
| A rolling-2 70/30 · scaled | error | tier-scaled | rolling-2 | none | 58.1% | 42.3% | 16.0% | 8.0 | 0.0% | 28.3% | 100.0% | 100.0% | 100.0% | 100.0% | 501.0 | 598.7 | 29.3% |
| A rolling-3 top quartile · scaled | error | tier-scaled | rolling-3 | none | 20.9% | 12.6% | 1.6% | 11.0 | 0.0% | 2.1% | 100.0% | 100.0% | 100.0% | 100.0% | 523.0 | 624.1 | 11.3% |
| A2 rolling-2 70/30 + neutral promotion prior · scaled | error | tier-scaled | rolling-2+carry-0 | none | 60.7% | 45.4% | 17.3% | 8.0 | 12.5% | 30.4% | 88.7% | 92.3% | 87.2% | 79.2% | 503.3 | 604.6 | 26.9% |
| A2 rolling-2 70/30 + half promotion carry · scaled | error | tier-scaled | rolling-2+carry-0.5 | none | 66.6% | 52.0% | 24.8% | 7.0 | 0.0% | 26.9% | 100.0% | 100.0% | 100.0% | 100.0% | 517.9 | 598.6 | 33.4% |
| A2 rolling-2 70/30 + full promotion carry · scaled | error | tier-scaled | rolling-2+carry-1 | none | 72.1% | 60.6% | 32.9% | 7.0 | 0.0% | 26.9% | 100.0% | 100.0% | 100.0% | 100.0% | 526.2 | 573.6 | 40.8% |
| B2 rolling-2 68/32 + 55/45 quality guard · scaled | error | tier-scaled | rolling-2+floor-0.55 | none | 55.7% | 40.2% | 14.3% | 8.0 | 0.0% | 25.7% | 100.0% | 100.0% | 100.0% | 100.0% | 498.5 | 621.7 | 21.6% |
| B2 rolling-2 67/33 + 60/40 quality guard · scaled | error | tier-scaled | rolling-2+floor-0.6 | none | 50.9% | 36.6% | 12.8% | 9.0 | 0.0% | 21.7% | 100.0% | 100.0% | 100.0% | 100.0% | 500.7 | 618.4 | 21.5% |
| B2 rolling-2 65/35 + promotion floor 55 · scaled | error | tier-scaled | rolling-2+floor-0.55 | none | 56.1% | 38.0% | 14.5% | 8.0 | 0.0% | 34.0% | 100.0% | 100.0% | 100.0% | 100.0% | 513.2 | 596.4 | 31.9% |
| B 20% relegation protection · scaled | error | tier-scaled | slot | relegation-protection | 84.6% | 75.9% | 47.5% | 6.0 | 0.0% | 18.8% | 100.0% | 100.0% | 100.0% | 100.0% | 436.7 | 611.4 | 15.0% |
| B 15% relegation protection · scaled | error | tier-scaled | slot | relegation-protection | 73.0% | 62.3% | 33.5% | 7.0 | 0.0% | 9.4% | 100.0% | 100.0% | 100.0% | 100.0% | 439.0 | 608.5 | 10.0% |
| C 15% human cap 4 · scaled | error | tier-scaled | slot-cap-4 | none | 25.2% | 21.7% | 7.1% | 9.0 | 17.4% | 11.1% | 81.9% | 84.1% | 84.1% | 66.7% | 494.2 | 618.7 | 19.9% |
| C 15% human cap 8 · scaled | error | tier-scaled | slot-cap-8 | none | 36.9% | 28.9% | 9.2% | 9.0 | 18.5% | 17.5% | 82.7% | 83.3% | 86.3% | 67.6% | 488.5 | 632.9 | 20.8% |
| C 15% human cap 12 · scaled | error | tier-scaled | slot-cap-12 | none | 43.6% | 34.5% | 11.8% | 8.0 | 18.8% | 22.0% | 82.0% | 83.6% | 84.0% | 69.6% | 491.5 | 618.7 | 23.1% |
| C2 rolling-2 70/30 + sqrt human limit · scaled | error | tier-scaled | rolling-2+sqrt | none | 55.9% | 40.1% | 14.7% | 9.0 | 0.0% | 26.4% | 100.0% | 100.0% | 100.0% | 100.0% | 496.4 | 597.0 | 28.5% |
| C2 rolling-2 70/30 + 15%-cap-32 human limit · scaled | error | tier-scaled | rolling-2+percentage-cap | none | 56.5% | 39.5% | 14.9% | 9.0 | 0.0% | 24.2% | 100.0% | 100.0% | 100.0% | 100.0% | 495.0 | 585.5 | 29.4% |
| D2 rolling-2 65/35 + floor 55 + neutral prior · scaled | error | tier-scaled | rolling-2+floor-0.55+carry-0 | none | 52.5% | 34.8% | 13.2% | 9.0 | 23.0% | 38.2% | 78.2% | 81.2% | 77.6% | 67.3% | 517.3 | 641.0 | 24.3% |
| D2 rolling-2 67/33 + floor 55 + neutral prior · scaled | error | tier-scaled | rolling-2+floor-0.55+carry-0 | none | 51.9% | 36.0% | 13.4% | 9.0 | 19.1% | 34.2% | 82.0% | 84.6% | 82.3% | 70.2% | 513.6 | 642.6 | 21.7% |
| D2 rolling-2 67/33 + floor 55 + quarter carry · scaled | error | tier-scaled | rolling-2+floor-0.55+carry-0.25 | none | 62.4% | 47.1% | 21.2% | 7.0 | 10.9% | 31.2% | 90.0% | 93.2% | 89.4% | 81.7% | 516.9 | 621.9 | 28.6% |
| D2 rolling-2 66/34 + floor 58 + quarter carry · scaled | error | tier-scaled | rolling-2+floor-0.58+carry-0.25 | none | 55.9% | 39.2% | 15.4% | 8.0 | 13.2% | 31.4% | 87.8% | 92.2% | 86.2% | 74.9% | 512.1 | 623.4 | 27.5% |
| D2 rolling-2 65/35 + floor 60 + quarter carry · scaled | error | tier-scaled | rolling-2+floor-0.6+carry-0.25 | none | 48.1% | 34.3% | 11.7% | 9.0 | 15.0% | 31.6% | 85.7% | 89.8% | 84.3% | 71.8% | 512.9 | 614.5 | 27.3% |
| D3 rolling-2 67/33 + floor 55 + quarter carry + sqrt limit · scaled | error | tier-scaled | rolling-2+floor-0.55+carry-0.25+sqrt | none | 60.0% | 45.7% | 20.2% | 8.0 | 11.2% | 28.8% | 89.4% | 93.2% | 88.1% | 80.5% | 515.0 | 621.5 | 27.2% |
| D3 rolling-2 67/33 + floor 55 + quarter carry + 15%-cap-32 · scaled | error | tier-scaled | rolling-2+floor-0.55+carry-0.25+percentage-cap | none | 60.2% | 44.8% | 19.7% | 8.0 | 11.2% | 25.5% | 89.8% | 93.5% | 88.6% | 80.4% | 510.0 | 621.0 | 25.1% |
| E moderate signal + D2 66/34 floor 58 quarter carry · scaled | error | tier-scaled | rolling-2+floor-0.58+carry-0.25 | none | 61.1% | 45.0% | 8.6% | 8.0 | 13.3% | 33.2% | 88.7% | 92.1% | 86.9% | 70.8% | 518.2 | 567.8 | 39.5% |
| E wide signal + D2 66/34 floor 58 quarter carry · scaled | error | tier-scaled | rolling-2+floor-0.58+carry-0.25 | none | 61.9% | 48.4% | 5.6% | 8.0 | 13.2% | 33.5% | 88.6% | 91.7% | 86.2% | 71.2% | 519.5 | 531.2 | 47.1% |
| E moderate signal + D3 adaptive · uniform | error | uniform | rolling-2+floor-0.58+carry-0.25+percentage-cap | none | 60.2% | 45.0% | 8.4% | 8.0 | 9.8% | 21.5% | 92.4% | 94.8% | 92.0% | 74.7% | 531.6 | 592.7 | 36.3% |
| E moderate signal + D3 adaptive · scaled | error | tier-scaled | rolling-2+floor-0.58+carry-0.25+percentage-cap | none | 59.8% | 44.0% | 8.1% | 8.0 | 12.8% | 26.8% | 88.1% | 91.7% | 86.0% | 70.8% | 513.2 | 559.2 | 38.8% |
| F moderate signal 64/36 floor 55 quarter carry + 20%-cap-40 · scaled | error | tier-scaled | rolling-2+floor-0.55+carry-0.25+percentage-cap | none | 67.3% | 53.4% | 14.8% | 7.0 | 18.1% | 34.4% | 82.2% | 87.8% | 79.7% | 63.5% | 525.4 | 566.3 | 40.1% |
| F wide signal 65/35 floor 55 quarter carry + 20%-cap-40 · scaled | error | tier-scaled | rolling-2+floor-0.55+carry-0.25+percentage-cap | none | 68.6% | 55.0% | 9.9% | 7.0 | 15.9% | 34.3% | 84.5% | 88.3% | 84.1% | 57.5% | 540.8 | 589.1 | 39.9% |
| F wide signal 64/36 floor 55 quarter carry + 20%-cap-40 · scaled | error | tier-scaled | rolling-2+floor-0.55+carry-0.25+percentage-cap | none | 69.9% | 55.0% | 10.9% | 7.0 | 18.2% | 34.6% | 82.5% | 86.4% | 82.6% | 52.8% | 537.1 | 555.9 | 45.7% |
| F2 moderate signal 64/32 floor 55 quarter carry + 20%-cap-40 · scaled | error | tier-scaled | rolling-2+floor-0.55+carry-0.25+percentage-cap | none | 68.5% | 55.6% | 15.7% | 7.0 | 9.6% | 31.7% | 90.5% | 93.1% | 89.7% | 80.9% | 521.0 | 567.8 | 39.8% |
| F2 wide signal 64/32 floor 55 quarter carry + 20%-cap-40 · scaled | error | tier-scaled | rolling-2+floor-0.55+carry-0.25+percentage-cap | none | 71.1% | 56.6% | 11.1% | 7.0 | 9.5% | 31.5% | 90.4% | 93.6% | 90.8% | 64.5% | 534.6 | 555.0 | 45.6% |
| F3 moderate signal 65/32 floor 55 quarter carry + 20%-cap-40 · scaled | error | tier-scaled | rolling-2+floor-0.55+carry-0.25+percentage-cap | none | 67.6% | 54.6% | 14.9% | 7.0 | 9.4% | 31.2% | 91.1% | 93.6% | 90.2% | 82.2% | 522.6 | 566.5 | 40.3% |
| F3 wide signal 65/32 floor 55 quarter carry + 20%-cap-40 · scaled | error | tier-scaled | rolling-2+floor-0.55+carry-0.25+percentage-cap | none | 70.0% | 56.3% | 10.6% | 7.0 | 9.4% | 31.4% | 90.3% | 93.1% | 90.7% | 67.2% | 526.0 | 567.9 | 41.3% |
| G wide signal 66/32 floor 55 quarter carry + 20%-cap-40 · scaled | error | tier-scaled | rolling-2+floor-0.55+carry-0.25+percentage-cap | none | 68.7% | 54.9% | 9.9% | 7.0 | 9.3% | 30.9% | 90.7% | 93.7% | 90.9% | 66.4% | 532.8 | 595.9 | 35.3% |
| H wide signal 65/32 floor 58 quarter carry + 20%-cap-40 · scaled | error | tier-scaled | rolling-2+floor-0.58+carry-0.25+percentage-cap | none | 63.1% | 50.5% | 6.1% | 8.0 | 8.7% | 29.3% | 92.2% | 94.2% | 91.3% | 76.2% | 518.6 | 581.0 | 35.7% |
| D rolling-2 70/30 + human cap 20 · scaled | error | tier-scaled | rolling-2+cap-20 | none | 49.8% | 35.1% | 12.4% | 9.0 | 0.0% | 21.0% | 100.0% | 100.0% | 100.0% | 100.0% | 488.2 | 597.7 | 25.5% |

### Inactivity, ties, Championships, and scale

| Candidate | Returning recovery | Boundary-tie expansion | Human Championship share | Max raw 500-field slots | Max human promoted | Max human relegated | Warning frequency | Cap-hold frequency |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| v5 20% · uniform | 1.0 | 2.1% | 5.8% | 100 | 75 | 34 | 0.0% | 0.0% |
| v5 20% · scaled | 1.0 | 2.1% | 5.1% | 100 | 79 | 34 | 0.0% | 0.0% |
| Corrected 20% · uniform | 1.0 | 2.0% | 5.4% | 100 | 80 | 35 | 0.0% | 0.0% |
| Corrected 20% · scaled | 1.0 | 2.3% | 4.3% | 100 | 81 | 42 | 0.0% | 0.0% |
| Corrected 12% · uniform | 1.0 | 1.7% | 4.1% | 60 | 50 | 22 | 0.0% | 0.0% |
| Corrected 12% · scaled | 1.0 | 2.0% | 3.2% | 60 | 52 | 26 | 0.0% | 0.0% |
| Corrected 20% compressed · uniform | 1.0 | 2.0% | 5.4% | 100 | 80 | 35 | 0.0% | 0.0% |
| Corrected 20% compressed · scaled | 1.0 | 2.3% | 4.3% | 100 | 81 | 42 | 0.0% | 0.0% |
| Corrected 15% · scaled | 1.0 | 2.0% | 3.6% | 75 | 63 | 33 | 0.0% | 0.0% |
| Corrected 18% · scaled | 1.0 | 2.6% | 3.9% | 90 | 74 | 38 | 0.0% | 0.0% |
| Corrected 20% symmetric · scaled | 1.0 | 2.3% | 1.0% | 100 | 36 | 16 | 0.0% | 0.0% |
| Corrected 18% symmetric · scaled | 1.0 | 2.4% | 0.8% | 90 | 32 | 14 | 0.0% | 0.0% |
| A rolling-2 top quartile · scaled | 1.0 | 1.9% | 2.5% | 75 | 56 | 24 | 0.0% | 0.0% |
| A rolling-2 70/30 · scaled | 1.0 | 2.4% | 3.1% | 75 | 77 | 27 | 0.0% | 0.0% |
| A rolling-3 top quartile · scaled | 1.0 | 2.2% | 1.3% | 75 | 39 | 12 | 0.0% | 0.0% |
| A2 rolling-2 70/30 + neutral promotion prior · scaled | 1.0 | 2.0% | 3.2% | 75 | 77 | 28 | 0.0% | 0.0% |
| A2 rolling-2 70/30 + half promotion carry · scaled | 1.0 | 2.0% | 3.9% | 75 | 77 | 26 | 0.0% | 0.0% |
| A2 rolling-2 70/30 + full promotion carry · scaled | 1.0 | 1.8% | 4.4% | 75 | 77 | 26 | 0.0% | 0.0% |
| B2 rolling-2 68/32 + 55/45 quality guard · scaled | 1.0 | 2.6% | 2.9% | 75 | 69 | 29 | 0.0% | 0.0% |
| B2 rolling-2 67/33 + 60/40 quality guard · scaled | 1.0 | 2.2% | 2.6% | 75 | 63 | 31 | 0.0% | 0.0% |
| B2 rolling-2 65/35 + promotion floor 55 · scaled | 1.0 | 2.3% | 2.9% | 75 | 75 | 34 | 0.0% | 0.0% |
| B 20% relegation protection · scaled | 1.0 | 2.2% | 6.6% | 100 | 81 | 27 | 12.2% | 0.0% |
| B 15% relegation protection · scaled | 1.0 | 2.0% | 5.2% | 75 | 63 | 22 | 8.6% | 0.0% |
| C 15% human cap 4 · scaled | 1.0 | 2.1% | 2.9% | 75 | 5 | 4 | 0.0% | 9.7% |
| C 15% human cap 8 · scaled | 1.0 | 1.9% | 3.3% | 75 | 9 | 8 | 0.0% | 7.2% |
| C 15% human cap 12 · scaled | 1.0 | 2.0% | 3.4% | 75 | 13 | 12 | 0.0% | 5.4% |
| C2 rolling-2 70/30 + sqrt human limit · scaled | 1.0 | 2.2% | 2.9% | 75 | 40 | 23 | 0.0% | 0.8% |
| C2 rolling-2 70/30 + 15%-cap-32 human limit · scaled | 1.0 | 2.0% | 2.9% | 75 | 32 | 21 | 0.0% | 1.5% |
| D2 rolling-2 65/35 + floor 55 + neutral prior · scaled | 1.0 | 2.4% | 2.7% | 75 | 75 | 32 | 0.0% | 0.0% |
| D2 rolling-2 67/33 + floor 55 + neutral prior · scaled | 1.0 | 2.6% | 2.7% | 75 | 72 | 32 | 0.0% | 0.0% |
| D2 rolling-2 67/33 + floor 55 + quarter carry · scaled | 1.0 | 2.8% | 3.5% | 75 | 72 | 30 | 0.0% | 0.0% |
| D2 rolling-2 66/34 + floor 58 + quarter carry · scaled | 1.0 | 2.4% | 3.0% | 75 | 67 | 30 | 0.0% | 0.0% |
| D2 rolling-2 65/35 + floor 60 + quarter carry · scaled | 1.0 | 2.1% | 2.7% | 75 | 65 | 31 | 0.0% | 0.0% |
| D3 rolling-2 67/33 + floor 55 + quarter carry + sqrt limit · scaled | 1.0 | 2.7% | 3.3% | 75 | 40 | 22 | 0.0% | 0.7% |
| D3 rolling-2 67/33 + floor 55 + quarter carry + 15%-cap-32 · scaled | 1.0 | 2.2% | 3.2% | 75 | 33 | 19 | 0.0% | 2.3% |
| E moderate signal + D2 66/34 floor 58 quarter carry · scaled | 1.0 | 2.3% | 3.1% | 75 | 74 | 35 | 0.0% | 0.0% |
| E wide signal + D2 66/34 floor 58 quarter carry · scaled | 1.0 | 2.2% | 3.4% | 75 | 75 | 31 | 0.0% | 0.0% |
| E moderate signal + D3 adaptive · uniform | 1.0 | 2.0% | 4.1% | 75 | 33 | 17 | 0.0% | 1.4% |
| E moderate signal + D3 adaptive · scaled | 1.0 | 2.1% | 3.0% | 75 | 32 | 20 | 0.0% | 2.4% |
| F moderate signal 64/36 floor 55 quarter carry + 20%-cap-40 · scaled | 1.0 | 2.3% | 3.7% | 75 | 40 | 24 | 0.0% | 1.8% |
| F wide signal 65/35 floor 55 quarter carry + 20%-cap-40 · scaled | 1.0 | 2.2% | 3.6% | 75 | 40 | 25 | 0.0% | 1.4% |
| F wide signal 64/36 floor 55 quarter carry + 20%-cap-40 · scaled | 1.0 | 2.2% | 3.6% | 75 | 40 | 24 | 0.0% | 1.8% |
| F2 moderate signal 64/32 floor 55 quarter carry + 20%-cap-40 · scaled | 1.0 | 2.5% | 3.8% | 75 | 40 | 25 | 0.0% | 1.1% |
| F2 wide signal 64/32 floor 55 quarter carry + 20%-cap-40 · scaled | 1.0 | 2.5% | 3.8% | 75 | 40 | 25 | 0.0% | 1.1% |
| F3 moderate signal 65/32 floor 55 quarter carry + 20%-cap-40 · scaled | 1.0 | 2.6% | 3.7% | 75 | 40 | 24 | 0.0% | 1.0% |
| F3 wide signal 65/32 floor 55 quarter carry + 20%-cap-40 · scaled | 1.0 | 2.3% | 3.8% | 75 | 40 | 25 | 0.0% | 1.0% |
| G wide signal 66/32 floor 55 quarter carry + 20%-cap-40 · scaled | 1.0 | 2.6% | 3.8% | 75 | 40 | 25 | 0.0% | 0.9% |
| H wide signal 65/32 floor 58 quarter carry + 20%-cap-40 · scaled | 1.0 | 2.4% | 3.4% | 75 | 41 | 25 | 0.0% | 0.7% |
| D rolling-2 70/30 + human cap 20 · scaled | 1.0 | 2.4% | 2.9% | 75 | 20 | 20 | 0.0% | 2.7% |

### Per-candidate required-metric appendix

#### v5 20% · uniform

Median active seasons to Pro — Rusty 8.0, Scratch 6.0, Ace 7.0. New-player catch-up to 80% of established same-ability rating — Rusty 7.0, Scratch 8.0, Ace 8.0.

| Horizon | Ability | Local | Challenger | Pro |
|---:|---|---:|---:|---:|
| 4 | rusty | 68.8% | 23.6% | 7.6% |
| 4 | scratch | 50.0% | 32.3% | 17.6% |
| 4 | ace | 53.7% | 33.5% | 12.7% |
| 8 | rusty | 63.0% | 24.8% | 12.2% |
| 8 | scratch | 42.5% | 31.7% | 25.9% |
| 8 | ace | 43.8% | 33.3% | 22.8% |
| 16 | rusty | 54.2% | 29.4% | 16.4% |
| 16 | scratch | 31.6% | 30.4% | 38.0% |
| 16 | ace | 36.2% | 33.5% | 30.2% |

Championship source mix — Pro top six 27.4%, Pro event winner 10.4%, Pro pass-down 7.9%, Challenger top two 9.8%, elite bot 44.5%.

Field-size sensitivity — 20: Ace 63.0%, Rusty 52.8%, Ace median 7.0; 30: Ace 55.6%, Rusty 37.5%, Ace median 6.0; 50: Ace 56.0%, Rusty 44.0%, Ace median 7.0; 100: Ace 62.0%, Rusty 40.3%, Ace median 8.0; 500: Ace 63.9%, Rusty 43.2%, Ace median 7.0.

Human-ratio sensitivity — 25% humans: Ace 61.3%, Rusty 43.7%, Ace median 7.0; 50% humans: Ace 59.7%, Rusty 40.6%, Ace median 7.0; 80% humans: Ace 65.0%, Rusty 44.1%, Ace median 7.0.

Activity sensitivity — full: Ace 72.8%, Rusty 55.0%, Ace median 7.0; occasional: Ace 47.5%, Rusty 26.6%, Ace median 7.0; returning: Ace 66.0%, Rusty 44.4%, Ace median 6.0.

#### v5 20% · scaled

Median active seasons to Pro — Rusty 8.0, Scratch 6.0, Ace 7.0. New-player catch-up to 80% of established same-ability rating — Rusty 7.0, Scratch 8.0, Ace 8.0.

| Horizon | Ability | Local | Challenger | Pro |
|---:|---|---:|---:|---:|
| 4 | rusty | 68.1% | 24.7% | 7.2% |
| 4 | scratch | 48.8% | 34.5% | 16.7% |
| 4 | ace | 53.9% | 33.9% | 12.2% |
| 8 | rusty | 62.7% | 25.8% | 11.5% |
| 8 | scratch | 42.0% | 33.6% | 24.4% |
| 8 | ace | 42.7% | 35.0% | 22.3% |
| 16 | rusty | 54.9% | 29.8% | 15.3% |
| 16 | scratch | 33.3% | 31.3% | 35.4% |
| 16 | ace | 37.5% | 34.8% | 27.6% |

Championship source mix — Pro top six 27.0%, Pro event winner 10.4%, Pro pass-down 7.7%, Challenger top two 9.8%, elite bot 45.1%.

Field-size sensitivity — 20: Ace 59.3%, Rusty 44.4%, Ace median 7.0; 30: Ace 60.0%, Rusty 41.7%, Ace median 6.0; 50: Ace 62.7%, Rusty 36.9%, Ace median 7.0; 100: Ace 59.3%, Rusty 39.0%, Ace median 8.0; 500: Ace 63.2%, Rusty 41.9%, Ace median 7.0.

Human-ratio sensitivity — 25% humans: Ace 58.3%, Rusty 42.1%, Ace median 7.0; 50% humans: Ace 62.0%, Rusty 38.9%, Ace median 7.0; 80% humans: Ace 63.8%, Rusty 42.3%, Ace median 7.0.

Activity sensitivity — full: Ace 70.4%, Rusty 52.3%, Ace median 7.0; occasional: Ace 48.7%, Rusty 26.6%, Ace median 7.0; returning: Ace 66.7%, Rusty 42.2%, Ace median 6.0.

#### Corrected 20% · uniform

Median active seasons to Pro — Rusty 8.0, Scratch 7.0, Ace 6.0. New-player catch-up to 80% of established same-ability rating — Rusty 7.0, Scratch 8.0, Ace 9.0.

| Horizon | Ability | Local | Challenger | Pro |
|---:|---|---:|---:|---:|
| 4 | rusty | 71.6% | 23.6% | 4.8% |
| 4 | scratch | 53.8% | 32.6% | 13.6% |
| 4 | ace | 46.4% | 34.9% | 18.6% |
| 8 | rusty | 68.9% | 22.5% | 8.6% |
| 8 | scratch | 47.7% | 33.2% | 19.0% |
| 8 | ace | 33.6% | 34.2% | 32.2% |
| 16 | rusty | 62.9% | 26.7% | 10.4% |
| 16 | scratch | 34.4% | 32.9% | 32.7% |
| 16 | ace | 26.0% | 32.4% | 41.6% |

Championship source mix — Pro top six 27.2%, Pro event winner 10.6%, Pro pass-down 7.6%, Challenger top two 9.9%, elite bot 44.7%.

Field-size sensitivity — 20: Ace 74.1%, Rusty 38.9%, Ace median 6.5; 30: Ace 68.9%, Rusty 33.3%, Ace median 7.0; 50: Ace 69.3%, Rusty 33.3%, Ace median 6.0; 100: Ace 76.0%, Rusty 23.9%, Ace median 6.0; 500: Ace 74.3%, Rusty 34.4%, Ace median 6.0.

Human-ratio sensitivity — 25% humans: Ace 74.4%, Rusty 35.5%, Ace median 7.0; 50% humans: Ace 70.7%, Rusty 31.9%, Ace median 6.0; 80% humans: Ace 75.9%, Rusty 32.6%, Ace median 6.0.

Activity sensitivity — full: Ace 85.2%, Rusty 40.3%, Ace median 7.0; occasional: Ace 58.8%, Rusty 20.4%, Ace median 6.0; returning: Ace 75.4%, Rusty 36.6%, Ace median 6.0.

#### Corrected 20% · scaled

Median active seasons to Pro — Rusty 8.0, Scratch 7.0, Ace 7.0. New-player catch-up to 80% of established same-ability rating — Rusty 7.0, Scratch 7.0, Ace 8.0.

| Horizon | Ability | Local | Challenger | Pro |
|---:|---|---:|---:|---:|
| 4 | rusty | 70.5% | 25.7% | 3.9% |
| 4 | scratch | 51.4% | 35.4% | 13.2% |
| 4 | ace | 45.2% | 37.1% | 17.7% |
| 8 | rusty | 69.0% | 24.1% | 6.9% |
| 8 | scratch | 45.6% | 37.0% | 17.4% |
| 8 | ace | 33.9% | 37.5% | 28.7% |
| 16 | rusty | 63.1% | 28.2% | 8.8% |
| 16 | scratch | 36.7% | 35.5% | 27.8% |
| 16 | ace | 28.1% | 36.0% | 36.0% |

Championship source mix — Pro top six 27.4%, Pro event winner 11.0%, Pro pass-down 7.3%, Challenger top two 9.9%, elite bot 44.3%.

Field-size sensitivity — 20: Ace 70.4%, Rusty 44.4%, Ace median 8.0; 30: Ace 71.1%, Rusty 29.2%, Ace median 6.5; 50: Ace 64.0%, Rusty 34.5%, Ace median 6.5; 100: Ace 72.0%, Rusty 25.8%, Ace median 7.0; 500: Ace 72.5%, Rusty 34.4%, Ace median 7.0.

Human-ratio sensitivity — 25% humans: Ace 72.6%, Rusty 34.4%, Ace median 7.0; 50% humans: Ace 69.0%, Rusty 31.1%, Ace median 6.0; 80% humans: Ace 73.2%, Rusty 34.2%, Ace median 7.0.

Activity sensitivity — full: Ace 82.6%, Rusty 41.4%, Ace median 7.0; occasional: Ace 56.5%, Rusty 19.0%, Ace median 7.0; returning: Ace 73.7%, Rusty 37.9%, Ace median 6.0.

#### Corrected 12% · uniform

Median active seasons to Pro — Rusty 9.5, Scratch 8.0, Ace 8.0. New-player catch-up to 80% of established same-ability rating — Rusty 7.0, Scratch 7.0, Ace 8.0.

| Horizon | Ability | Local | Challenger | Pro |
|---:|---|---:|---:|---:|
| 4 | rusty | 82.0% | 15.9% | 2.1% |
| 4 | scratch | 64.5% | 27.8% | 7.7% |
| 4 | ace | 61.0% | 30.5% | 8.4% |
| 8 | rusty | 77.0% | 18.7% | 4.3% |
| 8 | scratch | 56.7% | 32.5% | 10.8% |
| 8 | ace | 44.1% | 36.6% | 19.3% |
| 16 | rusty | 70.6% | 22.6% | 6.9% |
| 16 | scratch | 41.9% | 30.6% | 27.5% |
| 16 | ace | 27.1% | 36.3% | 36.6% |

Championship source mix — Pro top six 23.0%, Pro event winner 9.4%, Pro pass-down 5.9%, Challenger top two 9.8%, elite bot 52.0%.

Field-size sensitivity — 20: Ace 48.1%, Rusty 19.4%, Ace median 14.0; 30: Ace 42.2%, Rusty 16.7%, Ace median 8.0; 50: Ace 45.3%, Rusty 15.5%, Ace median 7.0; 100: Ace 58.7%, Rusty 8.8%, Ace median 8.0; 500: Ace 54.7%, Rusty 17.2%, Ace median 8.0.

Human-ratio sensitivity — 25% humans: Ace 50.6%, Rusty 19.1%, Ace median 8.0; 50% humans: Ace 50.7%, Rusty 14.8%, Ace median 8.0; 80% humans: Ace 56.9%, Rusty 15.5%, Ace median 8.0.

Activity sensitivity — full: Ace 65.0%, Rusty 20.0%, Ace median 8.0; occasional: Ace 39.4%, Rusty 9.0%, Ace median 8.0; returning: Ace 54.9%, Rusty 18.0%, Ace median 8.0.

#### Corrected 12% · scaled

Median active seasons to Pro — Rusty 9.0, Scratch 9.0, Ace 8.0. New-player catch-up to 80% of established same-ability rating — Rusty 7.0, Scratch 7.0, Ace 8.0.

| Horizon | Ability | Local | Challenger | Pro |
|---:|---|---:|---:|---:|
| 4 | rusty | 80.4% | 17.7% | 1.9% |
| 4 | scratch | 62.5% | 31.5% | 6.0% |
| 4 | ace | 58.8% | 32.8% | 8.4% |
| 8 | rusty | 75.2% | 21.0% | 3.8% |
| 8 | scratch | 55.9% | 35.4% | 8.8% |
| 8 | ace | 41.0% | 41.2% | 17.8% |
| 16 | rusty | 70.6% | 23.7% | 5.8% |
| 16 | scratch | 41.3% | 36.0% | 22.7% |
| 16 | ace | 28.0% | 42.2% | 29.8% |

Championship source mix — Pro top six 23.0%, Pro event winner 9.5%, Pro pass-down 5.8%, Challenger top two 9.9%, elite bot 51.7%.

Field-size sensitivity — 20: Ace 44.4%, Rusty 11.1%, Ace median 9.5; 30: Ace 37.8%, Rusty 18.8%, Ace median 11.0; 50: Ace 45.3%, Rusty 19.0%, Ace median 7.5; 100: Ace 57.3%, Rusty 6.9%, Ace median 8.0; 500: Ace 53.8%, Rusty 15.9%, Ace median 8.0.

Human-ratio sensitivity — 25% humans: Ace 51.8%, Rusty 16.4%, Ace median 9.0; 50% humans: Ace 50.4%, Rusty 13.4%, Ace median 8.0; 80% humans: Ace 54.6%, Rusty 15.2%, Ace median 8.0.

Activity sensitivity — full: Ace 65.3%, Rusty 17.8%, Ace median 8.0; occasional: Ace 36.5%, Rusty 8.7%, Ace median 8.0; returning: Ace 53.9%, Rusty 17.6%, Ace median 8.0.

#### Corrected 20% compressed · uniform

Median active seasons to Pro — Rusty 8.0, Scratch 7.0, Ace 6.0. New-player catch-up to 80% of established same-ability rating — Rusty 7.0, Scratch 7.0, Ace 8.0.

| Horizon | Ability | Local | Challenger | Pro |
|---:|---|---:|---:|---:|
| 4 | rusty | 71.6% | 23.6% | 4.8% |
| 4 | scratch | 53.8% | 32.6% | 13.6% |
| 4 | ace | 46.4% | 34.9% | 18.6% |
| 8 | rusty | 68.9% | 22.5% | 8.6% |
| 8 | scratch | 47.7% | 33.2% | 19.0% |
| 8 | ace | 33.6% | 34.2% | 32.2% |
| 16 | rusty | 62.9% | 26.7% | 10.4% |
| 16 | scratch | 34.4% | 32.9% | 32.7% |
| 16 | ace | 26.0% | 32.4% | 41.6% |

Championship source mix — Pro top six 27.2%, Pro event winner 10.6%, Pro pass-down 7.6%, Challenger top two 9.9%, elite bot 44.7%.

Field-size sensitivity — 20: Ace 74.1%, Rusty 38.9%, Ace median 6.5; 30: Ace 68.9%, Rusty 33.3%, Ace median 7.0; 50: Ace 69.3%, Rusty 33.3%, Ace median 6.0; 100: Ace 76.0%, Rusty 23.9%, Ace median 6.0; 500: Ace 74.3%, Rusty 34.4%, Ace median 6.0.

Human-ratio sensitivity — 25% humans: Ace 74.4%, Rusty 35.5%, Ace median 7.0; 50% humans: Ace 70.7%, Rusty 31.9%, Ace median 6.0; 80% humans: Ace 75.9%, Rusty 32.6%, Ace median 6.0.

Activity sensitivity — full: Ace 85.2%, Rusty 40.3%, Ace median 7.0; occasional: Ace 58.8%, Rusty 20.4%, Ace median 6.0; returning: Ace 75.4%, Rusty 36.6%, Ace median 6.0.

#### Corrected 20% compressed · scaled

Median active seasons to Pro — Rusty 8.0, Scratch 7.0, Ace 7.0. New-player catch-up to 80% of established same-ability rating — Rusty 7.0, Scratch 7.0, Ace 8.0.

| Horizon | Ability | Local | Challenger | Pro |
|---:|---|---:|---:|---:|
| 4 | rusty | 70.5% | 25.7% | 3.9% |
| 4 | scratch | 51.4% | 35.4% | 13.2% |
| 4 | ace | 45.2% | 37.1% | 17.7% |
| 8 | rusty | 69.0% | 24.1% | 6.9% |
| 8 | scratch | 45.6% | 37.0% | 17.4% |
| 8 | ace | 33.9% | 37.5% | 28.7% |
| 16 | rusty | 63.1% | 28.2% | 8.8% |
| 16 | scratch | 36.7% | 35.5% | 27.8% |
| 16 | ace | 28.1% | 36.0% | 36.0% |

Championship source mix — Pro top six 27.4%, Pro event winner 11.0%, Pro pass-down 7.3%, Challenger top two 9.9%, elite bot 44.3%.

Field-size sensitivity — 20: Ace 70.4%, Rusty 44.4%, Ace median 8.0; 30: Ace 71.1%, Rusty 29.2%, Ace median 6.5; 50: Ace 64.0%, Rusty 34.5%, Ace median 6.5; 100: Ace 72.0%, Rusty 25.8%, Ace median 7.0; 500: Ace 72.5%, Rusty 34.4%, Ace median 7.0.

Human-ratio sensitivity — 25% humans: Ace 72.6%, Rusty 34.4%, Ace median 7.0; 50% humans: Ace 69.0%, Rusty 31.1%, Ace median 6.0; 80% humans: Ace 73.2%, Rusty 34.2%, Ace median 7.0.

Activity sensitivity — full: Ace 82.6%, Rusty 41.4%, Ace median 7.0; occasional: Ace 56.5%, Rusty 19.0%, Ace median 7.0; returning: Ace 73.7%, Rusty 37.9%, Ace median 6.0.

#### Corrected 15% · scaled

Median active seasons to Pro — Rusty 9.0, Scratch 8.0, Ace 7.0. New-player catch-up to 80% of established same-ability rating — Rusty 7.0, Scratch 7.0, Ace 8.0.

| Horizon | Ability | Local | Challenger | Pro |
|---:|---|---:|---:|---:|
| 4 | rusty | 76.7% | 20.7% | 2.6% |
| 4 | scratch | 57.2% | 33.6% | 9.1% |
| 4 | ace | 51.7% | 36.4% | 11.9% |
| 8 | rusty | 72.7% | 22.1% | 5.1% |
| 8 | scratch | 50.8% | 38.0% | 11.3% |
| 8 | ace | 37.0% | 38.6% | 24.4% |
| 16 | rusty | 66.8% | 25.7% | 7.6% |
| 16 | scratch | 38.0% | 34.9% | 27.1% |
| 16 | ace | 27.8% | 38.2% | 34.0% |

Championship source mix — Pro top six 24.9%, Pro event winner 10.2%, Pro pass-down 6.4%, Challenger top two 9.9%, elite bot 48.6%.

Field-size sensitivity — 20: Ace 59.3%, Rusty 38.9%, Ace median 8.5; 30: Ace 55.6%, Rusty 18.8%, Ace median 9.0; 50: Ace 53.3%, Rusty 26.2%, Ace median 7.0; 100: Ace 64.0%, Rusty 15.7%, Ace median 8.0; 500: Ace 63.2%, Rusty 21.0%, Ace median 7.0.

Human-ratio sensitivity — 25% humans: Ace 63.1%, Rusty 24.0%, Ace median 8.0; 50% humans: Ace 60.3%, Rusty 18.8%, Ace median 7.0; 80% humans: Ace 63.1%, Rusty 21.7%, Ace median 7.0.

Activity sensitivity — full: Ace 75.1%, Rusty 26.8%, Ace median 8.0; occasional: Ace 46.1%, Rusty 12.3%, Ace median 7.0; returning: Ace 62.3%, Rusty 23.2%, Ace median 7.0.

#### Corrected 18% · scaled

Median active seasons to Pro — Rusty 9.0, Scratch 7.0, Ace 7.0. New-player catch-up to 80% of established same-ability rating — Rusty 7.0, Scratch 7.0, Ace 8.0.

| Horizon | Ability | Local | Challenger | Pro |
|---:|---|---:|---:|---:|
| 4 | rusty | 73.1% | 23.8% | 3.2% |
| 4 | scratch | 54.1% | 34.2% | 11.7% |
| 4 | ace | 47.3% | 37.7% | 15.0% |
| 8 | rusty | 70.6% | 22.9% | 6.5% |
| 8 | scratch | 48.2% | 37.2% | 14.6% |
| 8 | ace | 34.8% | 39.0% | 26.1% |
| 16 | rusty | 63.8% | 28.4% | 7.9% |
| 16 | scratch | 37.2% | 34.6% | 28.2% |
| 16 | ace | 27.3% | 38.2% | 34.5% |

Championship source mix — Pro top six 25.8%, Pro event winner 10.5%, Pro pass-down 6.7%, Challenger top two 9.9%, elite bot 47.0%.

Field-size sensitivity — 20: Ace 59.3%, Rusty 36.1%, Ace median 8.0; 30: Ace 71.1%, Rusty 25.0%, Ace median 7.0; 50: Ace 61.3%, Rusty 28.6%, Ace median 6.5; 100: Ace 67.3%, Rusty 18.9%, Ace median 7.0; 500: Ace 68.7%, Rusty 28.3%, Ace median 7.0.

Human-ratio sensitivity — 25% humans: Ace 69.0%, Rusty 29.0%, Ace median 7.0; 50% humans: Ace 65.5%, Rusty 26.9%, Ace median 6.0; 80% humans: Ace 69.0%, Rusty 26.6%, Ace median 7.0.

Activity sensitivity — full: Ace 79.6%, Rusty 34.0%, Ace median 7.0; occasional: Ace 52.8%, Rusty 15.4%, Ace median 7.0; returning: Ace 68.7%, Rusty 30.7%, Ace median 6.0.

#### Corrected 20% symmetric · scaled

Median active seasons to Pro — Rusty 13.0, Scratch 12.0, Ace 11.0. New-player catch-up to 80% of established same-ability rating — Rusty 7.0, Scratch 7.0, Ace 7.0.

| Horizon | Ability | Local | Challenger | Pro |
|---:|---|---:|---:|---:|
| 4 | rusty | 95.5% | 4.2% | 0.3% |
| 4 | scratch | 87.7% | 12.3% | 0.0% |
| 4 | ace | 85.3% | 14.6% | 0.1% |
| 8 | rusty | 92.5% | 7.1% | 0.4% |
| 8 | scratch | 80.5% | 18.5% | 1.0% |
| 8 | ace | 73.7% | 23.7% | 2.6% |
| 16 | rusty | 87.1% | 12.1% | 0.8% |
| 16 | scratch | 63.7% | 29.3% | 7.0% |
| 16 | ace | 54.9% | 32.0% | 13.1% |

Championship source mix — Pro top six 9.4%, Pro event winner 4.0%, Pro pass-down 2.3%, Challenger top two 9.0%, elite bot 75.2%.

Field-size sensitivity — 20: Ace 14.8%, Rusty 0.0%, Ace median 8.0; 30: Ace 15.6%, Rusty 0.0%, Ace median 13.0; 50: Ace 13.3%, Rusty 1.2%, Ace median 11.0; 100: Ace 16.7%, Rusty 1.3%, Ace median 10.0; 500: Ace 14.4%, Rusty 1.0%, Ace median 11.0.

Human-ratio sensitivity — 25% humans: Ace 17.9%, Rusty 1.1%, Ace median 10.5; 50% humans: Ace 16.8%, Rusty 0.8%, Ace median 11.0; 80% humans: Ace 12.4%, Rusty 1.1%, Ace median 11.0.

Activity sensitivity — full: Ace 22.5%, Rusty 1.4%, Ace median 11.0; occasional: Ace 5.2%, Rusty 0.3%, Ace median 10.5; returning: Ace 14.5%, Rusty 1.3%, Ace median 11.0.

#### Corrected 18% symmetric · scaled

Median active seasons to Pro — Rusty 13.0, Scratch 12.0, Ace 11.0. New-player catch-up to 80% of established same-ability rating — Rusty 6.0, Scratch 7.0, Ace 7.0.

| Horizon | Ability | Local | Challenger | Pro |
|---:|---|---:|---:|---:|
| 4 | rusty | 96.5% | 3.3% | 0.3% |
| 4 | scratch | 89.7% | 10.3% | 0.0% |
| 4 | ace | 87.0% | 12.9% | 0.1% |
| 8 | rusty | 94.4% | 5.4% | 0.2% |
| 8 | scratch | 83.7% | 15.8% | 0.6% |
| 8 | ace | 76.8% | 21.3% | 2.0% |
| 16 | rusty | 89.4% | 9.7% | 0.9% |
| 16 | scratch | 68.0% | 26.8% | 5.3% |
| 16 | ace | 59.6% | 30.3% | 10.1% |

Championship source mix — Pro top six 8.3%, Pro event winner 3.8%, Pro pass-down 1.7%, Challenger top two 8.7%, elite bot 77.5%.

Field-size sensitivity — 20: Ace 11.1%, Rusty 0.0%, Ace median 10.0; 30: Ace 13.3%, Rusty 0.0%, Ace median 12.5; 50: Ace 9.3%, Rusty 1.2%, Ace median 10.0; 100: Ace 11.3%, Rusty 0.6%, Ace median 10.0; 500: Ace 11.4%, Rusty 1.0%, Ace median 11.0.

Human-ratio sensitivity — 25% humans: Ace 13.1%, Rusty 1.1%, Ace median 10.5; 50% humans: Ace 13.3%, Rusty 0.6%, Ace median 11.0; 80% humans: Ace 9.5%, Rusty 1.1%, Ace median 11.0.

Activity sensitivity — full: Ace 17.6%, Rusty 1.1%, Ace median 11.0; occasional: Ace 4.1%, Rusty 0.0%, Ace median 11.0; returning: Ace 10.8%, Rusty 1.6%, Ace median 10.0.

#### A rolling-2 top quartile · scaled

Median active seasons to Pro — Rusty 11.0, Scratch 10.0, Ace 9.0. New-player catch-up to 80% of established same-ability rating — Rusty 7.0, Scratch 8.0, Ace 8.0.

| Horizon | Ability | Local | Challenger | Pro |
|---:|---|---:|---:|---:|
| 4 | rusty | 84.1% | 15.4% | 0.5% |
| 4 | scratch | 68.5% | 30.0% | 1.5% |
| 4 | ace | 63.6% | 32.6% | 3.8% |
| 8 | rusty | 77.9% | 19.9% | 2.3% |
| 8 | scratch | 56.6% | 35.7% | 7.7% |
| 8 | ace | 42.5% | 43.0% | 14.5% |
| 16 | rusty | 72.0% | 24.0% | 4.0% |
| 16 | scratch | 43.5% | 35.5% | 21.0% |
| 16 | ace | 30.4% | 38.3% | 31.3% |

Championship source mix — Pro top six 15.3%, Pro event winner 6.0%, Pro pass-down 4.3%, Challenger top two 9.8%, elite bot 64.7%.

Field-size sensitivity — 20: Ace 44.4%, Rusty 8.3%, Ace median 10.5; 30: Ace 53.3%, Rusty 8.3%, Ace median 10.0; 50: Ace 42.7%, Rusty 7.1%, Ace median 10.0; 100: Ace 50.7%, Rusty 5.7%, Ace median 9.0; 500: Ace 44.4%, Rusty 9.0%, Ace median 9.0.

Human-ratio sensitivity — 25% humans: Ace 48.8%, Rusty 8.7%, Ace median 9.0; 50% humans: Ace 41.7%, Rusty 6.7%, Ace median 9.0; 80% humans: Ace 46.8%, Rusty 9.2%, Ace median 10.0.

Activity sensitivity — full: Ace 57.7%, Rusty 12.8%, Ace median 10.0; occasional: Ace 28.4%, Rusty 3.6%, Ace median 9.0; returning: Ace 47.8%, Rusty 7.2%, Ace median 9.0.

#### A rolling-2 70/30 · scaled

Median active seasons to Pro — Rusty 10.0, Scratch 9.0, Ace 8.0. New-player catch-up to 80% of established same-ability rating — Rusty 7.0, Scratch 8.0, Ace 8.0.

| Horizon | Ability | Local | Challenger | Pro |
|---:|---|---:|---:|---:|
| 4 | rusty | 77.4% | 21.7% | 0.9% |
| 4 | scratch | 59.6% | 37.1% | 3.3% |
| 4 | ace | 55.2% | 38.7% | 6.1% |
| 8 | rusty | 73.3% | 23.0% | 3.7% |
| 8 | scratch | 51.0% | 36.3% | 12.7% |
| 8 | ace | 37.0% | 41.7% | 21.3% |
| 16 | rusty | 67.7% | 25.7% | 6.7% |
| 16 | scratch | 39.9% | 35.5% | 24.7% |
| 16 | ace | 27.1% | 37.5% | 35.5% |

Championship source mix — Pro top six 16.1%, Pro event winner 6.1%, Pro pass-down 4.6%, Challenger top two 9.9%, elite bot 63.3%.

Field-size sensitivity — 20: Ace 66.7%, Rusty 13.9%, Ace median 8.5; 30: Ace 60.0%, Rusty 20.8%, Ace median 7.0; 50: Ace 50.7%, Rusty 17.9%, Ace median 8.5; 100: Ace 58.7%, Rusty 12.6%, Ace median 8.0; 500: Ace 58.2%, Rusty 16.3%, Ace median 8.0.

Human-ratio sensitivity — 25% humans: Ace 60.1%, Rusty 13.7%, Ace median 8.0; 50% humans: Ace 54.8%, Rusty 16.0%, Ace median 8.0; 80% humans: Ace 59.5%, Rusty 16.8%, Ace median 9.0.

Activity sensitivity — full: Ace 70.2%, Rusty 20.9%, Ace median 9.0; occasional: Ace 36.8%, Rusty 7.3%, Ace median 8.0; returning: Ace 65.3%, Rusty 19.0%, Ace median 8.0.

#### A rolling-3 top quartile · scaled

Median active seasons to Pro — Rusty 12.0, Scratch 11.0, Ace 11.0. New-player catch-up to 80% of established same-ability rating — Rusty 7.0, Scratch 7.0, Ace 8.0.

| Horizon | Ability | Local | Challenger | Pro |
|---:|---|---:|---:|---:|
| 4 | rusty | 94.9% | 5.1% | 0.0% |
| 4 | scratch | 85.4% | 14.6% | 0.0% |
| 4 | ace | 81.6% | 18.4% | 0.0% |
| 8 | rusty | 89.4% | 10.2% | 0.4% |
| 8 | scratch | 74.3% | 24.8% | 0.8% |
| 8 | ace | 61.8% | 35.0% | 3.2% |
| 16 | rusty | 82.8% | 16.0% | 1.2% |
| 16 | scratch | 53.4% | 36.0% | 10.6% |
| 16 | ace | 39.8% | 41.5% | 18.7% |

Championship source mix — Pro top six 10.4%, Pro event winner 4.3%, Pro pass-down 2.6%, Challenger top two 9.4%, elite bot 73.3%.

Field-size sensitivity — 20: Ace 29.6%, Rusty 0.0%, Ace median 13.0; 30: Ace 22.2%, Rusty 6.3%, Ace median 12.0; 50: Ace 21.3%, Rusty 1.2%, Ace median 10.0; 100: Ace 26.0%, Rusty 0.6%, Ace median 11.0; 500: Ace 19.5%, Rusty 1.7%, Ace median 11.0.

Human-ratio sensitivity — 25% humans: Ace 26.8%, Rusty 1.6%, Ace median 11.0; 50% humans: Ace 19.4%, Rusty 1.7%, Ace median 11.0; 80% humans: Ace 20.0%, Rusty 1.6%, Ace median 11.0.

Activity sensitivity — full: Ace 32.2%, Rusty 2.5%, Ace median 11.0; occasional: Ace 7.2%, Rusty 0.3%, Ace median 10.0; returning: Ace 20.5%, Rusty 2.0%, Ace median 10.0.

#### A2 rolling-2 70/30 + neutral promotion prior · scaled

Median active seasons to Pro — Rusty 9.0, Scratch 9.0, Ace 8.0. New-player catch-up to 80% of established same-ability rating — Rusty 7.0, Scratch 8.0, Ace 8.0.

| Horizon | Ability | Local | Challenger | Pro |
|---:|---|---:|---:|---:|
| 4 | rusty | 79.0% | 19.3% | 1.7% |
| 4 | scratch | 62.3% | 32.5% | 5.2% |
| 4 | ace | 57.8% | 34.1% | 8.1% |
| 8 | rusty | 75.0% | 21.0% | 4.0% |
| 8 | scratch | 52.3% | 35.0% | 12.7% |
| 8 | ace | 39.0% | 40.4% | 20.6% |
| 16 | rusty | 70.7% | 22.8% | 6.5% |
| 16 | scratch | 41.5% | 34.3% | 24.2% |
| 16 | ace | 27.7% | 35.9% | 36.4% |

Championship source mix — Pro top six 22.6%, Pro event winner 9.5%, Pro pass-down 5.5%, Challenger top two 9.9%, elite bot 52.5%.

Field-size sensitivity — 20: Ace 66.7%, Rusty 11.1%, Ace median 8.5; 30: Ace 60.0%, Rusty 22.9%, Ace median 7.0; 50: Ace 54.7%, Rusty 20.2%, Ace median 8.0; 100: Ace 60.0%, Rusty 11.9%, Ace median 8.0; 500: Ace 61.2%, Rusty 17.9%, Ace median 8.0.

Human-ratio sensitivity — 25% humans: Ace 63.1%, Rusty 13.7%, Ace median 7.0; 50% humans: Ace 58.6%, Rusty 17.1%, Ace median 7.5; 80% humans: Ace 61.3%, Rusty 18.5%, Ace median 8.0.

Activity sensitivity — full: Ace 73.5%, Rusty 22.3%, Ace median 9.0; occasional: Ace 39.1%, Rusty 8.7%, Ace median 8.0; returning: Ace 67.3%, Rusty 19.9%, Ace median 7.0.

#### A2 rolling-2 70/30 + half promotion carry · scaled

Median active seasons to Pro — Rusty 9.0, Scratch 8.0, Ace 7.0. New-player catch-up to 80% of established same-ability rating — Rusty 7.0, Scratch 8.0, Ace 9.0.

| Horizon | Ability | Local | Challenger | Pro |
|---:|---|---:|---:|---:|
| 4 | rusty | 77.4% | 18.4% | 4.2% |
| 4 | scratch | 59.6% | 31.7% | 8.8% |
| 4 | ace | 55.4% | 31.6% | 13.0% |
| 8 | rusty | 72.4% | 22.0% | 5.7% |
| 8 | scratch | 48.9% | 33.6% | 17.5% |
| 8 | ace | 34.6% | 38.9% | 26.6% |
| 16 | rusty | 66.0% | 25.2% | 8.8% |
| 16 | scratch | 38.9% | 32.5% | 28.6% |
| 16 | ace | 24.8% | 35.3% | 39.9% |

Championship source mix — Pro top six 25.0%, Pro event winner 10.3%, Pro pass-down 6.4%, Challenger top two 9.8%, elite bot 48.4%.

Field-size sensitivity — 20: Ace 70.4%, Rusty 25.0%, Ace median 8.0; 30: Ace 64.4%, Rusty 25.0%, Ace median 7.0; 50: Ace 62.7%, Rusty 23.8%, Ace median 8.0; 100: Ace 64.7%, Rusty 18.9%, Ace median 7.0; 500: Ace 67.3%, Rusty 26.2%, Ace median 7.0.

Human-ratio sensitivity — 25% humans: Ace 66.7%, Rusty 21.9%, Ace median 7.0; 50% humans: Ace 62.9%, Rusty 23.2%, Ace median 7.0; 80% humans: Ace 68.8%, Rusty 26.8%, Ace median 8.0.

Activity sensitivity — full: Ace 79.1%, Rusty 33.6%, Ace median 8.0; occasional: Ace 44.1%, Rusty 12.3%, Ace median 7.0; returning: Ace 74.7%, Rusty 26.8%, Ace median 7.0.

#### A2 rolling-2 70/30 + full promotion carry · scaled

Median active seasons to Pro — Rusty 9.0, Scratch 7.0, Ace 7.0. New-player catch-up to 80% of established same-ability rating — Rusty 7.0, Scratch 8.0, Ace 9.0.

| Horizon | Ability | Local | Challenger | Pro |
|---:|---|---:|---:|---:|
| 4 | rusty | 77.4% | 16.6% | 6.0% |
| 4 | scratch | 59.6% | 27.5% | 12.9% |
| 4 | ace | 55.3% | 27.2% | 17.4% |
| 8 | rusty | 71.7% | 21.0% | 7.3% |
| 8 | scratch | 48.1% | 32.3% | 19.6% |
| 8 | ace | 32.7% | 36.0% | 31.3% |
| 16 | rusty | 63.4% | 25.0% | 11.6% |
| 16 | scratch | 37.7% | 30.9% | 31.4% |
| 16 | ace | 23.1% | 33.2% | 43.6% |

Championship source mix — Pro top six 27.0%, Pro event winner 11.0%, Pro pass-down 7.0%, Challenger top two 9.8%, elite bot 45.1%.

Field-size sensitivity — 20: Ace 74.1%, Rusty 30.6%, Ace median 8.5; 30: Ace 66.7%, Rusty 29.2%, Ace median 6.5; 50: Ace 65.3%, Rusty 33.3%, Ace median 8.0; 100: Ace 70.0%, Rusty 27.0%, Ace median 7.0; 500: Ace 73.4%, Rusty 34.4%, Ace median 7.0.

Human-ratio sensitivity — 25% humans: Ace 72.6%, Rusty 30.6%, Ace median 7.0; 50% humans: Ace 68.1%, Rusty 29.4%, Ace median 7.0; 80% humans: Ace 74.4%, Rusty 35.8%, Ace median 7.0.

Activity sensitivity — full: Ace 82.9%, Rusty 39.4%, Ace median 7.0; occasional: Ace 51.0%, Rusty 21.3%, Ace median 7.0; returning: Ace 81.1%, Rusty 36.9%, Ace median 7.0.

#### B2 rolling-2 68/32 + 55/45 quality guard · scaled

Median active seasons to Pro — Rusty 9.0, Scratch 9.0, Ace 8.0. New-player catch-up to 80% of established same-ability rating — Rusty 7.0, Scratch 7.0, Ace 8.0.

| Horizon | Ability | Local | Challenger | Pro |
|---:|---|---:|---:|---:|
| 4 | rusty | 78.2% | 20.7% | 1.1% |
| 4 | scratch | 61.0% | 36.2% | 2.8% |
| 4 | ace | 57.0% | 37.5% | 5.4% |
| 8 | rusty | 72.4% | 23.8% | 3.9% |
| 8 | scratch | 52.5% | 36.6% | 10.9% |
| 8 | ace | 39.7% | 39.6% | 20.7% |
| 16 | rusty | 67.6% | 25.6% | 6.9% |
| 16 | scratch | 40.3% | 36.8% | 22.9% |
| 16 | ace | 26.5% | 39.0% | 34.6% |

Championship source mix — Pro top six 15.6%, Pro event winner 6.1%, Pro pass-down 4.3%, Challenger top two 9.8%, elite bot 64.2%.

Field-size sensitivity — 20: Ace 55.6%, Rusty 13.9%, Ace median 11.0; 30: Ace 60.0%, Rusty 14.6%, Ace median 8.0; 50: Ace 46.7%, Rusty 15.5%, Ace median 9.0; 100: Ace 58.7%, Rusty 12.6%, Ace median 8.0; 500: Ace 55.8%, Rusty 14.5%, Ace median 8.0.

Human-ratio sensitivity — 25% humans: Ace 58.9%, Rusty 12.6%, Ace median 8.0; 50% humans: Ace 51.0%, Rusty 13.4%, Ace median 8.0; 80% humans: Ace 57.7%, Rusty 15.3%, Ace median 9.0.

Activity sensitivity — full: Ace 67.6%, Rusty 20.7%, Ace median 9.0; occasional: Ace 37.4%, Rusty 5.9%, Ace median 8.0; returning: Ace 59.9%, Rusty 14.7%, Ace median 7.0.

#### B2 rolling-2 67/33 + 60/40 quality guard · scaled

Median active seasons to Pro — Rusty 10.0, Scratch 9.0, Ace 9.0. New-player catch-up to 80% of established same-ability rating — Rusty 7.0, Scratch 7.0, Ace 8.0.

| Horizon | Ability | Local | Challenger | Pro |
|---:|---|---:|---:|---:|
| 4 | rusty | 80.2% | 18.9% | 0.9% |
| 4 | scratch | 65.0% | 33.0% | 2.0% |
| 4 | ace | 60.3% | 35.1% | 4.6% |
| 8 | rusty | 74.4% | 21.9% | 3.7% |
| 8 | scratch | 53.9% | 36.7% | 9.4% |
| 8 | ace | 42.4% | 40.3% | 17.3% |
| 16 | rusty | 67.8% | 24.9% | 7.3% |
| 16 | scratch | 42.7% | 35.9% | 21.4% |
| 16 | ace | 29.3% | 37.5% | 33.2% |

Championship source mix — Pro top six 15.5%, Pro event winner 6.0%, Pro pass-down 4.3%, Challenger top two 9.8%, elite bot 64.3%.

Field-size sensitivity — 20: Ace 44.4%, Rusty 5.6%, Ace median 13.0; 30: Ace 57.8%, Rusty 10.4%, Ace median 10.5; 50: Ace 41.3%, Rusty 13.1%, Ace median 10.0; 100: Ace 52.7%, Rusty 12.6%, Ace median 9.0; 500: Ace 51.4%, Rusty 13.3%, Ace median 9.0.

Human-ratio sensitivity — 25% humans: Ace 56.0%, Rusty 10.9%, Ace median 9.0; 50% humans: Ace 47.2%, Rusty 11.8%, Ace median 8.0; 80% humans: Ace 51.7%, Rusty 14.1%, Ace median 10.0.

Activity sensitivity — full: Ace 63.1%, Rusty 18.7%, Ace median 9.0; occasional: Ace 32.5%, Rusty 5.3%, Ace median 8.0; returning: Ace 54.9%, Rusty 13.1%, Ace median 8.0.

#### B2 rolling-2 65/35 + promotion floor 55 · scaled

Median active seasons to Pro — Rusty 9.0, Scratch 9.0, Ace 8.0. New-player catch-up to 80% of established same-ability rating — Rusty 7.0, Scratch 7.0, Ace 8.0.

| Horizon | Ability | Local | Challenger | Pro |
|---:|---|---:|---:|---:|
| 4 | rusty | 78.0% | 20.6% | 1.4% |
| 4 | scratch | 61.2% | 35.6% | 3.1% |
| 4 | ace | 55.4% | 38.4% | 6.2% |
| 8 | rusty | 74.3% | 22.2% | 3.5% |
| 8 | scratch | 55.4% | 33.4% | 11.2% |
| 8 | ace | 41.9% | 38.2% | 19.9% |
| 16 | rusty | 70.3% | 23.8% | 5.9% |
| 16 | scratch | 46.8% | 34.6% | 18.6% |
| 16 | ace | 32.4% | 39.0% | 28.6% |

Championship source mix — Pro top six 15.6%, Pro event winner 6.0%, Pro pass-down 4.4%, Challenger top two 9.8%, elite bot 64.2%.

Field-size sensitivity — 20: Ace 59.3%, Rusty 8.3%, Ace median 8.0; 30: Ace 57.8%, Rusty 12.5%, Ace median 7.5; 50: Ace 52.0%, Rusty 15.5%, Ace median 9.0; 100: Ace 59.3%, Rusty 12.6%, Ace median 8.0; 500: Ace 55.6%, Rusty 15.1%, Ace median 8.0.

Human-ratio sensitivity — 25% humans: Ace 57.1%, Rusty 13.7%, Ace median 7.0; 50% humans: Ace 55.1%, Rusty 12.9%, Ace median 8.0; 80% humans: Ace 56.4%, Rusty 15.7%, Ace median 9.0.

Activity sensitivity — full: Ace 67.8%, Rusty 20.3%, Ace median 9.0; occasional: Ace 36.8%, Rusty 6.2%, Ace median 8.0; returning: Ace 61.6%, Rusty 15.7%, Ace median 7.0.

#### B 20% relegation protection · scaled

Median active seasons to Pro — Rusty 8.0, Scratch 7.0, Ace 6.0. New-player catch-up to 80% of established same-ability rating — Rusty 8.0, Scratch 9.0, Ace 9.0.

| Horizon | Ability | Local | Challenger | Pro |
|---:|---|---:|---:|---:|
| 4 | rusty | 58.4% | 34.1% | 7.4% |
| 4 | scratch | 39.2% | 42.9% | 17.9% |
| 4 | ace | 34.4% | 43.0% | 22.7% |
| 8 | rusty | 45.2% | 38.5% | 16.4% |
| 8 | scratch | 23.5% | 42.8% | 33.6% |
| 8 | ace | 14.4% | 41.8% | 43.8% |
| 16 | rusty | 29.9% | 36.9% | 33.2% |
| 16 | scratch | 9.0% | 28.2% | 62.8% |
| 16 | ace | 5.1% | 21.8% | 73.0% |

Championship source mix — Pro top six 28.2%, Pro event winner 11.0%, Pro pass-down 7.8%, Challenger top two 9.9%, elite bot 43.1%.

Field-size sensitivity — 20: Ace 81.5%, Rusty 58.3%, Ace median 7.5; 30: Ace 80.0%, Rusty 52.1%, Ace median 6.0; 50: Ace 78.7%, Rusty 45.2%, Ace median 6.0; 100: Ace 82.0%, Rusty 40.9%, Ace median 6.0; 500: Ace 86.0%, Rusty 48.3%, Ace median 6.0.

Human-ratio sensitivity — 25% humans: Ace 85.1%, Rusty 44.8%, Ace median 6.0; 50% humans: Ace 82.6%, Rusty 48.7%, Ace median 6.0; 80% humans: Ace 85.6%, Rusty 47.6%, Ace median 6.0.

Activity sensitivity — full: Ace 91.3%, Rusty 59.9%, Ace median 6.0; occasional: Ace 73.6%, Rusty 29.7%, Ace median 7.0; returning: Ace 87.5%, Rusty 50.3%, Ace median 6.0.

#### B 15% relegation protection · scaled

Median active seasons to Pro — Rusty 9.0, Scratch 8.0, Ace 7.0. New-player catch-up to 80% of established same-ability rating — Rusty 7.0, Scratch 9.0, Ace 9.0.

| Horizon | Ability | Local | Challenger | Pro |
|---:|---|---:|---:|---:|
| 4 | rusty | 69.2% | 26.7% | 4.1% |
| 4 | scratch | 49.1% | 39.5% | 11.4% |
| 4 | ace | 44.8% | 41.2% | 14.0% |
| 8 | rusty | 54.3% | 35.7% | 10.0% |
| 8 | scratch | 30.3% | 46.7% | 23.0% |
| 8 | ace | 21.9% | 46.3% | 31.8% |
| 16 | rusty | 35.2% | 38.6% | 26.2% |
| 16 | scratch | 13.2% | 31.2% | 55.6% |
| 16 | ace | 8.1% | 26.3% | 65.5% |

Championship source mix — Pro top six 26.1%, Pro event winner 10.5%, Pro pass-down 6.9%, Challenger top two 9.9%, elite bot 46.6%.

Field-size sensitivity — 20: Ace 74.1%, Rusty 44.4%, Ace median 8.0; 30: Ace 60.0%, Rusty 33.3%, Ace median 7.0; 50: Ace 62.7%, Rusty 36.9%, Ace median 7.0; 100: Ace 73.3%, Rusty 28.3%, Ace median 8.0; 500: Ace 74.7%, Rusty 33.7%, Ace median 7.0.

Human-ratio sensitivity — 25% humans: Ace 69.0%, Rusty 31.7%, Ace median 7.5; 50% humans: Ace 71.3%, Rusty 33.1%, Ace median 7.0; 80% humans: Ace 75.3%, Rusty 34.4%, Ace median 7.0.

Activity sensitivity — full: Ace 84.7%, Rusty 43.2%, Ace median 7.0; occasional: Ace 57.1%, Rusty 18.5%, Ace median 7.0; returning: Ace 74.7%, Rusty 36.9%, Ace median 7.0.

#### C 15% human cap 4 · scaled

Median active seasons to Pro — Rusty 9.0, Scratch 8.0, Ace 9.0. New-player catch-up to 80% of established same-ability rating — Rusty 7.0, Scratch 7.0, Ace 6.0.

| Horizon | Ability | Local | Challenger | Pro |
|---:|---|---:|---:|---:|
| 4 | rusty | 93.8% | 5.8% | 0.5% |
| 4 | scratch | 86.0% | 11.4% | 2.7% |
| 4 | ace | 84.6% | 11.0% | 4.3% |
| 8 | rusty | 90.6% | 7.0% | 2.3% |
| 8 | scratch | 81.0% | 14.3% | 4.7% |
| 8 | ace | 75.3% | 15.4% | 9.3% |
| 16 | rusty | 89.4% | 8.3% | 2.3% |
| 16 | scratch | 72.7% | 15.6% | 11.7% |
| 16 | ace | 66.2% | 19.3% | 14.5% |

Championship source mix — Pro top six 24.3%, Pro event winner 9.9%, Pro pass-down 6.3%, Challenger top two 9.9%, elite bot 49.6%.

Field-size sensitivity — 20: Ace 59.3%, Rusty 38.9%, Ace median 8.5; 30: Ace 55.6%, Rusty 18.8%, Ace median 9.0; 50: Ace 52.0%, Rusty 26.2%, Ace median 8.0; 100: Ace 50.7%, Rusty 10.1%, Ace median 9.0; 500: Ace 14.7%, Rusty 2.3%, Ace median 10.0.

Human-ratio sensitivity — 25% humans: Ace 33.3%, Rusty 14.8%, Ace median 8.5; 50% humans: Ace 28.1%, Rusty 7.3%, Ace median 9.0; 80% humans: Ace 20.9%, Rusty 4.6%, Ace median 9.0.

Activity sensitivity — full: Ace 36.4%, Rusty 11.9%, Ace median 9.0; occasional: Ace 16.2%, Rusty 2.8%, Ace median 8.5; returning: Ace 19.5%, Rusty 5.2%, Ace median 9.0.

#### C 15% human cap 8 · scaled

Median active seasons to Pro — Rusty 9.0, Scratch 8.0, Ace 9.0. New-player catch-up to 80% of established same-ability rating — Rusty 7.0, Scratch 7.0, Ace 7.0.

| Horizon | Ability | Local | Challenger | Pro |
|---:|---|---:|---:|---:|
| 4 | rusty | 90.0% | 8.9% | 1.2% |
| 4 | scratch | 78.7% | 17.3% | 4.1% |
| 4 | ace | 78.2% | 16.1% | 5.7% |
| 8 | rusty | 86.2% | 10.9% | 2.9% |
| 8 | scratch | 73.8% | 20.1% | 6.1% |
| 8 | ace | 64.3% | 22.1% | 13.6% |
| 16 | rusty | 84.5% | 12.7% | 2.8% |
| 16 | scratch | 63.3% | 20.6% | 16.1% |
| 16 | ace | 52.4% | 26.5% | 21.1% |

Championship source mix — Pro top six 24.9%, Pro event winner 10.2%, Pro pass-down 6.4%, Challenger top two 9.9%, elite bot 48.6%.

Field-size sensitivity — 20: Ace 59.3%, Rusty 38.9%, Ace median 8.5; 30: Ace 55.6%, Rusty 18.8%, Ace median 9.0; 50: Ace 53.3%, Rusty 26.2%, Ace median 7.0; 100: Ace 60.0%, Rusty 12.6%, Ace median 8.0; 500: Ace 28.9%, Rusty 4.7%, Ace median 9.0.

Human-ratio sensitivity — 25% humans: Ace 50.0%, Rusty 18.6%, Ace median 8.5; 50% humans: Ace 40.3%, Rusty 9.2%, Ace median 9.0; 80% humans: Ace 30.8%, Rusty 6.2%, Ace median 9.0.

Activity sensitivity — full: Ace 49.5%, Rusty 14.6%, Ace median 9.0; occasional: Ace 24.3%, Rusty 3.4%, Ace median 8.0; returning: Ace 33.3%, Rusty 8.2%, Ace median 8.0.

#### C 15% human cap 12 · scaled

Median active seasons to Pro — Rusty 9.0, Scratch 8.0, Ace 8.0. New-player catch-up to 80% of established same-ability rating — Rusty 7.0, Scratch 7.0, Ace 8.0.

| Horizon | Ability | Local | Challenger | Pro |
|---:|---|---:|---:|---:|
| 4 | rusty | 87.6% | 11.0% | 1.4% |
| 4 | scratch | 74.6% | 20.1% | 5.3% |
| 4 | ace | 72.7% | 20.1% | 7.2% |
| 8 | rusty | 83.5% | 13.0% | 3.5% |
| 8 | scratch | 66.9% | 25.8% | 7.4% |
| 8 | ace | 58.4% | 25.2% | 16.4% |
| 16 | rusty | 80.1% | 16.0% | 3.9% |
| 16 | scratch | 56.6% | 25.3% | 18.1% |
| 16 | ace | 44.5% | 31.3% | 24.3% |

Championship source mix — Pro top six 24.9%, Pro event winner 10.2%, Pro pass-down 6.4%, Challenger top two 9.9%, elite bot 48.6%.

Field-size sensitivity — 20: Ace 59.3%, Rusty 38.9%, Ace median 8.5; 30: Ace 55.6%, Rusty 18.8%, Ace median 9.0; 50: Ace 53.3%, Rusty 26.2%, Ace median 7.0; 100: Ace 63.3%, Rusty 15.1%, Ace median 8.0; 500: Ace 37.6%, Rusty 7.9%, Ace median 9.0.

Human-ratio sensitivity — 25% humans: Ace 56.5%, Rusty 22.4%, Ace median 8.0; 50% humans: Ace 49.0%, Rusty 11.8%, Ace median 9.0; 80% humans: Ace 36.4%, Rusty 8.5%, Ace median 8.0.

Activity sensitivity — full: Ace 56.3%, Rusty 16.7%, Ace median 9.0; occasional: Ace 28.7%, Rusty 5.3%, Ace median 8.0; returning: Ace 42.8%, Rusty 12.4%, Ace median 8.0.

#### C2 rolling-2 70/30 + sqrt human limit · scaled

Median active seasons to Pro — Rusty 10.0, Scratch 9.0, Ace 9.0. New-player catch-up to 80% of established same-ability rating — Rusty 7.0, Scratch 8.0, Ace 8.0.

| Horizon | Ability | Local | Challenger | Pro |
|---:|---|---:|---:|---:|
| 4 | rusty | 81.1% | 18.2% | 0.7% |
| 4 | scratch | 63.8% | 33.9% | 2.3% |
| 4 | ace | 59.0% | 36.0% | 5.0% |
| 8 | rusty | 74.1% | 22.7% | 3.3% |
| 8 | scratch | 53.2% | 35.5% | 11.3% |
| 8 | ace | 39.2% | 41.4% | 19.4% |
| 16 | rusty | 68.1% | 25.6% | 6.3% |
| 16 | scratch | 40.4% | 35.4% | 24.2% |
| 16 | ace | 27.7% | 37.1% | 35.2% |

Championship source mix — Pro top six 16.1%, Pro event winner 6.1%, Pro pass-down 4.6%, Challenger top two 9.9%, elite bot 63.3%.

Field-size sensitivity — 20: Ace 66.7%, Rusty 13.9%, Ace median 8.5; 30: Ace 60.0%, Rusty 20.8%, Ace median 7.0; 50: Ace 50.7%, Rusty 17.9%, Ace median 8.5; 100: Ace 58.7%, Rusty 12.6%, Ace median 8.0; 500: Ace 55.3%, Rusty 14.5%, Ace median 9.0.

Human-ratio sensitivity — 25% humans: Ace 59.5%, Rusty 13.7%, Ace median 8.0; 50% humans: Ace 54.5%, Rusty 15.1%, Ace median 8.0; 80% humans: Ace 55.7%, Rusty 14.8%, Ace median 9.0.

Activity sensitivity — full: Ace 69.7%, Rusty 20.5%, Ace median 9.0; occasional: Ace 34.8%, Rusty 5.9%, Ace median 8.5; returning: Ace 60.6%, Rusty 16.7%, Ace median 8.0.

#### C2 rolling-2 70/30 + 15%-cap-32 human limit · scaled

Median active seasons to Pro — Rusty 10.0, Scratch 9.0, Ace 9.0. New-player catch-up to 80% of established same-ability rating — Rusty 7.0, Scratch 8.0, Ace 9.0.

| Horizon | Ability | Local | Challenger | Pro |
|---:|---|---:|---:|---:|
| 4 | rusty | 83.1% | 16.3% | 0.6% |
| 4 | scratch | 66.0% | 31.9% | 2.1% |
| 4 | ace | 61.2% | 34.6% | 4.1% |
| 8 | rusty | 75.6% | 21.3% | 3.1% |
| 8 | scratch | 54.5% | 35.2% | 10.3% |
| 8 | ace | 40.4% | 41.6% | 18.0% |
| 16 | rusty | 66.8% | 26.3% | 6.9% |
| 16 | scratch | 40.1% | 35.7% | 24.2% |
| 16 | ace | 27.2% | 36.6% | 36.2% |

Championship source mix — Pro top six 15.9%, Pro event winner 6.0%, Pro pass-down 4.6%, Challenger top two 9.9%, elite bot 63.6%.

Field-size sensitivity — 20: Ace 66.7%, Rusty 13.9%, Ace median 9.5; 30: Ace 60.0%, Rusty 20.8%, Ace median 7.0; 50: Ace 50.7%, Rusty 19.0%, Ace median 9.0; 100: Ace 58.0%, Rusty 12.6%, Ace median 8.0; 500: Ace 56.2%, Rusty 14.6%, Ace median 9.0.

Human-ratio sensitivity — 25% humans: Ace 59.5%, Rusty 14.2%, Ace median 8.0; 50% humans: Ace 55.7%, Rusty 15.4%, Ace median 8.0; 80% humans: Ace 56.0%, Rusty 14.8%, Ace median 10.0.

Activity sensitivity — full: Ace 70.7%, Rusty 20.3%, Ace median 9.0; occasional: Ace 34.8%, Rusty 6.2%, Ace median 9.0; returning: Ace 61.3%, Rusty 17.3%, Ace median 8.0.

#### D2 rolling-2 65/35 + floor 55 + neutral prior · scaled

Median active seasons to Pro — Rusty 10.0, Scratch 9.0, Ace 9.0. New-player catch-up to 80% of established same-ability rating — Rusty 7.0, Scratch 7.0, Ace 8.0.

| Horizon | Ability | Local | Challenger | Pro |
|---:|---|---:|---:|---:|
| 4 | rusty | 80.9% | 17.6% | 1.4% |
| 4 | scratch | 65.7% | 31.1% | 3.1% |
| 4 | ace | 59.3% | 34.6% | 6.2% |
| 8 | rusty | 78.1% | 19.5% | 2.3% |
| 8 | scratch | 59.6% | 31.5% | 8.9% |
| 8 | ace | 45.8% | 37.1% | 17.1% |
| 16 | rusty | 75.2% | 20.7% | 4.1% |
| 16 | scratch | 51.9% | 32.2% | 15.9% |
| 16 | ace | 35.8% | 38.9% | 25.4% |

Championship source mix — Pro top six 15.0%, Pro event winner 6.0%, Pro pass-down 4.0%, Challenger top two 9.8%, elite bot 65.3%.

Field-size sensitivity — 20: Ace 59.3%, Rusty 13.9%, Ace median 9.0; 30: Ace 51.1%, Rusty 14.6%, Ace median 10.0; 50: Ace 52.0%, Rusty 13.1%, Ace median 9.0; 100: Ace 51.3%, Rusty 11.9%, Ace median 8.0; 500: Ace 52.7%, Rusty 13.3%, Ace median 9.0.

Human-ratio sensitivity — 25% humans: Ace 57.7%, Rusty 11.5%, Ace median 8.0; 50% humans: Ace 51.0%, Rusty 12.6%, Ace median 8.0; 80% humans: Ace 51.9%, Rusty 14.1%, Ace median 9.0.

Activity sensitivity — full: Ace 63.6%, Rusty 18.9%, Ace median 9.0; occasional: Ace 32.5%, Rusty 4.5%, Ace median 8.0; returning: Ace 59.9%, Rusty 15.0%, Ace median 7.0.

#### D2 rolling-2 67/33 + floor 55 + neutral prior · scaled

Median active seasons to Pro — Rusty 10.0, Scratch 9.0, Ace 9.0. New-player catch-up to 80% of established same-ability rating — Rusty 7.0, Scratch 7.0, Ace 8.0.

| Horizon | Ability | Local | Challenger | Pro |
|---:|---|---:|---:|---:|
| 4 | rusty | 80.3% | 18.4% | 1.3% |
| 4 | scratch | 65.3% | 31.9% | 2.9% |
| 4 | ace | 59.7% | 34.6% | 5.6% |
| 8 | rusty | 78.2% | 19.4% | 2.3% |
| 8 | scratch | 59.0% | 31.7% | 9.3% |
| 8 | ace | 45.3% | 37.5% | 17.2% |
| 16 | rusty | 75.2% | 20.9% | 4.0% |
| 16 | scratch | 48.2% | 33.9% | 17.9% |
| 16 | ace | 34.4% | 37.9% | 27.7% |

Championship source mix — Pro top six 15.0%, Pro event winner 6.0%, Pro pass-down 4.0%, Challenger top two 9.8%, elite bot 65.1%.

Field-size sensitivity — 20: Ace 44.4%, Rusty 16.7%, Ace median 9.0; 30: Ace 53.3%, Rusty 12.5%, Ace median 10.0; 50: Ace 46.7%, Rusty 13.1%, Ace median 9.0; 100: Ace 52.7%, Rusty 12.6%, Ace median 8.0; 500: Ace 52.4%, Rusty 13.5%, Ace median 8.5.

Human-ratio sensitivity — 25% humans: Ace 56.5%, Rusty 10.4%, Ace median 8.0; 50% humans: Ace 49.0%, Rusty 12.9%, Ace median 8.0; 80% humans: Ace 52.3%, Rusty 14.6%, Ace median 9.0.

Activity sensitivity — full: Ace 63.1%, Rusty 18.0%, Ace median 9.0; occasional: Ace 33.0%, Rusty 4.2%, Ace median 8.0; returning: Ace 57.6%, Rusty 17.3%, Ace median 7.0.

#### D2 rolling-2 67/33 + floor 55 + quarter carry · scaled

Median active seasons to Pro — Rusty 9.0, Scratch 8.0, Ace 7.0. New-player catch-up to 80% of established same-ability rating — Rusty 7.0, Scratch 8.0, Ace 8.0.

| Horizon | Ability | Local | Challenger | Pro |
|---:|---|---:|---:|---:|
| 4 | rusty | 79.4% | 17.6% | 3.0% |
| 4 | scratch | 63.9% | 29.6% | 6.5% |
| 4 | ace | 58.1% | 30.6% | 11.3% |
| 8 | rusty | 75.8% | 20.0% | 4.2% |
| 8 | scratch | 55.4% | 31.9% | 12.7% |
| 8 | ace | 41.5% | 36.0% | 22.5% |
| 16 | rusty | 71.8% | 21.5% | 6.7% |
| 16 | scratch | 44.2% | 33.2% | 22.5% |
| 16 | ace | 30.1% | 36.6% | 33.2% |

Championship source mix — Pro top six 23.6%, Pro event winner 10.0%, Pro pass-down 5.7%, Challenger top two 9.7%, elite bot 50.9%.

Field-size sensitivity — 20: Ace 55.6%, Rusty 22.2%, Ace median 8.0; 30: Ace 64.4%, Rusty 18.8%, Ace median 9.0; 50: Ace 56.0%, Rusty 23.8%, Ace median 8.0; 100: Ace 60.7%, Rusty 17.0%, Ace median 7.0; 500: Ace 63.4%, Rusty 21.9%, Ace median 8.0.

Human-ratio sensitivity — 25% humans: Ace 60.7%, Rusty 16.9%, Ace median 7.0; 50% humans: Ace 60.3%, Rusty 18.8%, Ace median 7.0; 80% humans: Ace 64.1%, Rusty 24.2%, Ace median 8.0.

Activity sensitivity — full: Ace 73.7%, Rusty 28.4%, Ace median 8.0; occasional: Ace 42.9%, Rusty 10.4%, Ace median 7.0; returning: Ace 68.7%, Rusty 23.5%, Ace median 7.0.

#### D2 rolling-2 66/34 + floor 58 + quarter carry · scaled

Median active seasons to Pro — Rusty 9.0, Scratch 9.0, Ace 8.0. New-player catch-up to 80% of established same-ability rating — Rusty 7.0, Scratch 7.0, Ace 8.0.

| Horizon | Ability | Local | Challenger | Pro |
|---:|---|---:|---:|---:|
| 4 | rusty | 80.8% | 17.1% | 2.2% |
| 4 | scratch | 65.9% | 29.3% | 4.8% |
| 4 | ace | 60.9% | 30.8% | 8.3% |
| 8 | rusty | 78.9% | 18.2% | 3.0% |
| 8 | scratch | 58.1% | 31.9% | 10.1% |
| 8 | ace | 44.9% | 36.2% | 18.8% |
| 16 | rusty | 75.3% | 20.7% | 4.0% |
| 16 | scratch | 49.6% | 31.3% | 19.1% |
| 16 | ace | 33.3% | 37.8% | 28.8% |

Championship source mix — Pro top six 21.0%, Pro event winner 8.9%, Pro pass-down 5.1%, Challenger top two 9.8%, elite bot 55.1%.

Field-size sensitivity — 20: Ace 51.9%, Rusty 5.6%, Ace median 7.5; 30: Ace 51.1%, Rusty 16.7%, Ace median 9.0; 50: Ace 46.7%, Rusty 13.1%, Ace median 8.0; 100: Ace 55.3%, Rusty 12.6%, Ace median 8.0; 500: Ace 57.3%, Rusty 16.7%, Ace median 8.0.

Human-ratio sensitivity — 25% humans: Ace 57.7%, Rusty 13.1%, Ace median 8.0; 50% humans: Ace 52.2%, Rusty 12.6%, Ace median 8.0; 80% humans: Ace 57.7%, Rusty 18.0%, Ace median 8.0.

Activity sensitivity — full: Ace 65.7%, Rusty 22.1%, Ace median 9.0; occasional: Ace 37.4%, Rusty 5.0%, Ace median 7.0; returning: Ace 63.3%, Rusty 18.0%, Ace median 7.0.

#### D2 rolling-2 65/35 + floor 60 + quarter carry · scaled

Median active seasons to Pro — Rusty 10.0, Scratch 9.0, Ace 9.0. New-player catch-up to 80% of established same-ability rating — Rusty 7.0, Scratch 7.0, Ace 8.0.

| Horizon | Ability | Local | Challenger | Pro |
|---:|---|---:|---:|---:|
| 4 | rusty | 82.4% | 16.3% | 1.4% |
| 4 | scratch | 68.5% | 28.6% | 2.9% |
| 4 | ace | 62.1% | 32.0% | 5.9% |
| 8 | rusty | 80.6% | 16.5% | 2.9% |
| 8 | scratch | 61.1% | 30.6% | 8.3% |
| 8 | ace | 49.1% | 34.9% | 16.0% |
| 16 | rusty | 77.2% | 19.2% | 3.6% |
| 16 | scratch | 53.1% | 30.5% | 16.4% |
| 16 | ace | 38.2% | 38.0% | 23.8% |

Championship source mix — Pro top six 18.3%, Pro event winner 7.6%, Pro pass-down 4.6%, Challenger top two 9.7%, elite bot 59.8%.

Field-size sensitivity — 20: Ace 44.4%, Rusty 11.1%, Ace median 8.0; 30: Ace 51.1%, Rusty 10.4%, Ace median 9.0; 50: Ace 42.7%, Rusty 9.5%, Ace median 9.0; 100: Ace 46.0%, Rusty 11.9%, Ace median 8.0; 500: Ace 49.0%, Rusty 12.1%, Ace median 9.0.

Human-ratio sensitivity — 25% humans: Ace 51.8%, Rusty 11.5%, Ace median 9.0; 50% humans: Ace 45.2%, Rusty 9.8%, Ace median 8.0; 80% humans: Ace 48.8%, Rusty 13.1%, Ace median 9.0.

Activity sensitivity — full: Ace 59.6%, Rusty 17.3%, Ace median 9.0; occasional: Ace 29.9%, Rusty 3.6%, Ace median 8.0; returning: Ace 52.9%, Rusty 13.1%, Ace median 8.0.

#### D3 rolling-2 67/33 + floor 55 + quarter carry + sqrt limit · scaled

Median active seasons to Pro — Rusty 9.0, Scratch 8.0, Ace 8.0. New-player catch-up to 80% of established same-ability rating — Rusty 7.0, Scratch 8.0, Ace 8.0.

| Horizon | Ability | Local | Challenger | Pro |
|---:|---|---:|---:|---:|
| 4 | rusty | 82.2% | 15.8% | 2.0% |
| 4 | scratch | 67.3% | 27.2% | 5.4% |
| 4 | ace | 61.7% | 28.5% | 9.8% |
| 8 | rusty | 77.1% | 19.0% | 4.0% |
| 8 | scratch | 57.0% | 31.0% | 12.0% |
| 8 | ace | 43.5% | 35.5% | 21.0% |
| 16 | rusty | 72.0% | 21.7% | 6.3% |
| 16 | scratch | 44.4% | 33.4% | 22.2% |
| 16 | ace | 31.3% | 36.1% | 32.6% |

Championship source mix — Pro top six 23.6%, Pro event winner 10.0%, Pro pass-down 5.7%, Challenger top two 9.7%, elite bot 50.9%.

Field-size sensitivity — 20: Ace 55.6%, Rusty 22.2%, Ace median 8.0; 30: Ace 64.4%, Rusty 18.8%, Ace median 9.0; 50: Ace 56.0%, Rusty 23.8%, Ace median 8.0; 100: Ace 60.7%, Rusty 17.0%, Ace median 7.0; 500: Ace 60.2%, Rusty 20.5%, Ace median 8.0.

Human-ratio sensitivity — 25% humans: Ace 60.1%, Rusty 16.9%, Ace median 7.0; 50% humans: Ace 59.1%, Rusty 18.5%, Ace median 7.0; 80% humans: Ace 60.5%, Rusty 22.4%, Ace median 8.0.

Activity sensitivity — full: Ace 72.3%, Rusty 27.5%, Ace median 8.0; occasional: Ace 40.9%, Rusty 10.4%, Ace median 7.0; returning: Ace 64.6%, Rusty 21.2%, Ace median 7.0.

#### D3 rolling-2 67/33 + floor 55 + quarter carry + 15%-cap-32 · scaled

Median active seasons to Pro — Rusty 9.0, Scratch 9.0, Ace 8.0. New-player catch-up to 80% of established same-ability rating — Rusty 7.0, Scratch 8.0, Ace 9.0.

| Horizon | Ability | Local | Challenger | Pro |
|---:|---|---:|---:|---:|
| 4 | rusty | 83.9% | 14.5% | 1.5% |
| 4 | scratch | 69.3% | 25.9% | 4.7% |
| 4 | ace | 62.7% | 30.1% | 7.1% |
| 8 | rusty | 77.2% | 19.1% | 3.7% |
| 8 | scratch | 56.8% | 32.9% | 10.3% |
| 8 | ace | 43.4% | 37.1% | 19.6% |
| 16 | rusty | 68.7% | 23.8% | 7.5% |
| 16 | scratch | 41.0% | 36.6% | 22.4% |
| 16 | ace | 27.8% | 37.0% | 35.2% |

Championship source mix — Pro top six 23.6%, Pro event winner 10.0%, Pro pass-down 5.7%, Challenger top two 9.7%, elite bot 50.9%.

Field-size sensitivity — 20: Ace 55.6%, Rusty 22.2%, Ace median 8.0; 30: Ace 64.4%, Rusty 20.8%, Ace median 8.0; 50: Ace 58.7%, Rusty 23.8%, Ace median 9.0; 100: Ace 59.3%, Rusty 17.0%, Ace median 7.0; 500: Ace 60.4%, Rusty 19.6%, Ace median 8.0.

Human-ratio sensitivity — 25% humans: Ace 61.3%, Rusty 17.5%, Ace median 8.0; 50% humans: Ace 60.6%, Rusty 19.0%, Ace median 8.0; 80% humans: Ace 59.6%, Rusty 20.8%, Ace median 9.0.

Activity sensitivity — full: Ace 73.0%, Rusty 26.8%, Ace median 9.0; occasional: Ace 40.0%, Rusty 12.0%, Ace median 8.0; returning: Ace 65.3%, Rusty 18.3%, Ace median 8.0.

#### E moderate signal + D2 66/34 floor 58 quarter carry · scaled

Median active seasons to Pro — Rusty 10.0, Scratch 9.0, Ace 8.0. New-player catch-up to 80% of established same-ability rating — Rusty 7.0, Scratch 7.0, Ace 8.0.

| Horizon | Ability | Local | Challenger | Pro |
|---:|---|---:|---:|---:|
| 4 | rusty | 85.5% | 13.8% | 0.7% |
| 4 | scratch | 62.6% | 31.8% | 5.6% |
| 4 | ace | 54.5% | 35.8% | 9.7% |
| 8 | rusty | 84.7% | 13.4% | 1.9% |
| 8 | scratch | 54.2% | 34.1% | 11.7% |
| 8 | ace | 40.7% | 38.3% | 21.0% |
| 16 | rusty | 81.2% | 16.7% | 2.1% |
| 16 | scratch | 45.2% | 32.5% | 22.3% |
| 16 | ace | 29.8% | 38.7% | 31.6% |

Championship source mix — Pro top six 22.2%, Pro event winner 9.4%, Pro pass-down 5.4%, Challenger top two 9.7%, elite bot 53.3%.

Field-size sensitivity — 20: Ace 66.7%, Rusty 2.8%, Ace median 7.5; 30: Ace 62.2%, Rusty 6.3%, Ace median 8.0; 50: Ace 57.3%, Rusty 8.3%, Ace median 7.0; 100: Ace 59.3%, Rusty 6.9%, Ace median 7.0; 500: Ace 61.6%, Rusty 9.4%, Ace median 8.0.

Human-ratio sensitivity — 25% humans: Ace 62.5%, Rusty 8.2%, Ace median 7.0; 50% humans: Ace 59.1%, Rusty 7.3%, Ace median 7.0; 80% humans: Ace 62.0%, Rusty 9.5%, Ace median 8.0.

Activity sensitivity — full: Ace 72.1%, Rusty 12.2%, Ace median 9.0; occasional: Ace 42.3%, Rusty 4.2%, Ace median 7.0; returning: Ace 67.3%, Rusty 8.5%, Ace median 7.0.

#### E wide signal + D2 66/34 floor 58 quarter carry · scaled

Median active seasons to Pro — Rusty 9.5, Scratch 9.0, Ace 8.0. New-player catch-up to 80% of established same-ability rating — Rusty 7.0, Scratch 7.0, Ace 8.0.

| Horizon | Ability | Local | Challenger | Pro |
|---:|---|---:|---:|---:|
| 4 | rusty | 87.4% | 11.8% | 0.7% |
| 4 | scratch | 60.3% | 34.3% | 5.4% |
| 4 | ace | 52.6% | 36.5% | 10.9% |
| 8 | rusty | 85.3% | 13.6% | 1.1% |
| 8 | scratch | 51.9% | 35.5% | 12.7% |
| 8 | ace | 38.8% | 40.4% | 20.9% |
| 16 | rusty | 85.0% | 13.7% | 1.3% |
| 16 | scratch | 41.9% | 35.3% | 22.8% |
| 16 | ace | 28.9% | 39.3% | 31.7% |

Championship source mix — Pro top six 23.1%, Pro event winner 9.8%, Pro pass-down 5.7%, Challenger top two 9.7%, elite bot 51.7%.

Field-size sensitivity — 20: Ace 66.7%, Rusty 13.9%, Ace median 8.0; 30: Ace 62.2%, Rusty 4.2%, Ace median 7.0; 50: Ace 61.3%, Rusty 3.6%, Ace median 7.5; 100: Ace 61.3%, Rusty 2.5%, Ace median 7.0; 500: Ace 61.9%, Rusty 6.2%, Ace median 8.0.

Human-ratio sensitivity — 25% humans: Ace 60.1%, Rusty 6.6%, Ace median 7.0; 50% humans: Ace 59.7%, Rusty 4.2%, Ace median 7.0; 80% humans: Ace 63.8%, Rusty 6.2%, Ace median 8.0.

Activity sensitivity — full: Ace 73.5%, Rusty 7.9%, Ace median 9.0; occasional: Ace 42.3%, Rusty 2.8%, Ace median 7.0; returning: Ace 68.0%, Rusty 5.6%, Ace median 7.0.

#### E moderate signal + D3 adaptive · uniform

Median active seasons to Pro — Rusty 11.0, Scratch 9.0, Ace 8.0. New-player catch-up to 80% of established same-ability rating — Rusty 7.0, Scratch 8.0, Ace 9.0.

| Horizon | Ability | Local | Challenger | Pro |
|---:|---|---:|---:|---:|
| 4 | rusty | 89.4% | 10.1% | 0.5% |
| 4 | scratch | 68.5% | 27.2% | 4.2% |
| 4 | ace | 61.7% | 30.1% | 8.1% |
| 8 | rusty | 86.7% | 11.6% | 1.7% |
| 8 | scratch | 55.1% | 32.1% | 12.7% |
| 8 | ace | 44.5% | 35.3% | 20.2% |
| 16 | rusty | 82.3% | 14.6% | 3.1% |
| 16 | scratch | 39.8% | 33.1% | 27.1% |
| 16 | ace | 26.8% | 34.1% | 39.1% |

Championship source mix — Pro top six 22.8%, Pro event winner 9.0%, Pro pass-down 6.2%, Challenger top two 9.6%, elite bot 52.5%.

Field-size sensitivity — 20: Ace 63.0%, Rusty 2.8%, Ace median 8.0; 30: Ace 64.4%, Rusty 10.4%, Ace median 7.0; 50: Ace 53.3%, Rusty 7.1%, Ace median 7.0; 100: Ace 62.0%, Rusty 8.8%, Ace median 7.0; 500: Ace 60.2%, Rusty 8.6%, Ace median 9.0.

Human-ratio sensitivity — 25% humans: Ace 61.3%, Rusty 7.1%, Ace median 8.0; 50% humans: Ace 58.6%, Rusty 7.0%, Ace median 8.0; 80% humans: Ace 60.9%, Rusty 9.7%, Ace median 9.0.

Activity sensitivity — full: Ace 71.8%, Rusty 11.9%, Ace median 9.0; occasional: Ace 42.0%, Rusty 3.6%, Ace median 8.0; returning: Ace 64.6%, Rusty 8.8%, Ace median 8.0.

#### E moderate signal + D3 adaptive · scaled

Median active seasons to Pro — Rusty 10.0, Scratch 9.0, Ace 8.0. New-player catch-up to 80% of established same-ability rating — Rusty 7.0, Scratch 8.0, Ace 8.0.

| Horizon | Ability | Local | Challenger | Pro |
|---:|---|---:|---:|---:|
| 4 | rusty | 88.5% | 11.1% | 0.4% |
| 4 | scratch | 67.2% | 28.7% | 4.1% |
| 4 | ace | 60.0% | 32.6% | 7.4% |
| 8 | rusty | 84.6% | 14.1% | 1.4% |
| 8 | scratch | 55.4% | 34.1% | 10.5% |
| 8 | ace | 42.4% | 38.4% | 19.2% |
| 16 | rusty | 79.2% | 18.4% | 2.3% |
| 16 | scratch | 39.2% | 37.4% | 23.4% |
| 16 | ace | 26.0% | 39.8% | 34.2% |

Championship source mix — Pro top six 22.2%, Pro event winner 9.3%, Pro pass-down 5.4%, Challenger top two 9.7%, elite bot 53.3%.

Field-size sensitivity — 20: Ace 66.7%, Rusty 2.8%, Ace median 7.5; 30: Ace 64.4%, Rusty 6.3%, Ace median 8.0; 50: Ace 58.7%, Rusty 7.1%, Ace median 7.5; 100: Ace 58.7%, Rusty 6.3%, Ace median 7.5; 500: Ace 59.7%, Rusty 9.0%, Ace median 9.0.

Human-ratio sensitivity — 25% humans: Ace 62.5%, Rusty 6.6%, Ace median 8.0; 50% humans: Ace 59.1%, Rusty 7.3%, Ace median 8.0; 80% humans: Ace 59.5%, Rusty 9.2%, Ace median 9.0.

Activity sensitivity — full: Ace 73.2%, Rusty 11.9%, Ace median 9.0; occasional: Ace 40.3%, Rusty 4.5%, Ace median 8.0; returning: Ace 63.3%, Rusty 6.9%, Ace median 7.0.

#### F moderate signal 64/36 floor 55 quarter carry + 20%-cap-40 · scaled

Median active seasons to Pro — Rusty 9.0, Scratch 8.0, Ace 7.0. New-player catch-up to 80% of established same-ability rating — Rusty 7.0, Scratch 8.0, Ace 8.0.

| Horizon | Ability | Local | Challenger | Pro |
|---:|---|---:|---:|---:|
| 4 | rusty | 86.4% | 12.7% | 0.8% |
| 4 | scratch | 63.6% | 30.0% | 6.4% |
| 4 | ace | 56.9% | 30.3% | 12.7% |
| 8 | rusty | 82.4% | 15.3% | 2.3% |
| 8 | scratch | 52.0% | 33.1% | 14.9% |
| 8 | ace | 39.0% | 36.9% | 24.2% |
| 16 | rusty | 78.0% | 18.6% | 3.4% |
| 16 | scratch | 39.5% | 36.0% | 24.5% |
| 16 | ace | 27.3% | 37.5% | 35.1% |

Championship source mix — Pro top six 25.9%, Pro event winner 10.4%, Pro pass-down 6.9%, Challenger top two 9.8%, elite bot 47.0%.

Field-size sensitivity — 20: Ace 81.5%, Rusty 19.4%, Ace median 7.0; 30: Ace 66.7%, Rusty 12.5%, Ace median 7.0; 50: Ace 70.7%, Rusty 15.5%, Ace median 8.0; 100: Ace 67.3%, Rusty 10.7%, Ace median 7.0; 500: Ace 66.5%, Rusty 15.5%, Ace median 8.0.

Human-ratio sensitivity — 25% humans: Ace 67.9%, Rusty 12.6%, Ace median 7.0; 50% humans: Ace 67.5%, Rusty 12.6%, Ace median 7.0; 80% humans: Ace 67.0%, Rusty 16.9%, Ace median 8.0.

Activity sensitivity — full: Ace 79.8%, Rusty 19.4%, Ace median 8.0; occasional: Ace 46.7%, Rusty 9.0%, Ace median 7.0; returning: Ace 73.4%, Rusty 15.0%, Ace median 7.0.

#### F wide signal 65/35 floor 55 quarter carry + 20%-cap-40 · scaled

Median active seasons to Pro — Rusty 10.0, Scratch 8.0, Ace 7.0. New-player catch-up to 80% of established same-ability rating — Rusty 7.0, Scratch 8.0, Ace 8.0.

| Horizon | Ability | Local | Challenger | Pro |
|---:|---|---:|---:|---:|
| 4 | rusty | 88.3% | 10.8% | 0.8% |
| 4 | scratch | 62.3% | 31.3% | 6.4% |
| 4 | ace | 54.1% | 33.1% | 12.7% |
| 8 | rusty | 83.7% | 14.4% | 1.9% |
| 8 | scratch | 50.0% | 35.1% | 15.0% |
| 8 | ace | 36.5% | 38.1% | 25.4% |
| 16 | rusty | 82.0% | 16.2% | 1.8% |
| 16 | scratch | 36.0% | 37.0% | 27.0% |
| 16 | ace | 25.9% | 39.0% | 35.1% |

Championship source mix — Pro top six 25.6%, Pro event winner 10.3%, Pro pass-down 6.8%, Challenger top two 9.8%, elite bot 47.5%.

Field-size sensitivity — 20: Ace 77.8%, Rusty 22.2%, Ace median 7.0; 30: Ace 73.3%, Rusty 2.1%, Ace median 7.0; 50: Ace 68.0%, Rusty 8.3%, Ace median 7.0; 100: Ace 66.7%, Rusty 4.4%, Ace median 7.0; 500: Ace 68.5%, Rusty 11.2%, Ace median 8.0.

Human-ratio sensitivity — 25% humans: Ace 70.2%, Rusty 9.8%, Ace median 7.0; 50% humans: Ace 67.0%, Rusty 7.6%, Ace median 7.0; 80% humans: Ace 69.2%, Rusty 11.5%, Ace median 8.0.

Activity sensitivity — full: Ace 81.0%, Rusty 12.8%, Ace median 8.0; occasional: Ace 49.3%, Rusty 6.7%, Ace median 8.0; returning: Ace 73.4%, Rusty 9.5%, Ace median 7.0.

#### F wide signal 64/36 floor 55 quarter carry + 20%-cap-40 · scaled

Median active seasons to Pro — Rusty 10.0, Scratch 8.0, Ace 7.0. New-player catch-up to 80% of established same-ability rating — Rusty 7.0, Scratch 8.0, Ace 8.0.

| Horizon | Ability | Local | Challenger | Pro |
|---:|---|---:|---:|---:|
| 4 | rusty | 88.7% | 10.4% | 0.9% |
| 4 | scratch | 62.4% | 30.9% | 6.6% |
| 4 | ace | 54.0% | 33.1% | 12.9% |
| 8 | rusty | 84.0% | 14.0% | 2.0% |
| 8 | scratch | 50.5% | 34.0% | 15.5% |
| 8 | ace | 36.9% | 37.4% | 25.7% |
| 16 | rusty | 82.2% | 15.5% | 2.3% |
| 16 | scratch | 37.3% | 36.1% | 26.6% |
| 16 | ace | 25.5% | 39.3% | 35.2% |

Championship source mix — Pro top six 25.8%, Pro event winner 10.3%, Pro pass-down 6.9%, Challenger top two 9.8%, elite bot 47.2%.

Field-size sensitivity — 20: Ace 77.8%, Rusty 22.2%, Ace median 7.0; 30: Ace 75.6%, Rusty 2.1%, Ace median 7.5; 50: Ace 68.0%, Rusty 10.7%, Ace median 7.0; 100: Ace 67.3%, Rusty 5.0%, Ace median 7.0; 500: Ace 69.9%, Rusty 12.2%, Ace median 8.0.

Human-ratio sensitivity — 25% humans: Ace 72.6%, Rusty 9.8%, Ace median 7.0; 50% humans: Ace 68.1%, Rusty 8.4%, Ace median 7.0; 80% humans: Ace 70.1%, Rusty 12.9%, Ace median 8.0.

Activity sensitivity — full: Ace 83.6%, Rusty 13.7%, Ace median 8.0; occasional: Ace 48.4%, Rusty 7.0%, Ace median 7.0; returning: Ace 75.1%, Rusty 11.4%, Ace median 7.0.

#### F2 moderate signal 64/32 floor 55 quarter carry + 20%-cap-40 · scaled

Median active seasons to Pro — Rusty 9.0, Scratch 8.0, Ace 7.0. New-player catch-up to 80% of established same-ability rating — Rusty 7.0, Scratch 8.0, Ace 8.0.

| Horizon | Ability | Local | Challenger | Pro |
|---:|---|---:|---:|---:|
| 4 | rusty | 85.6% | 13.5% | 0.9% |
| 4 | scratch | 61.2% | 32.0% | 6.7% |
| 4 | ace | 55.3% | 31.7% | 12.9% |
| 8 | rusty | 80.1% | 17.2% | 2.7% |
| 8 | scratch | 49.5% | 33.8% | 16.7% |
| 8 | ace | 36.2% | 37.7% | 26.0% |
| 16 | rusty | 75.5% | 19.5% | 5.0% |
| 16 | scratch | 34.7% | 37.1% | 28.2% |
| 16 | ace | 23.5% | 37.9% | 38.6% |

Championship source mix — Pro top six 26.3%, Pro event winner 10.5%, Pro pass-down 7.0%, Challenger top two 9.7%, elite bot 46.5%.

Field-size sensitivity — 20: Ace 88.9%, Rusty 19.4%, Ace median 7.0; 30: Ace 64.4%, Rusty 12.5%, Ace median 7.0; 50: Ace 70.7%, Rusty 14.3%, Ace median 7.0; 100: Ace 68.7%, Rusty 13.2%, Ace median 7.0; 500: Ace 67.8%, Rusty 16.4%, Ace median 8.0.

Human-ratio sensitivity — 25% humans: Ace 70.8%, Rusty 14.2%, Ace median 7.0; 50% humans: Ace 68.7%, Rusty 12.9%, Ace median 7.0; 80% humans: Ace 67.7%, Rusty 18.0%, Ace median 8.0.

Activity sensitivity — full: Ace 80.8%, Rusty 20.3%, Ace median 8.0; occasional: Ace 47.5%, Rusty 9.8%, Ace median 7.0; returning: Ace 75.4%, Rusty 16.0%, Ace median 7.0.

#### F2 wide signal 64/32 floor 55 quarter carry + 20%-cap-40 · scaled

Median active seasons to Pro — Rusty 10.0, Scratch 8.0, Ace 7.0. New-player catch-up to 80% of established same-ability rating — Rusty 7.0, Scratch 8.0, Ace 9.0.

| Horizon | Ability | Local | Challenger | Pro |
|---:|---|---:|---:|---:|
| 4 | rusty | 87.5% | 11.5% | 1.0% |
| 4 | scratch | 59.6% | 33.4% | 6.9% |
| 4 | ace | 52.5% | 34.2% | 13.3% |
| 8 | rusty | 81.7% | 16.1% | 2.3% |
| 8 | scratch | 47.8% | 34.9% | 17.3% |
| 8 | ace | 34.1% | 39.3% | 26.6% |
| 16 | rusty | 79.5% | 17.9% | 2.6% |
| 16 | scratch | 33.8% | 37.4% | 28.8% |
| 16 | ace | 21.6% | 38.4% | 40.0% |

Championship source mix — Pro top six 26.0%, Pro event winner 10.4%, Pro pass-down 6.9%, Challenger top two 9.8%, elite bot 46.9%.

Field-size sensitivity — 20: Ace 81.5%, Rusty 19.4%, Ace median 7.0; 30: Ace 80.0%, Rusty 2.1%, Ace median 7.0; 50: Ace 68.0%, Rusty 10.7%, Ace median 7.0; 100: Ace 70.0%, Rusty 6.9%, Ace median 7.0; 500: Ace 70.7%, Rusty 12.2%, Ace median 8.0.

Human-ratio sensitivity — 25% humans: Ace 72.0%, Rusty 10.4%, Ace median 7.0; 50% humans: Ace 69.9%, Rusty 9.0%, Ace median 7.0; 80% humans: Ace 71.5%, Rusty 12.7%, Ace median 8.0.

Activity sensitivity — full: Ace 83.6%, Rusty 14.0%, Ace median 8.0; occasional: Ace 50.7%, Rusty 7.3%, Ace median 7.0; returning: Ace 76.8%, Rusty 11.4%, Ace median 7.0.

#### F3 moderate signal 65/32 floor 55 quarter carry + 20%-cap-40 · scaled

Median active seasons to Pro — Rusty 9.0, Scratch 8.0, Ace 7.0. New-player catch-up to 80% of established same-ability rating — Rusty 7.0, Scratch 8.0, Ace 8.0.

| Horizon | Ability | Local | Challenger | Pro |
|---:|---|---:|---:|---:|
| 4 | rusty | 85.7% | 13.4% | 0.9% |
| 4 | scratch | 61.7% | 31.9% | 6.5% |
| 4 | ace | 55.5% | 32.1% | 12.4% |
| 8 | rusty | 81.0% | 16.3% | 2.7% |
| 8 | scratch | 49.8% | 33.6% | 16.6% |
| 8 | ace | 36.4% | 38.1% | 25.5% |
| 16 | rusty | 75.2% | 19.9% | 5.0% |
| 16 | scratch | 35.5% | 36.8% | 27.6% |
| 16 | ace | 23.8% | 38.1% | 38.1% |

Championship source mix — Pro top six 25.7%, Pro event winner 10.4%, Pro pass-down 6.8%, Challenger top two 9.7%, elite bot 47.4%.

Field-size sensitivity — 20: Ace 85.2%, Rusty 11.1%, Ace median 7.0; 30: Ace 64.4%, Rusty 10.4%, Ace median 7.0; 50: Ace 69.3%, Rusty 14.3%, Ace median 7.0; 100: Ace 67.3%, Rusty 11.9%, Ace median 7.0; 500: Ace 67.1%, Rusty 16.0%, Ace median 8.0.

Human-ratio sensitivity — 25% humans: Ace 69.0%, Rusty 13.1%, Ace median 7.0; 50% humans: Ace 68.1%, Rusty 12.6%, Ace median 7.0; 80% humans: Ace 66.8%, Rusty 16.9%, Ace median 8.0.

Activity sensitivity — full: Ace 80.5%, Rusty 19.1%, Ace median 8.0; occasional: Ace 46.4%, Rusty 9.5%, Ace median 7.0; returning: Ace 73.7%, Rusty 15.0%, Ace median 7.0.

#### F3 wide signal 65/32 floor 55 quarter carry + 20%-cap-40 · scaled

Median active seasons to Pro — Rusty 10.0, Scratch 8.0, Ace 7.0. New-player catch-up to 80% of established same-ability rating — Rusty 7.0, Scratch 8.0, Ace 9.0.

| Horizon | Ability | Local | Challenger | Pro |
|---:|---|---:|---:|---:|
| 4 | rusty | 87.5% | 11.6% | 0.9% |
| 4 | scratch | 60.0% | 33.5% | 6.5% |
| 4 | ace | 52.7% | 34.4% | 12.9% |
| 8 | rusty | 82.1% | 15.8% | 2.1% |
| 8 | scratch | 48.4% | 35.5% | 16.1% |
| 8 | ace | 34.1% | 40.0% | 25.9% |
| 16 | rusty | 80.6% | 17.1% | 2.3% |
| 16 | scratch | 33.4% | 37.7% | 28.9% |
| 16 | ace | 22.0% | 39.2% | 38.8% |

Championship source mix — Pro top six 25.9%, Pro event winner 10.3%, Pro pass-down 6.9%, Challenger top two 9.8%, elite bot 47.0%.

Field-size sensitivity — 20: Ace 85.2%, Rusty 19.4%, Ace median 7.0; 30: Ace 77.8%, Rusty 2.1%, Ace median 7.0; 50: Ace 68.0%, Rusty 9.5%, Ace median 7.0; 100: Ace 69.3%, Rusty 6.3%, Ace median 7.0; 500: Ace 69.4%, Rusty 11.7%, Ace median 8.0.

Human-ratio sensitivity — 25% humans: Ace 70.2%, Rusty 9.8%, Ace median 7.0; 50% humans: Ace 69.0%, Rusty 8.7%, Ace median 7.0; 80% humans: Ace 70.6%, Rusty 12.0%, Ace median 8.0.

Activity sensitivity — full: Ace 83.3%, Rusty 13.3%, Ace median 8.0; occasional: Ace 49.6%, Rusty 7.0%, Ace median 7.0; returning: Ace 74.7%, Rusty 10.8%, Ace median 7.0.

#### G wide signal 66/32 floor 55 quarter carry + 20%-cap-40 · scaled

Median active seasons to Pro — Rusty 10.0, Scratch 8.0, Ace 7.0. New-player catch-up to 80% of established same-ability rating — Rusty 7.0, Scratch 8.0, Ace 9.0.

| Horizon | Ability | Local | Challenger | Pro |
|---:|---|---:|---:|---:|
| 4 | rusty | 87.7% | 11.6% | 0.7% |
| 4 | scratch | 60.2% | 33.4% | 6.4% |
| 4 | ace | 53.5% | 34.0% | 12.5% |
| 8 | rusty | 82.6% | 15.4% | 2.1% |
| 8 | scratch | 48.7% | 36.0% | 15.3% |
| 8 | ace | 34.6% | 40.2% | 25.3% |
| 16 | rusty | 81.2% | 16.5% | 2.3% |
| 16 | scratch | 34.3% | 37.8% | 28.0% |
| 16 | ace | 22.6% | 39.0% | 38.4% |

Championship source mix — Pro top six 25.7%, Pro event winner 10.3%, Pro pass-down 6.9%, Challenger top two 9.8%, elite bot 47.3%.

Field-size sensitivity — 20: Ace 81.5%, Rusty 16.7%, Ace median 7.0; 30: Ace 75.6%, Rusty 2.1%, Ace median 7.0; 50: Ace 66.7%, Rusty 7.1%, Ace median 7.0; 100: Ace 68.0%, Rusty 5.7%, Ace median 7.0; 500: Ace 68.2%, Rusty 11.3%, Ace median 8.0.

Human-ratio sensitivity — 25% humans: Ace 69.0%, Rusty 8.7%, Ace median 7.0; 50% humans: Ace 68.1%, Rusty 8.4%, Ace median 7.0; 80% humans: Ace 69.0%, Rusty 11.3%, Ace median 8.0.

Activity sensitivity — full: Ace 81.5%, Rusty 12.6%, Ace median 8.0; occasional: Ace 48.1%, Rusty 6.4%, Ace median 8.0; returning: Ace 74.4%, Rusty 10.1%, Ace median 7.0.

#### H wide signal 65/32 floor 58 quarter carry + 20%-cap-40 · scaled

Median active seasons to Pro — Rusty 10.0, Scratch 9.0, Ace 8.0. New-player catch-up to 80% of established same-ability rating — Rusty 7.0, Scratch 8.0, Ace 8.0.

| Horizon | Ability | Local | Challenger | Pro |
|---:|---|---:|---:|---:|
| 4 | rusty | 88.0% | 11.2% | 0.8% |
| 4 | scratch | 61.3% | 34.2% | 4.5% |
| 4 | ace | 54.0% | 36.5% | 9.5% |
| 8 | rusty | 84.2% | 14.8% | 1.0% |
| 8 | scratch | 51.4% | 35.6% | 12.9% |
| 8 | ace | 37.1% | 41.8% | 21.2% |
| 16 | rusty | 82.3% | 15.8% | 1.9% |
| 16 | scratch | 36.5% | 36.0% | 27.5% |
| 16 | ace | 26.0% | 39.3% | 34.6% |

Championship source mix — Pro top six 23.3%, Pro event winner 9.8%, Pro pass-down 5.7%, Challenger top two 9.7%, elite bot 51.4%.

Field-size sensitivity — 20: Ace 66.7%, Rusty 11.1%, Ace median 7.5; 30: Ace 64.4%, Rusty 2.1%, Ace median 7.0; 50: Ace 62.7%, Rusty 3.6%, Ace median 8.0; 100: Ace 62.7%, Rusty 3.8%, Ace median 8.0; 500: Ace 63.0%, Rusty 6.8%, Ace median 8.0.

Human-ratio sensitivity — 25% humans: Ace 63.1%, Rusty 6.0%, Ace median 8.0; 50% humans: Ace 61.7%, Rusty 4.5%, Ace median 7.0; 80% humans: Ace 64.0%, Rusty 7.1%, Ace median 8.0.

Activity sensitivity — full: Ace 73.9%, Rusty 8.6%, Ace median 9.0; occasional: Ace 44.6%, Rusty 2.5%, Ace median 8.0; returning: Ace 69.0%, Rusty 6.5%, Ace median 7.0.

#### D rolling-2 70/30 + human cap 20 · scaled

Median active seasons to Pro — Rusty 10.0, Scratch 9.0, Ace 9.0. New-player catch-up to 80% of established same-ability rating — Rusty 7.0, Scratch 7.0, Ace 8.0.

| Horizon | Ability | Local | Challenger | Pro |
|---:|---|---:|---:|---:|
| 4 | rusty | 85.9% | 13.5% | 0.6% |
| 4 | scratch | 70.6% | 27.4% | 1.9% |
| 4 | ace | 67.3% | 29.4% | 3.3% |
| 8 | rusty | 79.3% | 18.2% | 2.5% |
| 8 | scratch | 59.1% | 31.4% | 9.5% |
| 8 | ace | 48.6% | 35.6% | 15.8% |
| 16 | rusty | 72.2% | 22.9% | 5.0% |
| 16 | scratch | 46.4% | 32.6% | 21.0% |
| 16 | ace | 33.1% | 35.2% | 31.6% |

Championship source mix — Pro top six 16.1%, Pro event winner 6.2%, Pro pass-down 4.6%, Challenger top two 9.9%, elite bot 63.3%.

Field-size sensitivity — 20: Ace 66.7%, Rusty 13.9%, Ace median 8.5; 30: Ace 60.0%, Rusty 20.8%, Ace median 7.0; 50: Ace 50.7%, Rusty 17.9%, Ace median 8.5; 100: Ace 58.7%, Rusty 12.6%, Ace median 8.0; 500: Ace 46.8%, Rusty 11.2%, Ace median 9.0.

Human-ratio sensitivity — 25% humans: Ace 59.5%, Rusty 13.7%, Ace median 8.0; 50% humans: Ace 51.6%, Rusty 15.1%, Ace median 9.0; 80% humans: Ace 45.8%, Rusty 10.2%, Ace median 10.0.

Activity sensitivity — full: Ace 63.6%, Rusty 17.6%, Ace median 9.0; occasional: Ace 29.9%, Rusty 5.0%, Ace median 9.0; returning: Ace 53.2%, Rusty 13.4%, Ace median 9.0.


### High-seed finalist validation

Each finalist is rerun independently at the 16-season horizon with 20 deterministic world seeds across every required field size and human ratio (300 worlds per finalist). This reduces the small-denominator noise visible in three-seed field-20 slices.

**G wide signal 66/32 floor 55 quarter carry + 20%-cap-40 · scaled (independent 20-seed validation)** — Ace 68.3%, Scratch 54.9%, Rusty 9.6%; Ace median 8.0; reversal 9.6%; oscillation 31.0%; Pro survival 90.7%; max human movement 41 promoted/27 relegated.

Field-size sensitivity — 20: Ace 73.9%, Rusty 14.2%, Ace median 8.0; 30: Ace 71.0%, Rusty 13.8%, Ace median 8.0; 50: Ace 68.4%, Rusty 10.5%, Ace median 7.0; 100: Ace 69.2%, Rusty 10.4%, Ace median 7.0; 500: Ace 67.8%, Rusty 8.9%, Ace median 8.0.

Human-ratio sensitivity — 25% humans: Ace 69.3%, Rusty 10.4%, Ace median 7.0; 50% humans: Ace 71.0%, Rusty 9.4%, Ace median 7.0; 80% humans: Ace 66.4%, Rusty 9.5%, Ace median 8.0.

Activity sensitivity — full: Ace 79.6%, Rusty 13.3%, Ace median 8.0; occasional: Ace 48.9%, Rusty 4.3%, Ace median 8.0; returning: Ace 74.7%, Rusty 10.4%, Ace median 7.0.

**H wide signal 65/32 floor 58 quarter carry + 20%-cap-40 · scaled (independent 20-seed validation)** — Ace 62.4%, Scratch 48.7%, Rusty 7.0%; Ace median 8.0; reversal 9.2%; oscillation 29.3%; Pro survival 91.3%; max human movement 40 promoted/28 relegated.

Field-size sensitivity — 20: Ace 61.1%, Rusty 7.5%, Ace median 9.0; 30: Ace 61.3%, Rusty 9.4%, Ace median 8.0; 50: Ace 61.4%, Rusty 8.2%, Ace median 7.0; 100: Ace 64.9%, Rusty 7.7%, Ace median 8.0; 500: Ace 62.1%, Rusty 6.5%, Ace median 8.0.

Human-ratio sensitivity — 25% humans: Ace 63.3%, Rusty 7.1%, Ace median 8.0; 50% humans: Ace 64.3%, Rusty 6.5%, Ace median 8.0; 80% humans: Ace 60.9%, Rusty 7.2%, Ace median 8.0.

Activity sensitivity — full: Ace 73.8%, Rusty 9.9%, Ace median 8.0; occasional: Ace 42.0%, Rusty 2.6%, Ace median 8.0; returning: Ace 69.7%, Rusty 7.8%, Ace median 8.0.


Reading the matrix: a healthy candidate shows Ace→Pro clearly above Scratch above Rusty, low Rusty→Pro, low reversal, credible Pro survival, and Ace median seasons near the 4–8 target.

## Audit notes and disclosures

Correctness items confirmed against v5: event points (unrounded percentile, averaged ties, no-show zero), best-3-of-4, active≥3, season tiebreak chain, symmetric movement with exact boundary-tie expansion, Local floor / Pro ceiling, inactivity (first preserve, second Pro→Challenger, never below Challenger, reset on activity), Tour Rating (tier-weighted percentile, best-6-of-8, inactive occupies a slot at zero), Championship qualification with Pro pass-down. Focused unit tests cover each. The report reproduces byte-identically from the documented seed.

Honest limitations that temper the headline numbers:

- **Uniform remains the untouched baseline; tier scaling is only a labelled candidate.** The scaled mix is static field assignment (consistent with v5's bot persistence boundary), not a simulation of autonomous bot careers. Its exact 60/35/5, 10/45/45, and 2/28/70 weights are proposed calibration values, not frozen product rules.
- **Every candidate now runs the complete matrix.** Candidate reach/survival/reversal figures use the 16-season slice; tie, Championship, and scale figures use all matching horizons. This avoids the prior field-50-only comparison but still means those metric families use the population appropriate to the question.
- **The 500-player "~100 movers" are cohort-level and bot-dominated.** With ≤400 humans spread across three tiers, most of a 500 cohort is bots, so the ~100 promoted/relegated are mostly bots. The product concern (a cohort where ~100 move at once) stands; the human-facing count is smaller.
- **Bot results are sampled from the score bank, not fresh rounds.** A deliberate speed trade-off; settlement-scale tests should also run direct complete rounds before production.

## Formula recommendation

**Do not freeze the v5 baseline.** The failure is not the 20% movement rate — it is the ability model. v5's twelve policies give a non-monotonic band ordering (Ace 1.51 vs Scratch 1.38) and a naive/strong gap of only **0.25 strokes**, because the engine's EV floor is "normal" and tactical aggression is EV-negative. No movement rate or tier multiplier can repair a skill signal that does not exist, which is why the v5-model rows in the matrix stay poor at every movement rate.

**Recommended direction: the corrected error-model** — one shared near-optimal reference policy plus a per-band seeded decision-error rate (Rusty 0.42 / Scratch 0.18 / Ace 0.05). It is the smallest engine-consistent change that produces a monotonic, ~0.9-stroke skill gradient with every competitor still resolving through the same server-authoritative engine, deterministic replay intact, no hidden shot-quality bonus, no arbitrary strokes, and bot identity/tendency kept separate from ability.

**Tier-scaled fields do not solve the residual progression problem.** At corrected 20%, moving from uniform to scaled changes Ace→Pro from 74.0% to 71.7%, Rusty→Pro from 32.9% to 33.2%, reversal from 22.0% to 25.2%, and survival from 81.4% to 77.0%. The harder Challenger/Pro fields are offset by an easier Local field, and a fixed percentage still advances a cohort share every season. Pro strength affects survival after arrival but cannot stop a competitor from first crossing the Challenger boundary. The earlier claim that uniform fields were probably the main cause is therefore rejected by this experiment.

**The original standard-signal candidates do not clear every v5 target.** The best slot compromise remains **Corrected 15% · tier-scaled**, but a 21.1% weak-player Pro rate and 38.9% longer-term oscillation are too high. Corrected 12% is more selective but still leaves weak advancement above the operational rare threshold and pushes Ace to the edge of the timing target.

**Symmetric two-season confirmation also fails.** It removes immediate reversal by construction and suppresses Rusty→Pro to ~1%, but over-corrects Ace→Pro to 11–15% with an 11-season median. Making both boundaries equally sticky produces stability by largely stopping progression, not by improving separation.

**Candidate A (rolling form) is the strongest new direction, but still not a freeze.** Rolling-2 at 75/25 is selective (Rusty 8.3%) but misses the strong-player timing target (Ace 45.5%, median 9). Relaxing to 70/30 moves Ace to 58.1% with a median of 8, keeps Rusty at 16.0%, eliminates immediate reversal, and lowers oscillation to 28.3%. However, resetting the window on tier change guarantees one-season Pro survival (100%), and 16% weak advancement is not unambiguously "rare." Rolling-3 over-corrects (Ace 20.9%, median 11).

**Candidate B (relegation protection) fails.** One-shot promotion plus a protected first weak season eliminates immediate reversal but lets weak careers accumulate upward: Rusty reaches Pro 47.5% at 20% movement and 33.5% at 15%. The warning state appears in 12.2% and 8.6% of active human seasons respectively. Stability comes from retention rather than better selection.

**Candidate C (bounded human movement) solves scale but starves progression.** Caps of 4/8/12 keep actual human movement near their soft boundary even in 500-player fields, but Ace reaches Pro only 25.2%/36.9%/43.6%, with medians of 9/9/8. Bots do not consume the cap and exact ties remain together, but a single global cap is too blunt across 20- and 500-player cohorts.

**Candidate D also fails.** Combining rolling-2 70/30 with a soft human cap of 20 bounds actual movement at 20 per direction, but drops Ace to 49.8% with a median of 9 seasons. It improves Rusty to 12.4% and oscillation to 21.0%, yet misses the strong-player 4–8-season target. The failed B protection rule was deliberately not stacked into D.

**Transition carryover resolves the artificial survival result only when it is bounded near neutral.** A neutral promotion prior lowers structural 100% survival to 88.7%, while half/full carry still guarantee survival and materially increase weak upward accumulation. A quarter-weight prior is the useful middle ground once paired with a promotion-quality floor.

**Observed-performance guards cannot rescue the standard skill signal by themselves.** Requiring both rolling seasons to clear a percentile floor improves selectivity, but the strict versions that approach rare weak progression push Ace beyond the 8-season target. This demonstrates that movement was being asked to manufacture separation the underlying outcomes did not contain.

**E moderate signal + D3 adaptive is an aggregate pass but fails robustness.** Its aggregate is Ace 59.8%, Scratch 44.0%, Rusty 8.1%, Ace median 8.0, reversal 12.8%, oscillation 26.8%, and survival 88.1%. However, its 500-player, 80%-human, and fully-active Ace medians reach 9 seasons, so the complete evidence does not support freezing it.

**H is the mechanical freeze recommendation; G is rejected.** Both use corrected 0.65/0.14/0.02 error rates, two active-season percentiles, a 0.32 relegation threshold, quarter-weight promotion carry, and clamp(ceil(0.20 × active humans), 4, 40) soft movement limits. G's 0.55 floor is faster but leaves fully active Rusty reach at 13.3%. H promotes at average ≥0.65 only when both seasons are ≥0.58; independent validation yields Ace 62.4%/median 8, Scratch 48.7%, Rusty 7.0%, reversal 9.2%, oscillation 29.3%, and survival 91.3%. Its fully active slice is Ace 73.8%/median 8 and Rusty 9.9%; its 500-player slice is Ace 62.1%/median 8 and Rusty 6.5%. The field-20 Ace median is 9, one season outside the approximate range, while every human-ratio slice and the explicitly targeted consistently-active slice is 8 or faster.

**Freeze recommendation remains conditional on one explicit product decision:** whether the wide 0.65/0.14/0.02 decision-error calibration is an acceptable representation of Rusty/Scratch/Ace rival skill. The simulator shows that standard-signal movement rules cannot simultaneously produce approximately 4–8-season strong progression and rare weak progression; widening observed outcome separation can. This is now an ability-calibration choice, not an unresolved movement-formula search.

Decision options:

1. **Approve wide skill calibration and freeze H (recommended).** This is the only tested path that clears the aggregate, fully active, high-human-ratio, and 500-player checks together. Exact movement is the H formula above; exact error rates are 0.65/0.14/0.02.
2. **Keep moderate calibration and relax “rare” to roughly 15%.** F3 moderate reaches Ace 67.6%, Scratch 54.6%, Rusty 14.9%, median 7, reversal 9.4%, survival 91.1%, with the same 40-person soft scale bound. This preserves a less extreme Rusty error rate but explicitly weakens the fairness target.
3. **Keep the standard calibration and relax strong-player timing.** The selective standard-signal rolling candidate holds Rusty to 8.3% but reaches only 45.5% of Aces with a 9-season median. This preserves the original corrected rates but explicitly moves the progression target.

Until option 1 is approved, H is simulator-validated but the production formulas remain unfrozen.

Compressing Tour Rating multipliers narrows displayed rating gaps but leaves progression byte-identical, as expected.

This remains a proposed model requiring explicit approval. The reference policy and the error rates (0.42/0.18/0.05) are tuning knobs, not frozen values.

## Risks and unresolved questions

- The corrected model expresses ability as decision-error frequency through the real engine — no hidden shot-quality bonuses, no Career-only probability tables. The error rates (0.42/0.18/0.05) and the reference policy are proposed values that need approval and further sensitivity work.
- Tier-scaled fields were measured and did not repair weak advancement; their proposed mix should not be frozen.
- Rolling windows implicitly protect a newly promoted player until enough active seasons exist in the new tier; the 100% one-season survival metric is structural, not evidence that Pro difficulty is calibrated perfectly.
- A fixed human cap behaves very differently at field sizes 20 and 500. A production cap would likely need a bounded percentage or size bands, which was not silently introduced here.
- H clears the mechanical evaluation after independent validation; accepting its wider bot-skill calibration is the remaining product decision before formula freeze.
- Bot results use deterministic samples from real-engine score banks for speed; settlement-scale tests should also run direct complete rounds.
- The 500-player case exposes the product effect of a cohort where ~100 move at once even when the mathematics stay stable; bounded slots or flights may be preferable.
- Tour Rating overlap should remain visible: a strong Challenger should approach a weak Pro, while tier multipliers should not make weak Pro performance untouchable.
- **Championship and regular-season concurrency still requires human playtesting.** A simulator can measure workload and eligibility but cannot decide whether a simultaneous Championship feels like a delightful bonus or an unwanted second obligation.

## Gate 3 freeze-stage follow-up

Candidate H's remaining ability-calibration decision was approved. H is now packaged as `career-v1-freeze-candidate`; event points, tier strength, Tour Rating, and Legacy Points receive their final sensitivity analysis in [`career-formula-freeze.md`](./career-formula-freeze.md). This section supersedes only the report's earlier conditional status—it does not remove or rewrite any rejected-candidate evidence.
