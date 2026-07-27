# Player-paced Career long-horizon simulation

Formula package: `career-v3-four-round-events`.

This analysis models one player plus nineteen tier-scaled named bots, four immediately playable events per season, best three counting, Candidate-H rolling movement without a human cap, a Championship check every fourth settled season gated on Challenger/Pro, and no inactivity. Every unlocked Championship is played immediately for the Legacy curve; qualification points are earned at season settlement either way.

## Reproduction

```sh
npm run career:simulate:player-paced -- --seed career-player-paced-v1 --bank-samples 256 --careers-per-ability 200 --seasons 500
```

The run contains 600 deterministic careers and 300,000 settled seasons. Human tendency is held at Balanced to isolate skill; bot tendencies remain their persistent roster identities.

## Legacy curve

| Ability | Season | P10 | P25 | Median | P75 | P90 |
|---|---:|---:|---:|---:|---:|---:|
| rusty | 10 | 105 | 125 | 155 | 185 | 215 |
| rusty | 25 | 315 | 350 | 400 | 445 | 501 |
| rusty | 50 | 685 | 730 | 795 | 865 | 930 |
| rusty | 100 | 1430 | 1487 | 1590 | 1690 | 1775 |
| rusty | 250 | 3704 | 3827 | 3975 | 4110 | 4265 |
| scratch | 10 | 195 | 245 | 295 | 338 | 391 |
| scratch | 25 | 574 | 649 | 730 | 819 | 913 |
| scratch | 50 | 1235 | 1322 | 1448 | 1564 | 1675 |
| scratch | 100 | 2621 | 2745 | 2927 | 3135 | 3264 |
| scratch | 250 | 6733 | 7028 | 7250 | 7524 | 7913 |
| ace | 10 | 260 | 310 | 367 | 409 | 444 |
| ace | 25 | 789 | 838 | 934 | 1016 | 1067 |
| ace | 50 | 1631 | 1741 | 1870 | 1976 | 2089 |
| ace | 100 | 3349 | 3529 | 3710 | 3896 | 4030 |
| ace | 250 | 8653 | 8914 | 9211 | 9529 | 9783 |

## Progression and Championships

| Ability | Pro by S10 | Pro by S25 | Median seasons to Pro | First Championship reached | Mean / median first Championship | Relegations / season | Pro survival |
|---|---:|---:|---:|---:|---:|---:|---:|
| rusty | 1.5% | 6.5% | 181.0 | 100.0% | 29.9 / 20.0 | 0.056 | 58.4% |
| scratch | 49.0% | 87.0% | 11.0 | 100.0% | 6.7 / 4.0 | 0.128 | 77.6% |
| ace | 70.5% | 100.0% | 7.0 | 100.0% | 5.2 / 4.0 | 0.100 | 87.8% |

## Tour Rating volume-neutrality

A 10-season-or-shorter history represented by the same final eight ratings yields **750.00**. A 200-season history with those identical final eight ratings yields **750.00**. Difference: **0.00**.

## Milestone observations

Current provisional ladder: 250 / 1,000 / 2,500 / 5,000 / 10,000 / 25,000.

| Ability | Milestone | Reached in horizon | P25 seasons | Median seasons | P75 seasons |
|---|---:|---:|---:|---:|---:|
| rusty | 250 | 100.0% | 14.0 | 16.0 | 19.0 |
| rusty | 1,000 | 100.0% | 59.0 | 63.0 | 68.0 |
| rusty | 2,500 | 100.0% | 151.0 | 158.0 | 165.0 |
| rusty | 5,000 | 100.0% | 305.0 | 314.0 | 323.0 |
| rusty | 10,000 | 0.0% | n/a | n/a | n/a |
| rusty | 25,000 | 0.0% | n/a | n/a | n/a |
| scratch | 250 | 100.0% | 8.0 | 9.0 | 11.0 |
| scratch | 1,000 | 100.0% | 31.0 | 35.0 | 38.0 |
| scratch | 2,500 | 100.0% | 80.0 | 86.0 | 92.0 |
| scratch | 5,000 | 100.0% | 166.0 | 172.0 | 180.0 |
| scratch | 10,000 | 100.0% | 332.0 | 345.0 | 355.0 |
| scratch | 25,000 | 0.0% | n/a | n/a | n/a |
| ace | 250 | 100.0% | 6.0 | 7.0 | 8.0 |
| ace | 1,000 | 100.0% | 25.0 | 28.0 | 30.0 |
| ace | 2,500 | 100.0% | 64.0 | 68.0 | 72.0 |
| ace | 5,000 | 100.0% | 132.0 | 136.0 | 141.0 |
| ace | 10,000 | 100.0% | 263.0 | 272.0 | 280.0 |
| ace | 25,000 | 0.0% | n/a | n/a | n/a |

- rusty: season-500 Legacy median 8005 (P25 7742, P75 8270); mean 8012.
- scratch: season-500 Legacy median 14538 (P25 14086, P75 14973); mean 14598.
- ace: season-500 Legacy median 18518 (P25 18139, P75 18950); mean 18549.

The design document records the product recommendation derived from these values.
