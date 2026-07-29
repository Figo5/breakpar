# Course sources — batch 12

Checked July 29, 2026. Break Par uses the listed championship or back-tee
routing. Every card was reconciled against its published OUT, IN, total yardage,
and par. Dogleg and hazard fields remain stylized yardage-book metadata, as
documented in `data/courses.ts`; they are not licensed aerial geometry.

| Course | Routing | OUT | IN | Total | Yardage / rating source | Stroke-index source |
| --- | --- | ---: | ---: | ---: | --- | --- |
| Prestonwood — SAS Composite | 2024 SAS Championship | 3,441 / 35 | 3,796 / 37 | 7,237 / 72 | PGA Tour official scorecard | **Derived from PGA Tour scoring difficulty; see below** |
| CCNC — Dogwood | Black | 3,639 / 36 | 3,662 / 36 | 7,301 / 72 | Golfify card; USGA championship total cross-check | Golfify men's SI |
| Kingsbarns | Championship | 3,529 / 36 | 3,683 / 36 | 7,212 / 72 | Golfify card | Golfify SI |
| Tobacco Road | Ripper | 3,134 / 35 | 3,423 / 36 | 6,557 / 71 | Club scorecard | Club SI |
| Tot Hill Farm | Black | 3,498 / 37 | 3,129 / 35 | 6,627 / 72 | Golfify card | Golfify SI |
| East Lake | 2025 Tour Championship | 3,715 / 35 | 3,725 / 35 | 7,440 / 70 | PGA Tour official scorecard | **Derived from PGA Tour scoring difficulty; see below** |
| Valhalla | 2024 PGA Championship | 3,724 / 35 | 3,885 / 36 | 7,609 / 71 | PGA Tour official scorecard | **Derived from PGA Tour scoring difficulty; see below** |
| Oakland Hills — South | 2024 U.S. Junior Amateur | 3,612 / 35 | 3,691 / 35 | 7,303 / 70 | USGA championship card | Golfify men's SI |
| Inverness Club | Black | 3,934 / 35 | 3,796 / 36 | 7,730 / 71 | Golfify card | Golfify SI |
| Olympic Club — Lake | 2025 U.S. Amateur | 3,615 / 34 | 3,599 / 36 | 7,214 / 70 | USGA championship card | Golfify Lake men's SI |

## Derived stroke indexes

The PGA Tour championship cards for Prestonwood, East Lake, and Valhalla do not
publish a handicap row. For those three courses, the official PGA Tour
hole-difficulty order was converted to Break Par's established handicap
convention: rank each nine independently, assign odd indexes to the front and
even indexes to the back, and preserve hole order for an exact scoring-rank tie.
This yields:

- Prestonwood:
  `1, 13, 9, 7, 3, 11, 17, 15, 5 / 4, 2, 12, 8, 10, 6, 14, 18, 16`
- East Lake:
  `1, 7, 13, 3, 11, 17, 9, 15, 5 / 12, 8, 16, 14, 2, 4, 6, 10, 18`
- Valhalla:
  `5, 3, 9, 15, 7, 1, 17, 13, 11 / 16, 10, 6, 14, 2, 8, 4, 12, 18`

The other seven courses use a published men's SI row unchanged. All ten rows
are complete permutations of 1–18 and satisfy the catalogue's opposite-parity
nines invariant.

## Ratings and routing notes

- Prestonwood's event is a composite: tournament holes 1–9 use Highlands
  1–3 and 13–18; tournament holes 10–18 use Meadows 1–4, 13, and 15–18.
  The official event card does not publish a rating/slope, so Break Par uses a
  documented house estimate of 75.5/142 for the 7,237-yard composite.
- East Lake, Valhalla, and Olympic Club use event yardages but their available
  member-card rating/slope: 76.0/142, 76.4/148, and 74.7/138 respectively.
- Prestonwood tournament hole 8 is Highlands 17. Its signature explicitly says
  “Island Green,” so the general par-3 island renderer activates there.
- No other new par-3 water signature contains “Island”; guarded-water holes
  therefore keep a connected fairway/tee presentation.
- All ten courses are regular courses, not Career crown jewels. They are
  available in Unlimited and Career through the catalogue and are explicitly
  included in the weekly tournament rotation.

## Sources

- PGA Tour, 2024 SAS Championship official scorecard:
  https://pgatourmedia.pgatourhq.com/static-assets/page/files/tours/2024/pgatourchampions/saschampionship/scorecards/scorecard.pdf
- PGA Tour, SAS Championship course map:
  https://saschampionship.com/coursemap/
- PGA Tour, SAS Championship course stats:
  https://www.pgatour.com/pgatour-champions/tournaments/2025/sas-championship/S2025609/course-stats
- Golfify, CCNC Dogwood:
  https://www.golfify.io/courses/country-club-of-north-carolina-dogwood
- USGA, 2021 U.S. Junior Amateur fast facts:
  https://www.usga.org/content/usga/home-page/championships/2021/2021-u-s--junior-amateur-fast-facts.html
- Golfify, Kingsbarns:
  https://www.golfify.io/courses/kingsbarns-golf-links
- Tobacco Road official scorecard:
  https://storage.googleapis.com/wzukusers/user-28813495/documents/5b8eaaaadc268atb2PHE/Tobacco%20Road%20Golf%20Club%20Scorecard.pdf
- Golfify, Tot Hill Farm:
  https://www.golfify.io/courses/tot-hill-farm-golf-club
- PGA Tour, 2025 Tour Championship official scorecard:
  https://pgatourmedia.pgatourhq.com/static-assets/page/files/tours/2025/pgatour/tourchampionship/scorecards/Scorecard.pdf
- PGA Tour, 2025 East Lake course stats:
  https://www.pgatour.com/tournaments/2025/tour-championship/R2025060/course-stats
- PGA Tour, 2024 PGA Championship official scorecard:
  https://pgatourmedia.pgatourhq.com/static-assets/page/files/tours/2024/pgatour/pgachampionship/scorecards/Scorecard.pdf
- PGA Tour, 2024 Valhalla course stats:
  https://www.pgatour.com/tournaments/2024/pga-championship/R2024033/course-stats
- USGA, 2024 U.S. Junior Amateur fast facts:
  https://championships.usga.org/usjunioramateur/2024/articles/fast-facts-for-2024-u-s--junior-amateur.html
- Golfify, Oakland Hills South:
  https://www.golfify.io/courses/oakland-hills-country-club-south
- Golfify, Inverness:
  https://www.golfify.io/courses/inverness-club
- USGA, 2025 U.S. Amateur fast facts:
  https://championships.usga.org/usamateur/2025/articles/fast-facts-for-2025-us-amateur.html
- Golfify, Olympic Club Lake:
  https://www.golfify.io/courses/the-olympic-club-lake
