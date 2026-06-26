import { clerkMiddleware } from "@clerk/nextjs/server";

// No routes are force-protected anymore: anyone can play instantly as a guest
// (an anonymous identity is minted on first round start). clerkMiddleware still
// runs so that auth() resolves a real session when the player IS signed in, and
// so a guest can "upgrade" their account by signing in later.
export default clerkMiddleware();

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)", "/(api|trpc)(.*)"],
};
