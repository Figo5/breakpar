# Player-paced Career long-horizon simulation

Formula package: `career-v2-player-paced`.

This analysis models one player plus nineteen tier-scaled named bots, four immediately playable events per season, best three counting, Candidate-H rolling movement without a human cap, a Championship check every fourth settled season gated on Challenger/Pro, and no inactivity. Every unlocked Championship is played immediately for the Legacy curve; qualification points are earned at season settlement either way.

## Reproduction

```sh
npm run career:simulate:player-paced -- --seed career-player-paced-v1 --bank-samples 256 --careers-per-ability 200 --seasons 500
```

The run contains 600 deterministic careers and 300,000 settled seasons. Human tendency is held at Balanced to isolate skill; bot tendencies remain their persistent roster identities.

## Legacy curve

| Ability | Season | P10 | P25 | Median | P75 | P90 |
|---|---:|---:|---:|---:|---:|---:|
| rusty | 10 | 120 | 140 | 175 | 225 | 290 |
| rusty | 25 | 350 | 395 | 460 | 550 | 639 |
| rusty | 50 | 755 | 835 | 960 | 1044 | 1143 |
| rusty | 100 | 1670 | 1750 | 1851 | 2037 | 2179 |
| rusty | 250 | 4364 | 4510 | 4743 | 4960 | 5251 |
| scratch | 10 | 195 | 225 | 285 | 339 | 400 |
| scratch | 25 | 585 | 665 | 745 | 846 | 918 |
| scratch | 50 | 1262 | 1377 | 1501 | 1681 | 1768 |
| scratch | 100 | 2695 | 2863 | 3096 | 3310 | 3514 |
| scratch | 250 | 7107 | 7364 | 7740 | 8079 | 8381 |
| ace | 10 | 220 | 270 | 339 | 396 | 457 |
| ace | 25 | 661 | 786 | 890 | 985 | 1060 |
| ace | 50 | 1452 | 1574 | 1740 | 1843 | 1983 |
| ace | 100 | 3058 | 3280 | 3484 | 3676 | 3856 |
| ace | 250 | 8041 | 8408 | 8687 | 8980 | 9271 |

## Progression and Championships

| Ability | Pro by S10 | Pro by S25 | Median seasons to Pro | First Championship reached | Mean / median first Championship | Relegations / season | Pro survival |
|---|---:|---:|---:|---:|---:|---:|---:|
| rusty | 7.0% | 21.5% | 84.0 | 100.0% | 21.9 / 16.0 | 0.065 | 67.5% |
| scratch | 36.0% | 78.5% | 14.0 | 100.0% | 7.6 / 4.0 | 0.108 | 82.5% |
| ace | 61.5% | 95.0% | 9.0 | 100.0% | 6.2 / 4.0 | 0.104 | 85.9% |

## Tour Rating volume-neutrality

A 10-season-or-shorter history represented by the same final eight ratings yields **750.00**. A 200-season history with those identical final eight ratings yields **750.00**. Difference: **0.00**.

## Milestone observations

Current provisional ladder: 250 / 1,000 / 2,500 / 5,000 / 10,000 / 25,000.

| Ability | Milestone | Reached in horizon | P25 seasons | Median seasons | P75 seasons |
|---|---:|---:|---:|---:|---:|
| rusty | 250 | 100.0% | 12.0 | 15.0 | 17.0 |
| rusty | 1,000 | 100.0% | 48.0 | 53.0 | 59.0 |
| rusty | 2,500 | 100.0% | 124.0 | 133.0 | 140.0 |
| rusty | 5,000 | 100.0% | 252.0 | 264.0 | 275.0 |
| rusty | 10,000 | 21.5% | 471.0 | 487.0 | 494.0 |
| rusty | 25,000 | 0.0% | n/a | n/a | n/a |
| scratch | 250 | 100.0% | 8.0 | 9.0 | 12.0 |
| scratch | 1,000 | 100.0% | 31.0 | 33.0 | 38.0 |
| scratch | 2,500 | 100.0% | 76.0 | 81.0 | 89.0 |
| scratch | 5,000 | 100.0% | 153.0 | 164.0 | 172.0 |
| scratch | 10,000 | 100.0% | 310.0 | 323.0 | 337.0 |
| scratch | 25,000 | 0.0% | n/a | n/a | n/a |
| ace | 250 | 100.0% | 7.0 | 8.0 | 9.0 |
| ace | 1,000 | 100.0% | 26.0 | 29.0 | 32.0 |
| ace | 2,500 | 100.0% | 68.0 | 72.0 | 77.0 |
| ace | 5,000 | 100.0% | 138.0 | 144.0 | 152.0 |
| ace | 10,000 | 100.0% | 280.0 | 289.0 | 296.0 |
| ace | 25,000 | 0.0% | n/a | n/a | n/a |

- rusty: season-500 Legacy median 9539 (P25 9240, P75 9944); mean 9604.
- scratch: season-500 Legacy median 15551 (P25 15040, P75 15973); mean 15540.
- ace: season-500 Legacy median 17498 (P25 16978, P75 18041); mean 17500.

The design document records the product recommendation derived from these values.
