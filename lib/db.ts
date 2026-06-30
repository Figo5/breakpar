import { PrismaClient } from "@prisma/client";

// Reuse the client across hot reloads in dev to avoid exhausting connections.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  return new PrismaClient({ log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"] });
}

// LAZY construction. `new PrismaClient()` eagerly validates env("DATABASE_URL"),
// so building it at import time makes `next build` fail when it evaluates page
// modules without the DB env present (the build never connects, but Prisma
// still validates). We defer construction to the first actual DB access via a
// Proxy — so build/page-data collection touches the module without a DB URL,
// and the client is only created on a real request (runtime, where the env is
// set). Same cached singleton; in dev it's reused across hot reloads.
let client: PrismaClient | undefined = globalForPrisma.prisma;

function getClient(): PrismaClient {
  if (!client) {
    client = createClient();
    if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = client;
  }
  return client;
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const c = getClient();
    const value = Reflect.get(c, prop, receiver);
    return typeof value === "function" ? value.bind(c) : value;
  },
});
