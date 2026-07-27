import Link from "next/link";

export function CareerChrome({
  eyebrow,
  children,
}: {
  eyebrow: string;
  children: React.ReactNode;
}) {
  return (
    <div className="screen career-screen">
      <div className="topbar">
        <Link href="/career" className="eyebrow eyebrow-back">
          {eyebrow === "Career Mode" ? "Career Mode" : "← Career Mode"}
        </Link>
        <Link href="/" className="acct-link">Today&apos;s game</Link>
      </div>
      {children}
    </div>
  );
}

export function CareerLoading({ label = "Loading your tour…" }: { label?: string }) {
  return (
    <div className="career-loading" role="status">
      <span className="career-loader" />
      {label}
    </div>
  );
}

export function CareerError({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) {
  return (
    <div className="career-empty">
      <b>Couldn&apos;t load Career Mode</b>
      <span>{message}</span>
      {retry && <button className="cta ghost" onClick={retry}>Try again</button>}
    </div>
  );
}

export function CareerStatePill({ state }: { state: string }) {
  return <span className={`career-state state-${state.toLowerCase()}`}>{state}</span>;
}
