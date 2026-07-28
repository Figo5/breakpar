# Player-paced Career long-horizon simulation

Formula package: `career-v4-progression`.
Movement: Local 72%/60% floor, Challenger 75%/62% floor, and 40% relegation.
Development: exact Driving, Approach, Short Game, and Putting ranks (1–5) applied to the production stage probability tables. The simulator spends points along a deterministic balanced path; it never substitutes a higher ability band.

This analysis models one player plus nineteen tier-scaled named bots, four four-round events per season, best three counting, two-season rolling movement, a Championship check every fourth settled season gated on Challenger/Pro, and no inactivity. Every unlocked Championship is played immediately for the Legacy curve.

## Reproduction

```sh
npm run career:simulate:player-paced -- --seed career-player-paced-v4 --bank-samples 1024 --careers-per-ability 200 --seasons 500
```

The run contains 600 deterministic careers and 300,000 settled seasons. Human tendency is held at Balanced to isolate skill; bot tendencies remain their persistent roster identities.

## Exact rank effect

| Starting decision quality | Rank 1 mean | All-rank-5 mean | Improvement |
|---|---:|---:|---:|
| rusty | 1.86 | -0.08 | 1.94 strokes |
| scratch | 0.96 | -0.92 | 1.87 strokes |
| ace | 0.71 | -1.10 | 1.81 strokes |

A career that never finishes in the top half can earn only the four foundation points. Its theoretical balanced-build ceiling is 8 total rank levels out of 20, so volume alone cannot maximize the player.

## Legacy curve

| Ability | Season | P10 | P25 | Median | P75 | P90 |
|---|---:|---:|---:|---:|---:|---:|
| rusty | 10 | 125 | 155 | 190 | 230 | 285 |
| rusty | 25 | 525 | 570 | 678 | 752 | 836 |
| rusty | 50 | 1519 | 1671 | 1824 | 1963 | 2100 |
| rusty | 100 | 3880 | 4049 | 4276 | 4479 | 4621 |
| rusty | 250 | 10936 | 11269 | 11540 | 11846 | 12150 |
| scratch | 10 | 290 | 341 | 414 | 470 | 533 |
| scratch | 25 | 1069 | 1190 | 1303 | 1397 | 1532 |
| scratch | 50 | 2716 | 2857 | 3011 | 3158 | 3303 |
| scratch | 100 | 6064 | 6280 | 6498 | 6685 | 6851 |
| scratch | 250 | 16157 | 16458 | 16825 | 17197 | 17582 |
| ace | 10 | 340 | 397 | 465 | 527 | 605 |
| ace | 25 | 1246 | 1364 | 1490 | 1608 | 1705 |
| ace | 50 | 3018 | 3150 | 3352 | 3492 | 3624 |
| ace | 100 | 6655 | 6922 | 7127 | 7348 | 7534 |
| ace | 250 | 17683 | 17953 | 18383 | 18765 | 19169 |

## Progression and Championships

| Ability | Pro by S10 | Pro by S25 | Median seasons to Pro | First Championship reached | Mean / median first Championship | Relegations / season | Pro survival |
|---|---:|---:|---:|---:|---:|---:|---:|
| rusty | 6.5% | 63.0% | 22.0 | 100.0% | 12.8 / 12.0 | 0.049 | 94.9% |
| scratch | 77.5% | 100.0% | 8.0 | 100.0% | 5.2 / 4.0 | 0.004 | 99.6% |
| ace | 89.0% | 100.0% | 7.0 | 100.0% | 5.0 / 4.0 | 0.002 | 99.8% |

## Gate verdicts

| Gate | Result | Verdict |
|---|---:|---|
| Rank modifiers improve the real engine | all 3 cohorts | Pass |
| Rusty path to Pro by Season 25 | 63.0% | Pass |
| Rusty Pro not automatic by Season 10 | 6.5% | Pass |
| Scratch/Ace remain separated | median 8.0 / 7.0 | Pass |
| Relegation remains possible | over 5,000 observed | Pass |
| Tour Rating volume-neutral | 0.00 difference | Pass |
| Challenger/Pro overlap remains | 6.3% | Pass |
| Ranks cap at 1–5 | bounded | Pass |
| Bottom-half volume cannot max | 8/20 rank levels | Pass |

## Tour Rating volume-neutrality

A 10-season-or-shorter history represented by the same final eight ratings yields **750.00**. A 200-season history with those identical final eight ratings yields **750.00**. Difference: **0.00**.

## Tier-rating boundary

The strong-Challenger checkpoint (75th-percentile Tour Rating) is **986.84**. The weak-Pro checkpoint (25th percentile) is **1196.05**. The Pro-minus-Challenger boundary is **209.21**. **6.3%** of Pro-season ratings fall at or below that strong-Challenger checkpoint, recording the intentional overlap without removing the tier reward.

## Milestone observations

Current provisional ladder: 250 / 1,000 / 2,500 / 5,000 / 10,000 / 25,000.

| Ability | Milestone | Reached in horizon | P25 seasons | Median seasons | P75 seasons |
|---|---:|---:|---:|---:|---:|
| rusty | 250 | 100.0% | 11.0 | 12.0 | 14.0 |
| rusty | 1,000 | 100.0% | 31.0 | 33.0 | 36.0 |
| rusty | 2,500 | 100.0% | 60.0 | 64.0 | 68.0 |
| rusty | 5,000 | 100.0% | 111.0 | 116.0 | 121.0 |
| rusty | 10,000 | 100.0% | 212.0 | 219.0 | 224.0 |
| rusty | 25,000 | 3.5% | 491.0 | 495.0 | 498.0 |
| scratch | 250 | 100.0% | 6.0 | 7.0 | 8.0 |
| scratch | 1,000 | 100.0% | 20.0 | 21.0 | 23.0 |
| scratch | 2,500 | 100.0% | 41.0 | 43.0 | 45.0 |
| scratch | 5,000 | 100.0% | 76.0 | 79.0 | 81.0 |
| scratch | 10,000 | 100.0% | 148.0 | 152.0 | 156.0 |
| scratch | 25,000 | 100.0% | 363.0 | 370.0 | 376.0 |
| ace | 250 | 100.0% | 5.0 | 7.0 | 8.0 |
| ace | 1,000 | 100.0% | 18.0 | 19.0 | 20.0 |
| ace | 2,500 | 100.0% | 37.0 | 39.0 | 41.0 |
| ace | 5,000 | 100.0% | 70.0 | 72.0 | 75.0 |
| ace | 10,000 | 100.0% | 136.0 | 139.0 | 142.0 |
| ace | 25,000 | 100.0% | 331.0 | 338.0 | 345.0 |

- rusty: season-500 Legacy median 23719 (P25 23176, P75 24137); mean 23694.
- scratch: season-500 Legacy median 33923 (P25 33487, P75 34708); mean 34100.
- ace: season-500 Legacy median 37026 (P25 36550, P75 37860); mean 37185.

The design document records the product recommendation derived from these values.
