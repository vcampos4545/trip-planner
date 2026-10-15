-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('ORGANIZER', 'MEMBER');

-- CreateEnum
CREATE TYPE "TripStage" AS ENUM ('DREAMING', 'PLANNING', 'BOOKING', 'READY', 'COMPLETED');

-- CreateEnum
CREATE TYPE "TripStartMode" AS ENUM ('KNOWN_DESTINATION', 'VIBE', 'DISCOVER', 'MANUAL');

-- CreateEnum
CREATE TYPE "DateFlexibility" AS ENUM ('UNKNOWN', 'FIXED', 'FLEXIBLE');

-- CreateEnum
CREATE TYPE "BudgetBasis" AS ENUM ('UNKNOWN', 'PER_PERSON', 'TOTAL');

-- CreateEnum
CREATE TYPE "BudgetComponent" AS ENUM ('FLIGHTS', 'LODGING', 'ACTIVITIES', 'FOOD', 'LOCAL_TRANSPORT');

-- CreateEnum
CREATE TYPE "ArrangementStatus" AS ENUM ('UNKNOWN', 'NOT_NEEDED', 'NEEDED', 'IN_PROGRESS', 'BOOKED');

-- CreateEnum
CREATE TYPE "PreferenceKind" AS ENUM ('INTEREST', 'TRAVEL_STYLE', 'ACCESSIBILITY', 'DIETARY', 'LANGUAGE', 'LODGING', 'TRANSPORT', 'ACTIVITY', 'BUDGET', 'OTHER');

-- CreateEnum
CREATE TYPE "PreferenceStrength" AS ENUM ('REQUIREMENT', 'PREFERENCE');

-- CreateEnum
CREATE TYPE "RecordOrigin" AS ENUM ('USER', 'ATLAS', 'RESEARCH_PROVIDER', 'SAMPLE_DATA');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('USER', 'ASSISTANT', 'NOTICE');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "OptionCategory" AS ENUM ('DESTINATION', 'LODGING', 'FLIGHT', 'TRANSPORT', 'ACTIVITY', 'FOOD', 'OTHER');

-- CreateEnum
CREATE TYPE "OptionStatus" AS ENUM ('SUGGESTED', 'SHORTLISTED', 'APPROVED', 'BOOKED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DecisionStatus" AS ENUM ('OPEN', 'RESOLVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('SUGGESTED', 'OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('SUGGESTED', 'PLANNED', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EventKind" AS ENUM ('ACTIVITY', 'MEAL', 'TRANSFER', 'FLIGHT', 'LODGING', 'FREE_TIME', 'OTHER');

-- CreateEnum
CREATE TYPE "BookingCategory" AS ENUM ('FLIGHT', 'ACCOMMODATION', 'GROUND_TRANSPORT', 'ACTIVITY', 'OTHER');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PLANNED', 'BOOKED', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CostSplit" AS ENUM ('SHARED_EQUALLY', 'PER_PERSON', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ParticipantStatus" AS ENUM ('CONSIDERING', 'BOOKED');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('TRIP_CREATED', 'TRIP_UPDATED', 'MEMBER_JOINED', 'MEMBER_LEFT', 'MEMBER_REMOVED', 'MEMBER_ROLE_CHANGED', 'INVITE_CREATED', 'INVITE_REVOKED', 'PREFERENCE_ADDED', 'PREFERENCE_REMOVED', 'PROPOSAL_CREATED', 'PROPOSAL_ACCEPTED', 'PROPOSAL_REJECTED', 'OPTION_ADDED', 'OPTION_UPDATED', 'OPTION_STATUS_CHANGED', 'OPTION_NOTE_ADDED', 'OPTION_REMOVED', 'DECISION_CREATED', 'VOTE_CAST', 'DECISION_RESOLVED', 'DECISION_CANCELLED', 'TASK_CREATED', 'TASK_SUGGESTED', 'TASK_UPDATED', 'TASK_COMPLETED', 'TASK_REMOVED', 'EVENT_ADDED', 'EVENT_SUGGESTED', 'EVENT_UPDATED', 'EVENT_REMOVED', 'BOOKING_ADDED', 'BOOKING_UPDATED', 'BOOKING_CONFIRMED', 'BOOKING_REMOVED', 'SUGGESTION_ACCEPTED', 'SUGGESTION_DISMISSED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "Trip" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "stage" "TripStage" NOT NULL DEFAULT 'DREAMING',
    "startMode" "TripStartMode" NOT NULL,
    "destination" TEXT,
    "destinationConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "departureLocation" TEXT,
    "tripStyle" TEXT,
    "startDate" DATE,
    "endDate" DATE,
    "dateFlexibility" "DateFlexibility" NOT NULL DEFAULT 'UNKNOWN',
    "dateNotes" TEXT,
    "durationDays" INTEGER,
    "groupSize" INTEGER,
    "groupNotes" TEXT,
    "budgetAmount" DECIMAL(12,2),
    "budgetCurrency" CHAR(3),
    "budgetBasis" "BudgetBasis" NOT NULL DEFAULT 'UNKNOWN',
    "budgetIncludes" "BudgetComponent"[],
    "budgetNotes" TEXT,
    "flightsStatus" "ArrangementStatus" NOT NULL DEFAULT 'UNKNOWN',
    "lodgingStatus" "ArrangementStatus" NOT NULL DEFAULT 'UNKNOWN',
    "localTransportStatus" "ArrangementStatus" NOT NULL DEFAULT 'UNKNOWN',
    "activitiesStatus" "ArrangementStatus" NOT NULL DEFAULT 'UNKNOWN',
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Trip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripMember" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "MemberRole" NOT NULL DEFAULT 'MEMBER',
    "invitedById" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TripMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripInvitation" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "role" "MemberRole" NOT NULL DEFAULT 'MEMBER',
    "createdById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "maxUses" INTEGER,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TripInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripPreference" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "memberId" TEXT,
    "kind" "PreferenceKind" NOT NULL,
    "strength" "PreferenceStrength" NOT NULL DEFAULT 'PREFERENCE',
    "description" TEXT NOT NULL,
    "origin" "RecordOrigin" NOT NULL DEFAULT 'USER',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TripPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tripId" TEXT,
    "startMode" "TripStartMode",
    "draft" JSONB,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "authorId" TEXT,
    "model" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripDetailProposal" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "conversationId" TEXT,
    "proposedById" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "status" "ProposalStatus" NOT NULL DEFAULT 'PENDING',
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TripDetailProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchOption" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "category" "OptionCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "url" TEXT,
    "sourceName" TEXT,
    "origin" "RecordOrigin" NOT NULL DEFAULT 'USER',
    "status" "OptionStatus" NOT NULL DEFAULT 'SUGGESTED',
    "priceAmount" DECIMAL(12,2),
    "priceCurrency" CHAR(3),
    "priceUnit" TEXT,
    "priceNote" TEXT,
    "locationName" TEXT,
    "address" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "rationale" TEXT,
    "retrievedAt" TIMESTAMP(3),
    "providerPayload" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OptionNote" (
    "id" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OptionNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Decision" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "DecisionStatus" NOT NULL DEFAULT 'OPEN',
    "chosenChoiceId" TEXT,
    "resolutionNote" TEXT,
    "createdById" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisionChoice" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "researchOptionId" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisionChoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vote" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "choiceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "dueDate" DATE,
    "assigneeMemberId" TEXT,
    "relatedOptionId" TEXT,
    "relatedBookingId" TEXT,
    "relatedEventId" TEXT,
    "origin" "RecordOrigin" NOT NULL DEFAULT 'USER',
    "completedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItineraryEvent" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" "EventKind" NOT NULL DEFAULT 'ACTIVITY',
    "status" "EventStatus" NOT NULL DEFAULT 'PLANNED',
    "date" DATE NOT NULL,
    "startMinute" INTEGER,
    "endMinute" INTEGER,
    "locationName" TEXT,
    "address" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "url" TEXT,
    "notes" TEXT,
    "rationale" TEXT,
    "caveats" TEXT,
    "researchOptionId" TEXT,
    "bookingId" TEXT,
    "origin" "RecordOrigin" NOT NULL DEFAULT 'USER',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItineraryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "category" "BookingCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "provider" TEXT,
    "url" TEXT,
    "reference" TEXT,
    "status" "BookingStatus" NOT NULL DEFAULT 'PLANNED',
    "startDate" DATE,
    "startMinute" INTEGER,
    "endDate" DATE,
    "endMinute" INTEGER,
    "fromLocation" TEXT,
    "toLocation" TEXT,
    "locationName" TEXT,
    "address" TEXT,
    "costAmount" DECIMAL(12,2),
    "currency" CHAR(3),
    "costIsEstimate" BOOLEAN NOT NULL DEFAULT true,
    "costSplit" "CostSplit" NOT NULL DEFAULT 'SHARED_EQUALLY',
    "notes" TEXT,
    "researchOptionId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingParticipant" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "status" "ParticipantStatus" NOT NULL DEFAULT 'BOOKED',
    "shareAmount" DECIMAL(12,2),
    "roomAssignment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "actorId" TEXT,
    "type" "ActivityType" NOT NULL,
    "summary" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE INDEX "Trip_createdById_idx" ON "Trip"("createdById");

-- CreateIndex
CREATE INDEX "TripMember_userId_idx" ON "TripMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TripMember_tripId_userId_key" ON "TripMember"("tripId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "TripInvitation_tokenHash_key" ON "TripInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "TripInvitation_tripId_createdAt_idx" ON "TripInvitation"("tripId", "createdAt");

-- CreateIndex
CREATE INDEX "TripPreference_tripId_idx" ON "TripPreference"("tripId");

-- CreateIndex
CREATE INDEX "Conversation_userId_lastMessageAt_idx" ON "Conversation"("userId", "lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_tripId_userId_key" ON "Conversation"("tripId", "userId");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "TripDetailProposal_tripId_status_idx" ON "TripDetailProposal"("tripId", "status");

-- CreateIndex
CREATE INDEX "ResearchOption_tripId_category_idx" ON "ResearchOption"("tripId", "category");

-- CreateIndex
CREATE INDEX "ResearchOption_tripId_status_idx" ON "ResearchOption"("tripId", "status");

-- CreateIndex
CREATE INDEX "OptionNote_optionId_createdAt_idx" ON "OptionNote"("optionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Decision_chosenChoiceId_key" ON "Decision"("chosenChoiceId");

-- CreateIndex
CREATE INDEX "Decision_tripId_status_idx" ON "Decision"("tripId", "status");

-- CreateIndex
CREATE INDEX "DecisionChoice_decisionId_idx" ON "DecisionChoice"("decisionId");

-- CreateIndex
CREATE INDEX "Vote_choiceId_idx" ON "Vote"("choiceId");

-- CreateIndex
CREATE UNIQUE INDEX "Vote_decisionId_userId_key" ON "Vote"("decisionId", "userId");

-- CreateIndex
CREATE INDEX "Task_tripId_status_idx" ON "Task"("tripId", "status");

-- CreateIndex
CREATE INDEX "Task_assigneeMemberId_idx" ON "Task"("assigneeMemberId");

-- CreateIndex
CREATE INDEX "ItineraryEvent_tripId_date_idx" ON "ItineraryEvent"("tripId", "date");

-- CreateIndex
CREATE INDEX "Booking_tripId_category_idx" ON "Booking"("tripId", "category");

-- CreateIndex
CREATE INDEX "BookingParticipant_memberId_idx" ON "BookingParticipant"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "BookingParticipant_bookingId_memberId_key" ON "BookingParticipant"("bookingId", "memberId");

-- CreateIndex
CREATE INDEX "ActivityLog_tripId_createdAt_idx" ON "ActivityLog"("tripId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripMember" ADD CONSTRAINT "TripMember_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripMember" ADD CONSTRAINT "TripMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripInvitation" ADD CONSTRAINT "TripInvitation_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripInvitation" ADD CONSTRAINT "TripInvitation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripInvitation" ADD CONSTRAINT "TripInvitation_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripPreference" ADD CONSTRAINT "TripPreference_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripPreference" ADD CONSTRAINT "TripPreference_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "TripMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripPreference" ADD CONSTRAINT "TripPreference_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripDetailProposal" ADD CONSTRAINT "TripDetailProposal_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripDetailProposal" ADD CONSTRAINT "TripDetailProposal_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripDetailProposal" ADD CONSTRAINT "TripDetailProposal_proposedById_fkey" FOREIGN KEY ("proposedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripDetailProposal" ADD CONSTRAINT "TripDetailProposal_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchOption" ADD CONSTRAINT "ResearchOption_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchOption" ADD CONSTRAINT "ResearchOption_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchOption" ADD CONSTRAINT "ResearchOption_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OptionNote" ADD CONSTRAINT "OptionNote_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "ResearchOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OptionNote" ADD CONSTRAINT "OptionNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_chosenChoiceId_fkey" FOREIGN KEY ("chosenChoiceId") REFERENCES "DecisionChoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionChoice" ADD CONSTRAINT "DecisionChoice_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "Decision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionChoice" ADD CONSTRAINT "DecisionChoice_researchOptionId_fkey" FOREIGN KEY ("researchOptionId") REFERENCES "ResearchOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "Decision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_choiceId_fkey" FOREIGN KEY ("choiceId") REFERENCES "DecisionChoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneeMemberId_fkey" FOREIGN KEY ("assigneeMemberId") REFERENCES "TripMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_relatedOptionId_fkey" FOREIGN KEY ("relatedOptionId") REFERENCES "ResearchOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_relatedBookingId_fkey" FOREIGN KEY ("relatedBookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_relatedEventId_fkey" FOREIGN KEY ("relatedEventId") REFERENCES "ItineraryEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItineraryEvent" ADD CONSTRAINT "ItineraryEvent_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItineraryEvent" ADD CONSTRAINT "ItineraryEvent_researchOptionId_fkey" FOREIGN KEY ("researchOptionId") REFERENCES "ResearchOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItineraryEvent" ADD CONSTRAINT "ItineraryEvent_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItineraryEvent" ADD CONSTRAINT "ItineraryEvent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItineraryEvent" ADD CONSTRAINT "ItineraryEvent_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_researchOptionId_fkey" FOREIGN KEY ("researchOptionId") REFERENCES "ResearchOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingParticipant" ADD CONSTRAINT "BookingParticipant_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingParticipant" ADD CONSTRAINT "BookingParticipant_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "TripMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
