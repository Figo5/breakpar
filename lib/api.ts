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
      console.error("[api] unhandled", { url: req.url, err });
      return NextResponse.json({ error: "server-error" }, { status: 500 });
    }
  };
}
