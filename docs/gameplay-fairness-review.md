# Gameplay fairness review — July 28, 2026

Status: scoring changes calibrated and verified locally; Career progression,
movement, and selectable-ruleset work remains candidate/design-only.

## Reproduction

The untouched baseline was recorded from `8491d7f` before the uncommitted
fairness changes:

```sh
npm run engine:audit
npm run engine:calibrate
npm run career:simulate:player-paced -- --seed career-fairness-v1 --bank-samples 256 --careers-per-ability 200 --seasons 250 --output /tmp/career-fairness-full.md
```

The scoring audit covers 12,000 smart-policy rounds. Calibration covers 40,000
rounds per strategy. The Career run covers 600 deterministic careers and 150,000
settled seasons.

## Baseline findings

### Whole-game score shape

| Par | Mean | Birdie | Par | Bogey | Double+ |
|---|---:|---:|---:|---:|---:|
| 3 | +0.14 | 20.2% | 52.7% | 21.2% | 5.8% |
| 4 | +0.12 | 22.7% | 49.6% | 21.5% | 6.1% |
| 5 | -0.21 | 34.2% | 40.0% | 15.0% | 4.8% |

Smart-player round shape was +1.24 mean, +1 median, 3.75 standard deviation,
with 65.5% of rounds between -2 and +4. Good and skilled policies broke par
32.6% and 32.7% of the time; naive and always-aggressive policies broke par
28.2% and 25.5%. Decisions therefore mattered, but only by 4.5–7.2 percentage
points depending on the comparison.

### Putting

The old model generated short putts only from 6–18 feet and long putts only
from 25–45 feet. A requested 20-foot audit silently used the 25-foot floor,
creating a real 19–24-foot model gap.

Neutral Medium/straight/flat three-putt rates before tuning:

| Distance | Lag | Roll It | Charge |
|---|---:|---:|---:|
| 10 ft | 1.8% | 2.7% | 7.0% |
| 15 ft | 2.3% | 3.5% | 9.6% |
| 20 ft (clamped to 25) | 6.2% | 8.8% | 19.0% |
| 25 ft | 6.2% | 8.8% | 19.0% |
| 30 ft | 7.8% | 11.1% | 23.6% |
| 40 ft | 10.9% | 15.6% | 32.2% |
| 50 ft (clamped to 45) | 12.5% | 17.8% | 36.2% |

Across all green speeds, breaks, and slopes, a 20–25-foot lag ranged from
4.2% to 10.6%. The player report of repeated three-putts in this range is
therefore consistent with the model, especially on fast downhill putts.

The authoritative PGA TOUR definition is the share of holes taking three or
more putts when the initial putt is in the stated distance band. Through the
2026 Open Championship, the TOUR average was
[1.97% from 20–25 feet](https://www.pgatour.com/stats/detail/146) and
[9.05% from beyond 25 feet](https://www.pgatour.com/stats/detail/147).
These are reference anchors, not a claim that Break Par must exactly simulate a
TOUR professional.

Casual-game target:

- Lag: 1–4% at 20–25 feet, 3–8% at 30 feet, rising smoothly thereafter.
- Roll It: visibly more make upside and modestly more three-putt risk.
- Charge: the highest make chance and a clearly disclosed, optional risk.
- Fast/downhill/breaking geometry may exceed the neutral target, but the odds
  shown to the player must include those modifiers.

Final neutral three-putt rates:

| Distance | Lag | Roll It | Charge |
|---|---:|---:|---:|
| 10 ft | 1.8% | 2.6% | 6.8% |
| 15 ft | 2.3% | 3.5% | 9.3% |
| 20 ft | 2.8% | 4.4% | 12.0% |
| 25 ft | 3.3% | 5.0% | 12.7% |
| 30 ft | 4.7% | 7.0% | 17.4% |
| 40 ft | 7.3% | 11.0% | 26.4% |
| 50 ft | 9.9% | 14.9% | 34.5% |

The generated range is now continuous from 6–50 feet and the 19→20-foot
transition is explicitly regression-tested. Lag falls inside the casual target;
Roll It and Charge preserve disclosed upside/risk.

### Par 4 under 350 yards

There was no drivable-par-4 branch. Aggressive and Normal both used the same
tee → approach → finish stroke chain. Aggressive averaged -0.05 and Normal
+0.01 on the short-hole cohort, but neither could put the tee shot on or around
the green and an apparent greenside miss could not be an up-and-down for birdie.

Final short-par-4 cohort:

| Tee choice | Mean | Eagle | Birdie | Par | Bogey | Double+ |
|---|---:|---:|---:|---:|---:|---:|
| Drive green | -0.20 | 3.2% | 31.3% | 50.3% | 12.6% | 2.7% |
| Normal | +0.01 | 0.1% | 26.3% | 52.1% | 17.0% | 4.5% |

The aggressive option now skips the fictional approach, uses one tee decision,
and flows directly to a putt or a harder greenside recovery. One-/two-/three-putt
finishes score eagle/birdie/par; an up-and-down after a miss scores birdie. The
post-hole reveal includes both the tee-lie roll and the separate drive-at-green
roll.

### Par 5

Baseline by route:

| Route | Mean | Eagle | Birdie | Par | Bogey | Double+ |
|---|---:|---:|---:|---:|---:|---:|
| Reached in two | -0.69 | 15.3% | 48.7% | 27.6% | 6.7% | 1.7% |
| Laid up | +0.10 | 0.2% | 24.9% | 48.0% | 20.3% | 6.7% |

The reach test categorically rejected rough and trouble regardless of remaining
yardage. Every aggressive second from those lies became the same automatic
layup/wedge route, which explains why the choice felt unrewarded. The visible
layup did not insert a phantom scoring stroke—the regulation offset was correct—
but the categorical eligibility rule and “failed reach” presentation obscured
that fact. A safe scramble also retained intrinsic blow-up weight, so a real
one-stroke hazard penalty could turn a conservative finish into triple.

The final reach thresholds are 285 yards from Dialed, 265 from Fairway, 240
from Rough, and 210 from Trouble. Rough and heroic Trouble attempts use the
long-shot go-for-green proximity penalty; they gain the early-green scoring
offset only when remaining yardage actually qualifies. Punch now has no
intrinsic blow-up/disaster result. Table-driven tests prove the trouble →
recovery stroke two → wedge stroke three → one-putt birdie / two-putt par
ledger, plus greenside-in-two up-and-down birdie.

### Career movement

Production Candidate H uses two active-season percentiles, a 65% rolling
promotion threshold, a 58% floor in each season, and 32% relegation. With
four events of four rounds each, the player supplies 32 rounds of evidence
before the earliest possible promotion.

Current 150,000-season baseline:

| Ability | Pro by S10 | Pro by S25 | Median seasons to Pro | Relegations/season | Pro survival |
|---|---:|---:|---:|---:|---:|
| Rusty | 1.0% | 2.5% | 146 | 0.025 | 41.7% |
| Scratch | 24.5% | 60.5% | 20 | 0.110 | 75.6% |
| Ace | 47.0% | 91.5% | 11 | 0.103 | 85.2% |

This confirms a practical ceiling for the weak/casual cohort and a very large
play commitment even for Scratch. The issue is not only random confirmation:
the simulated human ability is fixed while tier-scaled bot fields improve.

## Candidate movement result

Simulator-only candidate:

- Local promotion: 60% two-season average with a 52% floor.
- Challenger promotion: 62% average with a 54% floor.
- Relegation: 28%.
- Pro has no further promotion.

Reproduction:

```sh
npm run career:simulate:player-paced -- --seed career-fairness-v1 --bank-samples 256 --careers-per-ability 200 --seasons 250 --movement-candidate --output /tmp/career-movement-candidate-full.md
```

| Ability | Pro by S10 | Pro by S25 | Median seasons to Pro | Relegations/season | Pro survival |
|---|---:|---:|---:|---:|---:|
| Rusty | 5.0% | 11.0% | 94 | 0.047 | 50.7% |
| Scratch | 42.0% | 80.0% | 13 | 0.116 | 80.5% |
| Ace | 64.0% | 97.0% | 9 | 0.083 | 89.5% |

The candidate improves a strategic Scratch/Ace career without making Pro
automatic, but it does not remove the Rusty ceiling. It must not become a
production formula by itself; a bounded, visible player-progression candidate
still needs simulation.

## Career progression comparison

Three small models were considered:

1. Legacy-tier boosts. Easy to explain, but mostly rewards volume and lets
   grinding—not strategy—max the player.
2. Hidden form/rubber-banding. It can smooth results, but violates transparency
   and deterministic fairness.
3. Visible development plus performance-only mastery. Completion establishes a
   bounded foundation; strong finishes are required to reach the cap. This is
   the recommended model.

The simulator uses score-bank ability bands as a coarse proxy while the
production design would expose four attributes (Driving, Approach, Short Game,
Putting), each capped at five ranks. A rank would make a small, displayed shift
within that stage's real probability table; it would never add/subtract a
stroke, guarantee an outcome, or alter a result after the seed resolves.

Candidate rules used for the progression-ceiling test:

- One development point for season completion.
- One additional point for a top-half season.
- One additional point for a top-quartile season.
- Scratch foundation at 10 development points.
- Ace/mastery proxy only after 20 performance points earned while Scratch+.
- No regression and no level above Ace.

The completion floor therefore lets a struggling player improve to a competitive
foundation, while grinding bottom-half finishes can never reach the maximum.

Reproduction:

```sh
npm run career:simulate:player-paced -- --seed career-fairness-v1 --bank-samples 256 --careers-per-ability 200 --seasons 250 --movement-candidate --skill-progression --output /tmp/career-skill-candidate-full.md
```

| Starting ability | Pro by S10 | Pro by S25 | Median seasons to Pro | Relegations/season | Pro survival |
|---|---:|---:|---:|---:|---:|
| Rusty | 7.0% | 68.0% | 18 | 0.083 | 89.0% |
| Scratch | 46.5% | 81.0% | 11 | 0.084 | 89.3% |
| Ace | 66.5% | 95.0% | 8 | 0.081 | 89.8% |

Compared with the no-progression baseline, Rusty median time to Pro falls from
146 to 18 seasons and the chance of reaching Pro by Season 25 rises from 2.5%
to 68%. Scratch and Ace remain separated, and Pro is not automatic by Season 10.
This clears the practical-ceiling test as a design candidate. It does not yet
authorize production probability modifiers: exact per-rank stage multipliers,
formula-version migration, and UI allocation/re-spec rules still require a
separate reviewed implementation.

The final 500-season candidate run covers 600 independent personal fields and
300,000 settled seasons. Personal Career fields are fixed at twenty competitors,
so a shared 500-player field spike is not applicable to this player-paced model.
The report also records rating overlap explicitly: the 75th-percentile
Challenger season rating is compared with the 25th-percentile Pro rating to
confirm that strong Challenger performance can still overlap weak Pro
performance rather than tier identity making Pro untouchable.

## Classic ruleset reconstruction

Repository history identifies commit `829dc5d` as the launch implementation.
It used one decision per hole and resolved directly from launch
`BASE_WEIGHTS` plus difficulty scaling. That behavior is reconstructable and
can support an authentic Classic ruleset. It is not a cosmetic difficulty
label: it has a different one-click hole model and must be persisted as a
versioned round ruleset. The safest first surface is Unlimited practice;
official Daily, Tournament, Challenge, and Career records must remain on their
pinned rulesets.

## Final engine calibration

The accepted casual target was explicitly moved from 26–34% to 30–37% smart
break-par frequency. This is a deliberate product adjustment in response to
the ordinary-lag, safe-recovery, and score-shape feedback—not a silent widening
after a random regression.

| Policy | Break par | Mean | Median | Std dev | Three-putt | Blow-up |
|---|---:|---:|---:|---:|---:|---:|
| Naive | 31.4% | +1.3 | +1 | 3.47 | 7% | 5.0% |
| Always aggressive | 29.3% | +1.8 | +2 | 4.10 | 16% | 8.4% |
| Good | 35.9% | +0.9 | +1 | 3.68 | 5% | 5.7% |
| Skilled | 36.0% | +1.0 | +1 | 3.80 | 6% | 6.2% |

Skilled beats Naive by 4.7 points and always-aggressive by 6.7 points. Shared
tournament field spread, per-course means, and neutral-seed selection all remain
inside their existing regression bands.

## Browser QA

The local app was exercised on Riviera at mobile and desktop widths. Verified:

- a 37-foot lag-putt decision and matching odds reveal;
- the 315-yard tenth showing “Drive the green,” skipping the fictional
  approach, and scoring a two-putt as birdie;
- par-5 fairway and rough positions matching the next-stage copy;
- a rough attack reaching the green in two and a two-putt scoring birdie;
- both safe and aggressive second shots from trouble;
- a safe trouble recovery producing one recovery stroke, a wedge third, and no
  phantom stroke;
- an 11-foot lag putt and a 50-foot lag putt;
- an early par-5 greenside miss explicitly reading “up & down for birdie,” with
  all three short-game choices using the same birdie context;
- Career onboarding/dashboard at mobile and desktop widths;
- no horizontal overflow or browser-console errors.

All temporary browser rounds were deleted and the development server was
stopped.

## Implementation boundary

This pass implements the putting, drivable-par-4, par-5, odds-reveal, and
scoring-copy corrections. It does not yet implement player attributes,
candidate Career movement thresholds, or a difficulty selector. The Career
candidate must first receive exact per-rank probability modifiers, a pinned
formula version, deterministic existing-profile defaults, and UI/re-spec rules.
Classic is reconstructable from launch commit `829dc5d`, but must be a persisted
round ruleset and should begin in Unlimited practice; it must not share official
Daily, Tournament, Challenge, Career, streak, record, or trophy eligibility.
