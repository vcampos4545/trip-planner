-- CreateTable
CREATE TABLE "FlightSearchCache" (
    "key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FlightSearchCache_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "FlightSearchCache_expiresAt_idx" ON "FlightSearchCache"("expiresAt");

