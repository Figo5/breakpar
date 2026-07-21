# Course sources — batch 11 (Royal County Down, Ballybunion, Sand Hills, Turnberry)

Checked July 21, 2026. Yardages are the championship-tee routings used by Break Par; stroke indexes are the published men's indexes paired with that routing, except where noted. The map metadata remains a stylized interpretation, as documented in `data/courses.ts`.

| Course | Yardage / par | Yardage and routing source | Stroke-index source |
| --- | ---: | --- | --- |
| Royal County Down — Championship | 7,183 / 71 | BlueGolf "Tees" tab, Championship tee | BlueGolf published men's HCP row |
| Ballybunion — Old Course | 6,802 / 71 | BlueGolf "Tees" tab, Blue tee | BlueGolf published men's HCP row |
| Sand Hills Golf Club | 7,073 / 71 | BlueGolf "Tees" tab, Black tee | **Derived** — see below |
| Turnberry — Ailsa | 7,489 / 71 | BlueGolf "Tees" tab, Black tee | BlueGolf published men's HCP row |

## Notes

**All four cards verified nine-by-nine** against their published OUT/IN subtotals, so none is a mis-transcription:

| Course | OUT | IN |
| --- | --- | --- |
| Royal County Down | 3,579 / 35 | 3,604 / 36 |
| Ballybunion | 3,625 / 36 | 3,177 / 35 |
| Sand Hills | 3,370 / 35 | 3,703 / 36 |
| Turnberry | 3,557 / 35 | 3,932 / 36 |

**Sand Hills' published handicap row is placeholder data and was NOT used.** BlueGolf lists it as `1, 2, 3, … 18` in hole order — sequential, in routing order, which is the known signature of an unpopulated index column rather than real difficulty ranking. Indexes were derived instead: holes ranked by yardage relative to par standard (with par 4s weighted as the hardest class), then split odd-front / even-back per the house convention. The result is sane — the 485-yard par-4 4th takes stroke index 1 and the 283-yard drivable 7th takes 17. Every other course in this batch uses its published index row unchanged, and all three of those already satisfied the one-parity-per-nine convention untouched (Turnberry is even-front/odd-front reversed, which the invariant permits).

**Two course ratings were not taken from BlueGolf.** It lists Sand Hills at 70.0/110 and Turnberry at 70.0/113 — implausible for a 7,073-yard Coore & Crenshaw course and a 7,489-yard Open rota links respectively, and suspiciously round. These read as defaults for courses without a filed US rating. House-style estimates were used instead, calibrated against comparable courses already on the roster (Royal Troon 76.3/144, Carnoustie 75.2/139, Royal Dornoch 75.5/138): Sand Hills 74.0/130, Turnberry 75.5/141. Royal County Down (75.0/142) and Ballybunion (74.5/131) use the published figures, which are plausible.

**Royal County Down is seeded as a CROWN JEWEL** — reserved alongside Augusta, St Andrews, Pinehurst and Royal Birkdale, so it never enters the regular weekly rotation and only appears when hand-picked for a major week. The other three are held out of the pool pending a separate placement decision, like batch 9 and Congressional.

**Region mapping.** `Ireland` and `Nebraska` were added to `REGION_BY_PLACE` in `lib/courseFacets.ts` — Ballybunion is the roster's first Republic of Ireland course and Sand Hills its first Nebraska one. Without those entries both would have fallen to the `international` catch-all, which is the designed fallback but the wrong bucket.

**Signature holes** follow documented history: Royal County Down's 9th is the blind drive to the most photographed view in golf beneath the Mountains of Mourne; Ballybunion's 11th is the cliff-top par 4 Tom Watson singled out as one of the game's greatest; Turnberry's 9th is Bruce's Castle, whose championship tee sits on the rocks by the lighthouse, and its closing stretch is where the 1977 Duel in the Sun was settled. Sand Hills' callouts are drawn from its own card (the drivable 283-yard 7th, the 612-yard 16th) rather than from named-hole lore.

Source links:

- https://course.bluegolf.com/bluegolf/course/course/royalcountydown/detailedscorecard.htm
- https://course.bluegolf.com/bluegolf/course/course/ballybuniongc/detailedscorecard.htm
- https://course.bluegolf.com/bluegolf/course/course/sandhillsgc/detailedscorecard.htm
- https://course.bluegolf.com/bluegolf/course/course/turnberryailsa/detailedscorecard.htm
