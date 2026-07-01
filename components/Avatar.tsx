/**
 * Avatar — Clerk profile image when we have one, else the initial placeholder.
 * Server-safe (plain function). Uses a plain <img> (not next/image) so we don't
 * need to whitelist Clerk's image host in next.config; these are small and
 * cached by the browser. `referrerPolicy="no-referrer"` keeps Clerk's CDN happy.
 */
export function Avatar({
  src,
  name,
  className = "avatar",
}: {
  src: string | null | undefined;
  name: string | null | undefined;
  className?: string;
}) {
  const initial = (name?.[0] ?? "G").toUpperCase();
  return (
    <div className={className}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" referrerPolicy="no-referrer" />
      ) : (
        initial
      )}
    </div>
  );
}
