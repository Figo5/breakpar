# Player-paced Career long-horizon simulation

Formula package: `career-v5-recovery-ladder`.
Movement: Local 72%/60% floor, Challenger 75%/62% floor, and 40% relegation.
Development: exact Driving, Approach, Short Game, and Putting ranks (1–5) applied to the production stage probability tables. The simulator spends points along a deterministic balanced path; it never substitutes a higher ability band.

This analysis models one player plus nineteen tier-scaled named bots, four four-round events per season, best three counting, two-season rolling movement, a Championship check every fourth settled season gated on Challenger/Pro, and no inactivity. Every unlocked Championship is played immediately for the Legacy curve.

## Reproduction

```sh
npm run career:simulate:player-paced -- --seed career-player-paced-v5-recovery-ladder --bank-samples 1024 --careers-per-ability 200 --seasons 500
```

The run contains 600 deterministic careers and 300,000 settled seasons. Human tendency is held at Balanced to isolate skill; bot tendencies remain their persistent roster identities.

## Exact rank effect

| Starting decision quality | Rank 1 mean | All-rank-5 mean | Improvement |
|---|---:|---:|---:|
| rusty | 1.46 | -0.41 | 1.87 strokes |
| scratch | 0.52 | -1.27 | 1.79 strokes |
| ace | 0.33 | -1.46 | 1.79 strokes |

A career that never finishes in the top half can earn only the four foundation points. Its theoretical balanced-build ceiling is 8 total rank levels out of 20, so volume alone cannot maximize the player.

## Legacy curve

| Ability | Season | P10 | P25 | Median | P75 | P90 |
|---|---:|---:|---:|---:|---:|---:|
| rusty | 10 | 130 | 160 | 195 | 245 | 290 |
| rusty | 25 | 510 | 595 | 697 | 813 | 893 |
| rusty | 50 | 1477 | 1676 | 1852 | 2040 | 2161 |
| rusty | 100 | 3832 | 4080 | 4312 | 4518 | 4764 |
| rusty | 250 | 11058 | 11422 | 11661 | 12021 | 12392 |
| scratch | 10 | 285 | 330 | 400 | 466 | 517 |
| scratch | 25 | 1059 | 1187 | 1318 | 1420 | 1550 |
| scratch | 50 | 2746 | 2854 | 3019 | 3182 | 3340 |
| scratch | 100 | 5985 | 6254 | 6490 | 6692 | 6882 |
| scratch | 250 | 15839 | 16327 | 16731 | 17158 | 17482 |
| ace | 10 | 305 | 372 | 451 | 521 | 597 |
| ace | 25 | 1191 | 1310 | 1460 | 1560 | 1684 |
| ace | 50 | 2940 | 3113 | 3288 | 3463 | 3663 |
| ace | 100 | 6510 | 6768 | 7015 | 7256 | 7464 |
| ace | 250 | 17273 | 17660 | 18023 | 18442 | 18797 |

## Progression and Championships

| Ability | Pro by S10 | Pro by S25 | Median seasons to Pro | First Championship reached | Mean / median first Championship | Relegations / season | Pro survival |
|---|---:|---:|---:|---:|---:|---:|---:|
| rusty | 7.5% | 57.0% | 24.0 | 100.0% | 12.9 / 12.0 | 0.067 | 92.9% |
| scratch | 63.5% | 100.0% | 9.0 | 100.0% | 6.1 / 4.0 | 0.006 | 99.5% |
| ace | 74.0% | 100.0% | 8.0 | 100.0% | 5.2 / 4.0 | 0.002 | 99.8% |

## Gate verdicts

| Gate | Result | Verdict |
|---|---:|---|
| Rank modifiers improve the real engine | all 3 cohorts | Pass |
| Rusty path to Pro by Season 25 | 57.0% | Pass |
| Rusty Pro not automatic by Season 10 | 7.5% | Pass |
| Scratch/Ace remain separated | median 9.0 / 8.0 | Pass |
| Relegation remains possible | 7531 observed | Pass |
| Tour Rating volume-neutral | 0.00 difference | Pass |
| Challenger/Pro overlap remains | 6.6% | Pass |
| Ranks cap at 1–5 | bounded | Pass |
| Bottom-half volume cannot max | 8/20 rank levels | Pass |

## Tour Rating volume-neutrality

A 10-season-or-shorter history represented by the same final eight ratings yields **750.00**. A 200-season history with those identical final eight ratings yields **750.00**. Difference: **0.00**.

## Tier-rating boundary

The strong-Challenger checkpoint (75th-percentile Tour Rating) is **955.26**. The weak-Pro checkpoint (25th percentile) is **1184.21**. The Pro-minus-Challenger boundary is **228.95**. **6.6%** of Pro-season ratings fall at or below that strong-Challenger checkpoint, recording the intentional overlap without removing the tier reward.

## Milestone observations

Current provisional ladder: 250 / 1,000 / 2,500 / 5,000 / 10,000 / 25,000.

| Ability | Milestone | Reached in horizon | P25 seasons | Median seasons | P75 seasons |
|---|---:|---:|---:|---:|---:|
| rusty | 250 | 100.0% | 11.0 | 12.0 | 14.0 |
| rusty | 1,000 | 100.0% | 30.0 | 33.0 | 36.0 |
| rusty | 2,500 | 100.0% | 60.0 | 64.0 | 68.0 |
| rusty | 5,000 | 100.0% | 109.0 | 115.0 | 119.0 |
| rusty | 10,000 | 100.0% | 208.0 | 216.0 | 221.0 |
| rusty | 25,000 | 11.0% | 492.0 | 495.0 | 498.0 |
| scratch | 250 | 100.0% | 6.0 | 8.0 | 8.0 |
| scratch | 1,000 | 100.0% | 19.0 | 20.0 | 23.0 |
| scratch | 2,500 | 100.0% | 40.0 | 43.0 | 45.0 |
| scratch | 5,000 | 100.0% | 76.0 | 80.0 | 82.0 |
| scratch | 10,000 | 100.0% | 148.0 | 152.0 | 157.0 |
| scratch | 25,000 | 100.0% | 363.0 | 372.0 | 380.0 |
| ace | 250 | 100.0% | 5.0 | 7.0 | 8.0 |
| ace | 1,000 | 100.0% | 17.0 | 19.0 | 21.0 |
| ace | 2,500 | 100.0% | 38.0 | 40.0 | 42.0 |
| ace | 5,000 | 100.0% | 71.0 | 74.0 | 76.0 |
| ace | 10,000 | 100.0% | 137.0 | 141.0 | 145.0 |
| ace | 25,000 | 100.0% | 339.0 | 345.0 | 352.0 |

- rusty: season-500 Legacy median 24184 (P25 23687, P75 24657); mean 24132.
- scratch: season-500 Legacy median 33830 (P25 33336, P75 34448); mean 33867.
- ace: season-500 Legacy median 36447 (P25 35798, P75 37089); mean 36419.

The design document records the product recommendation derived from these values.
