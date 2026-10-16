-- CreateEnum
CREATE TYPE "TripTheme" AS ENUM ('SKI', 'BEACH', 'OUTDOORS', 'CITY', 'FOOD', 'EVENT', 'NONE');

-- AlterTable
ALTER TABLE "Trip" ADD COLUMN     "flyIntoAirport" TEXT,
ADD COLUMN     "flyOutOfAirport" TEXT,
ADD COLUMN     "theme" "TripTheme";

-- CreateTable
CREATE TABLE "TripStop" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE,
    "endDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TripStop_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TripStop_tripId_position_idx" ON "TripStop"("tripId", "position");

-- AddForeignKey
ALTER TABLE "TripStop" ADD CONSTRAINT "TripStop_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing trips keep working: a trip's single destination becomes its first stop, without dates.
INSERT INTO "TripStop" ("id", "tripId", "position", "name", "updatedAt")
SELECT 'stop_' || replace(gen_random_uuid()::text, '-', ''), "id", 0, btrim("destination"), CURRENT_TIMESTAMP
FROM "Trip"
WHERE "destination" IS NOT NULL AND btrim("destination") <> '';
