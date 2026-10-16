-- Full invitation flow: email-bound invitations, resend and acceptance tracking, and the
-- organizer setting that lets members invite people.

ALTER TYPE "ActivityType" ADD VALUE 'INVITE_SENT';
ALTER TYPE "ActivityType" ADD VALUE 'INVITE_ACCEPTED';
ALTER TYPE "ActivityType" ADD VALUE 'INVITE_SETTINGS_CHANGED';

-- AlterTable
ALTER TABLE "Trip" ADD COLUMN     "membersCanInvite" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "TripInvitation" ADD COLUMN     "acceptedAt" TIMESTAMP(3),
ADD COLUMN     "acceptedById" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "lastSentAt" TIMESTAMP(3),
ADD COLUMN     "sendCount" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "TripInvitation_tripId_email_idx" ON "TripInvitation"("tripId", "email");

-- AddForeignKey
ALTER TABLE "TripInvitation" ADD CONSTRAINT "TripInvitation_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

