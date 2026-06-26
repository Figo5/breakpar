-- AlterTable
ALTER TABLE "Feedback" ADD COLUMN "resolved" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Feedback_resolved_createdAt_idx" ON "Feedback"("resolved", "createdAt");
