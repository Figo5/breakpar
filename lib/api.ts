import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

/**
 * Wrap a route handler so infrastructure failures become clean responses
 * instead of leaking stack traces:
 *   - DB unreachable / not initialized  -> 503 db-unavailable
 *   - anything else uncaught            -> 500 server-error (logged)
 *
 * The console.error is structured so a log drain (Vercel, Sentry, Datadog) can
 * pick it up. Swap the console.error for your monitor's capture() in prod.
 */
export function route<C>(handler: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientInitializationError ||
        (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P1001")
      ) {
        console.error("[api] db-unavailable", { url: req.url });
        return NextResponse.json({ error: "db-unavailable" }, { status: 503 });
      }
      // Clerk's Backend API throttled us (429) even after the in-route retries in
      // lib/user, and there was no cached identity to fall back on. Transient —
      // signal the client to retry instead of a hard 500. (Duck-typed to mirror
      // isClerkRateLimited in lib/user.ts without importing Clerk's error internals.)
      if (
        typeof err === "object" &&
        err !== null &&
        (err as { clerkError?: unknown }).clerkError === true &&
        (err as { status?: unknown }).status === 429
      ) {
        console.error("[api] auth-unavailable (clerk 429)", { url: req.url });
        return NextResponse.json({ error: "auth-unavailable" }, { status: 503 });
      }
      console.error("[api] unhandled", { url: req.url, err });
      return NextResponse.json({ error: "server-error" }, { status: 500 });
    }
  };
}
