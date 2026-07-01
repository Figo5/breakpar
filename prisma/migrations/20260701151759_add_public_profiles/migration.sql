-- AlterTable
ALTER TABLE "User" ADD COLUMN     "featuredTrophies" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "profilePublic" BOOLEAN NOT NULL DEFAULT true;

-- Partial unique index: account usernames (clerkId set) must be unique so
-- /u/[username] resolves to exactly one account. Guests (clerkId null) keep
-- sharing display names, so they're excluded from the constraint.
CREATE UNIQUE INDEX "User_username_account_key" ON "User"("username") WHERE "clerkId" IS NOT NULL;
