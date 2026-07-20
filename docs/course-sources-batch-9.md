# Course sources — batch 9 (New York / New Jersey)

Checked July 20, 2026. Yardages are the championship or longest published routing used by Break Par; stroke indexes are the published men's indexes paired with that routing. The map metadata remains a stylized interpretation, as documented in `data/courses.ts`.

| Course | Yardage / par | Yardage and routing source | Stroke-index source |
| --- | ---: | --- | --- |
| Baltusrol — Lower | 7,550 / 72 | BlueGolf "Tees" tab, VI (championship) tee | BlueGolf published men's HCP row |
| Quaker Ridge | 7,023 / 70 | BlueGolf "Tees" tab, Black tee | BlueGolf published men's HCP row |
| Fishers Island | 6,597 / 70 | BlueGolf "Tees" tab, Black tee | BlueGolf published men's HCP row |
| Oak Hill — East | 7,394 / 70 | 2023 PGA Championship official hole-by-hole card | Derived (see note) |
| Somerset Hills | 6,703 / 71 | BlueGolf "Tees" tab, Blue tee | BlueGolf published men's HCP row |

## Notes

**Fishers Island is par 70, not 72.** Some secondary summaries list par 72; the published card is 35/35 over 6,597 yards. `tests/courses.test.ts` pins 70.

**Oak Hill stroke indexes are derived.** A major-championship card carries no handicap row, so indexes were ranked by real hole difficulty (6th, a 503-yard par 4, is hardest at SI 1; 18th "Going Home" with its 20-yard-wide landing area at SI 2) and split odd-front / even-back to satisfy the house parity convention. Every other course in this batch uses its published index row unchanged.

**Stroke-index parity.** All four published index rows already satisfied the repo's one-parity-per-nine convention (front all odd, back all even) with no adjustment. No placeholder/sequential index rows were encountered in this batch.

**Fishers Island template map.** Signature blurbs follow The Fried Egg's hole-by-hole review: 2nd Redan, 4th Punch Bowl, 5th Biarritz, 9th Double Plateau, 11th Eden, 12th reverse-Redan (the par-4 Redan), 14th Cape, 16th Short. An earlier draft placed the par-4 Redan on the 17th by inference; the source corrects it to the 12th, and also places Punch Bowl at the 4th rather than the 5th.

**Somerset Hills "Dolomites" green** is documented in club literature but no reliable source pins it to a hole number, so no blurb claims it.

Source links:

- https://course.bluegolf.com/bluegolf/course/course/baltusrolgclower/detailedscorecard.htm
- https://course.bluegolf.com/bluegolf/course/course/quakerridgegc/detailedscorecard.htm
- https://course.bluegolf.com/bluegolf/course/course/fishersislandc/detailedscorecard.htm
- https://course.bluegolf.com/bluegolf/course/course/somersethillscc/detailedscorecard.htm
- https://thefriedegg.com/fishers-island-club/
