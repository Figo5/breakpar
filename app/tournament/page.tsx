import Link from "next/link";
import { SignedIn, SignedOut, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import { relativeLabel } from "@/lib/scoring";
import { getCurrentUser } from "@/lib/user";
import { getActiveTournament, myTournamentProgress, standings, lastCompletedChampion } from "@/lib/tournament.server";
import { TournamentActions } from "./TournamentActions";

export const dynamic = "force-dynamic";

// Weekly Tournament page. Self-activating: the phase is derived from the clock,
// so this page shows "starts Monday" before the start, live rounds during the
// week, the cut, and the final. Accounts only to enter/play.
export default async function TournamentPage() {
  const user = await getCurrentUser();
  const isAccount = !!user?.clerkId;

  // Signed-in accounts get their progress; everyone else gets the public view.
  const data = isAccount
    ? await myTournamentProgress(user!.id, new Date(), user!.username)
    : null;
  const view = data?.tournament ?? (await getActiveTournament(new Date(), user?.username));
  const me = data?.me ?? null;
  const board = view ? await standings(view.id, view.par, user?.id) : [];

  // Last week's champion — for the results banner shown while the next event is
  // upcoming/live. Hidden when the active event IS the one just completed (its
  // own champion banner covers that case, avoiding a duplicate).
  const prior = await lastCompletedChampion(new Date());
  const showPrior =
    prior !== null && !(view?.phase === "complete" && view?.champion?.username === prior.username);

  return (
    <div className="screen">
      <div className="topbar">
        <Link href="/" className="eyebrow eyebrow-back">← Back to today</Link>
        <div className="acct">
          <SignedIn><UserButton afterSignOutUrl="/" /></SignedIn>
          <SignedOut>
            <SignInButton mode="modal"><button className="acct-link">Sign in</button></SignInButton>
            <SignUpButton mode="modal"><button className="acct-link">Sign up</button></SignUpButton>
          </SignedOut>
        </div>
      </div>

      {!view ? (
        <div className="profile-empty">No tournament scheduled yet — check back soon.</div>
      ) : (
        <>
          {/* Last week's champion — the Monday results / "who won" banner. */}
          {showPrior && prior && (
            <div className="tourn-last-champion">
              <div className="tourn-last-champion-head">
                <span>{prior.tournamentName} — Champion</span>
              </div>
              <div className="tourn-last-champion-body">
                <span className="tourn-last-champion-name">{prior.username}</span>
                <span className="tourn-last-champion-score">{relativeLabel(prior.cumulativeToPar)}</span>
              </div>
            </div>
          )}

          <h1 className="wordmark" style={{ fontSize: "clamp(34px,10vw,50px)" }}>
            {view.name}
          </h1>
          <p className="tagline">
            {view.courseName} · Par {view.par} · one course, 4 rounds, top {view.cutPercent}% make the cut
          </p>

          {view.isPreview && (
            <div className="tourn-preview-badge">Preview mode — you can play all rounds before the public start</div>
          )}

          {/* Champion banner (once complete) */}
          {view.phase === "complete" && view.champion && (
            <div className="tourn-champion">
              <div className="tourn-champion-label">Champion</div>
              <div className="tourn-champion-name">{view.champion.username}</div>
              <div className="tourn-champion-score">{relativeLabel(view.champion.cumulativeToPar)}</div>
            </div>
          )}

          {/* Current cut line (during rounds 1-2) */}
          {view.phase === "round1_2" && view.cutLine !== null && (
            <div className="tourn-cutline">
              Cut line so far: <b>{relativeLabel(view.cutLine)}</b>
              <span className="tourn-cutline-sub"> · top {view.cutPercent}% (min {view.cutMin}) advance</span>
            </div>
          )}

          {/* Phase banner + countdown (client for the live tick) + join/play actions */}
          <TournamentActions
            view={view}
            me={me}
            isAccount={isAccount}
          />

          {/* Standings */}
          <div className="tourn-section-h">Standings {board.length > 0 ? `· ${board.length}` : ""}</div>
          {board.length === 0 ? (
            <div className="tourn-empty">No scores yet. Be the first to tee off.</div>
          ) : (
            <div className="tourn-board">
              {board.map((row, i) => (
                <div className={`tourn-row ${me && row.isMe ? "me" : ""} ${row.withdrawn ? "wd" : ""}`} key={row.entryId}>
                  <span className="tourn-rank">{row.withdrawn ? "—" : i + 1}</span>
                  <span className="tourn-name">
                    {row.username}
                    {row.madeCut === true && <span className="tourn-tag cut">CUT ✓</span>}
                    {row.withdrawn && <span className="tourn-tag wd">WD</span>}
                  </span>
                  <span className="tourn-thru">{row.roundsComplete}/4</span>
                  <span className="tourn-score">{row.withdrawn ? "—" : relativeLabel(row.cumulativeToPar)}</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ marginTop: 20 }}>
            <Link href="/" className="cta">Back to today</Link>
          </div>
        </>
      )}
    </div>
  );
}