/**
 * Changelog entries. Newest first.
 *
 * To add an entry when you ship: add an object to the TOP of this array.
 * `date` is an ISO date string (YYYY-MM-DD) and is rendered as e.g. "Jul 9, 2026".
 * `items` are plain factual statements — what changed, not marketing.
 *
 * Keep it dry: "Added X." / "Fixed Y." Users can read the tone elsewhere.
 */

export interface ChangelogEntry {
  date: string; // ISO YYYY-MM-DD
  items: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: "2026-07-10",
    items: [
      "Added 5 courses: The Country Club (Brookline), Los Angeles Country Club, National Golf Links of America, Muirfield, and Royal Melbourne. The roster is now 33.",
    ],
  },
  {
    date: "2026-07-09",
    items: [
      "Weekly tournaments now rotate courses each week. Previously every tournament used the same course.",
      "Added the ability to hand-pick a course for specific tournament weeks.",
      "Fixed the tournament page showing the wrong course name when the tournament course differed from the default.",
    ],
  },
  {
    date: "2026-07-08",
    items: [
      "The post-hole odds reveal now covers every decision, not just the tee shot: approach, putting, and short game.",
      "Putting odds show your chance of a one-putt, two-putt, and three-putt for each option (Lag, Roll it, Charge).",
      "Added 5 courses: Payne's Valley, Bandon Dunes, Chambers Bay, Arcadia Bluffs, Pacific Dunes. The roster is now 28.",
    ],
  },
  {
    date: "2026-07-07",
    items: [
      "Added a live cut line to the tournament page during rounds 1 and 2, showing the score currently at the cut.",
      "Added a back link at the top of the tournament page.",
    ],
  },
  {
    date: "2026-07-06",
    items: [
      "Weekly tournaments launched. One course, four rounds, cumulative score against par, a cut after two rounds, and a trophy for the winner.",
      "Everyone in a tournament plays identical hole conditions each round.",
      "Tournament rounds are excluded from your streak, the daily leaderboard, trophies, and the Hall of Fame.",
      "Added a Tournament Champion trophy.",
      "Fixed the home page tournament card showing a stale countdown after a tournament went live.",
    ],
  },
  {
    date: "2026-07-05",
    items: [
      "Added an odds reveal after each hole, showing the tee-shot probabilities you faced for each decision.",
      "Added a How It Works page explaining scoring, decisions, and how variance works.",
    ],
  },
  {
    date: "2026-07-03",
    items: [
      "Added 5 courses: Aronimink, Quail Hollow, Harbour Town, Trump Doral, Royal Birkdale.",
    ],
  },
  {
    date: "2026-07-02",
    items: [
      "Added challenges. Send a head-to-head challenge to a friend; both players face identical hole conditions, one attempt each.",
      "Added followers, and the ability to follow back from a profile.",
      "Added a standalone leaderboard page.",
      "The layout now widens on tablet and desktop.",
      "Fixed username and avatar overlapping in friend rows.",
    ],
  },
  {
    date: "2026-07-01",
    items: [
      "Added friends. Search for players, follow them, and see their rounds.",
      "Added public profiles at /u/[username], with a privacy setting.",
      "Added profile images.",
    ],
  },
  {
    date: "2026-06-30",
    items: [
      "Added trophies for milestones and achievements.",
      "Added a Hall of Fame with course records.",
      "Added the ability to link an X (Twitter) handle to your profile.",
    ],
  },
  {
    date: "2026-06-26",
    items: [
      "Break Par launched. One real course every day, 18 holes, roughly two minutes to play.",
      "Every shot is a decision between safe, normal, and aggressive play, with real probabilities behind each.",
      "Added daily streaks and a daily leaderboard.",
      "Added an unlimited practice mode that does not affect ranked stats.",
      "Added in-game feedback.",
    ],
  },
];
