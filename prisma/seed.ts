/**
 * Sample data for local development. Everything created here is clearly marked:
 * the trip has isSample = true and a "[Sample]" title, options use the SAMPLE_DATA origin, and the
 * sample users have example.com emails (they cannot sign in).
 *
 * Usage:
 *   pnpm db:seed
 *   SEED_OWNER_EMAIL=you@gmail.com pnpm db:seed   # also adds you (after your first sign-in) as organizer
 *
 * Re-running replaces the previous sample trip.
 */
import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const date = (value: string) => new Date(`${value}T00:00:00.000Z`);

const SAMPLE_USERS = [
  { email: "alex.sample@example.com", name: "Alex Rivera" },
  { email: "sam.sample@example.com", name: "Sam Chen" },
  { email: "jordan.sample@example.com", name: "Jordan Patel" },
];

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed sample data with NODE_ENV=production.");
  }

  const users = [];
  for (const sample of SAMPLE_USERS) {
    users.push(
      await db.user.upsert({
        where: { email: sample.email },
        update: { name: sample.name },
        create: { email: sample.email, name: sample.name },
      }),
    );
  }
  const [alex, sam, jordan] = users as [
    (typeof users)[number],
    (typeof users)[number],
    (typeof users)[number],
  ];

  await db.trip.deleteMany({ where: { isSample: true } });

  const trip = await db.trip.create({
    data: {
      title: "[Sample] Lisbon long weekend",
      summary:
        "Sample data: a four-day food and neighborhoods trip for three friends. Edit or delete it freely.",
      isSample: true,
      stage: "BOOKING",
      startMode: "KNOWN_DESTINATION",
      destination: "Lisbon, Portugal",
      destinationConfirmed: true,
      departureLocation: "Boston (BOS)",
      tripStyle: "Food, neighborhoods, a day trip to Sintra",
      startDate: date("2027-05-20"),
      endDate: date("2027-05-23"),
      dateFlexibility: "FIXED",
      durationDays: 4,
      groupSize: 3,
      groupNotes: "Three friends from college",
      budgetAmount: "1800.00",
      budgetCurrency: "USD",
      budgetBasis: "PER_PERSON",
      budgetIncludes: ["FLIGHTS", "LODGING", "ACTIVITIES"],
      flightsStatus: "IN_PROGRESS",
      lodgingStatus: "BOOKED",
      localTransportStatus: "NEEDED",
      activitiesStatus: "IN_PROGRESS",
      currency: "USD",
      createdById: alex.id,
      updatedById: alex.id,
      stops: {
        create: [
          {
            position: 0,
            name: "Lisbon, Portugal",
            startDate: date("2027-05-20"),
            endDate: date("2027-05-23"),
          },
        ],
      },
    },
  });

  const alexMember = await db.tripMember.create({
    data: { tripId: trip.id, userId: alex.id, role: "ORGANIZER" },
  });
  const samMember = await db.tripMember.create({
    data: { tripId: trip.id, userId: sam.id, invitedById: alex.id },
  });
  const jordanMember = await db.tripMember.create({
    data: { tripId: trip.id, userId: jordan.id, invitedById: alex.id },
  });

  const ownerEmail = process.env.SEED_OWNER_EMAIL?.trim().toLowerCase();
  if (ownerEmail) {
    const owner = await db.user.findUnique({ where: { email: ownerEmail } });
    if (owner) {
      await db.tripMember.create({
        data: {
          tripId: trip.id,
          userId: owner.id,
          role: "ORGANIZER",
          invitedById: alex.id,
        },
      });
      console.log(`Added ${ownerEmail} to the sample trip as an organizer.`);
    } else {
      console.log(
        `No user with email ${ownerEmail} yet. Sign in once with Google, then run the seed again.`,
      );
    }
  }

  await db.tripPreference.createMany({
    data: [
      {
        tripId: trip.id,
        kind: "DIETARY",
        strength: "REQUIREMENT",
        description: "Vegetarian options at every meal",
        memberId: samMember.id,
        createdById: sam.id,
      },
      {
        tripId: trip.id,
        kind: "INTEREST",
        strength: "PREFERENCE",
        description: "Food markets and local wine",
        createdById: alex.id,
      },
      {
        tripId: trip.id,
        kind: "ACCESSIBILITY",
        strength: "PREFERENCE",
        description: "Avoid long uphill walks after dinner",
        createdById: jordan.id,
      },
    ],
  });

  const sampleOption = (data: {
    category: "LODGING" | "ACTIVITY" | "FOOD" | "TRANSPORT";
    title: string;
    description: string;
    status: "SUGGESTED" | "SHORTLISTED" | "APPROVED" | "BOOKED";
    price?: string;
    unit?: string;
    location?: string;
    createdById: string;
  }) =>
    db.researchOption.create({
      data: {
        tripId: trip.id,
        category: data.category,
        title: data.title,
        description: data.description,
        status: data.status,
        origin: "SAMPLE_DATA",
        sourceName: "Sample data",
        priceAmount: data.price ?? null,
        priceCurrency: data.price ? "USD" : null,
        priceUnit: data.unit ?? null,
        locationName: data.location ?? null,
        createdById: data.createdById,
        updatedById: data.createdById,
      },
    });

  const apartment = await sampleOption({
    category: "LODGING",
    title: "Sample: Alfama apartment with terrace",
    description:
      "Two bedrooms plus a sofa bed. Sample listing, not a real property.",
    status: "BOOKED",
    price: "640.00",
    unit: "total",
    location: "Alfama",
    createdById: alex.id,
  });
  await sampleOption({
    category: "LODGING",
    title: "Sample: Boutique hotel in Chiado",
    description: "Central, two rooms. Sample listing.",
    status: "SHORTLISTED",
    price: "210.00",
    unit: "night",
    location: "Chiado",
    createdById: sam.id,
  });
  const sintra = await sampleOption({
    category: "ACTIVITY",
    title: "Sample: Guided day trip to Sintra",
    description: "Small group tour with transport. Sample listing.",
    status: "SHORTLISTED",
    price: "95.00",
    unit: "person",
    location: "Sintra",
    createdById: jordan.id,
  });
  const sintraTrain = await sampleOption({
    category: "TRANSPORT",
    title: "Sample: Train to Sintra on our own",
    description: "Cheaper and flexible, but no guide. Sample entry.",
    status: "SHORTLISTED",
    location: "Rossio station",
    createdById: sam.id,
  });
  await sampleOption({
    category: "FOOD",
    title: "Sample: Time Out Market dinner",
    description: "Lots of vegetarian stalls. Sample entry.",
    status: "SUGGESTED",
    location: "Cais do Sodré",
    createdById: alex.id,
  });
  await db.optionNote.create({
    data: {
      optionId: sintra.id,
      authorId: sam.id,
      body: "Tour includes Pena Palace tickets, which sell out.",
    },
  });

  const decision = await db.decision.create({
    data: {
      tripId: trip.id,
      title: "How should we do Sintra?",
      createdById: jordan.id,
      choices: {
        create: [
          { label: sintra.title, researchOptionId: sintra.id, position: 0 },
          {
            label: sintraTrain.title,
            researchOptionId: sintraTrain.id,
            position: 1,
          },
        ],
      },
    },
    include: { choices: true },
  });
  await db.vote.createMany({
    data: [
      {
        decisionId: decision.id,
        choiceId: decision.choices[0]!.id,
        userId: jordan.id,
      },
      {
        decisionId: decision.id,
        choiceId: decision.choices[1]!.id,
        userId: sam.id,
      },
    ],
  });

  await db.task.createMany({
    data: [
      {
        tripId: trip.id,
        title: "Book flights home",
        status: "OPEN",
        priority: "HIGH",
        assigneeMemberId: jordanMember.id,
        dueDate: date("2027-03-01"),
        createdById: alex.id,
      },
      {
        tripId: trip.id,
        title: "Compare airport transfer options",
        status: "IN_PROGRESS",
        priority: "MEDIUM",
        assigneeMemberId: samMember.id,
        createdById: alex.id,
      },
      {
        tripId: trip.id,
        title: "Reserve a fado dinner",
        status: "OPEN",
        priority: "LOW",
        createdById: sam.id,
      },
      {
        tripId: trip.id,
        title: "Check whether we need a rental car for Sintra",
        status: "SUGGESTED",
        origin: "ATLAS",
        priority: "MEDIUM",
        createdById: alex.id,
      },
      {
        tripId: trip.id,
        title: "Share apartment check-in instructions",
        status: "COMPLETED",
        priority: "MEDIUM",
        assigneeMemberId: alexMember.id,
        completedAt: new Date(),
        createdById: alex.id,
      },
    ],
  });

  const flight = await db.booking.create({
    data: {
      tripId: trip.id,
      category: "FLIGHT",
      title: "Sample: TP 218 Boston to Lisbon",
      provider: "Sample airline",
      status: "CONFIRMED",
      startDate: date("2027-05-19"),
      startMinute: 19 * 60 + 30,
      endDate: date("2027-05-20"),
      endMinute: 7 * 60 + 10,
      fromLocation: "BOS",
      toLocation: "LIS",
      costAmount: "620.00",
      currency: "USD",
      costIsEstimate: false,
      costSplit: "PER_PERSON",
      createdById: alex.id,
      participants: {
        create: [
          { memberId: alexMember.id, status: "BOOKED" },
          { memberId: samMember.id, status: "BOOKED" },
          { memberId: jordanMember.id, status: "CONSIDERING" },
        ],
      },
    },
  });
  await db.booking.create({
    data: {
      tripId: trip.id,
      category: "ACCOMMODATION",
      title: "Sample: Alfama apartment",
      provider: "Sample rentals",
      status: "CONFIRMED",
      reference: "SAMPLE-1234",
      startDate: date("2027-05-20"),
      endDate: date("2027-05-22"),
      locationName: "Alfama",
      costAmount: "640.00",
      currency: "USD",
      costIsEstimate: false,
      costSplit: "SHARED_EQUALLY",
      researchOptionId: apartment.id,
      createdById: alex.id,
      participants: {
        create: [
          {
            memberId: alexMember.id,
            status: "BOOKED",
            roomAssignment: "Bedroom 1",
          },
          {
            memberId: samMember.id,
            status: "BOOKED",
            roomAssignment: "Bedroom 2",
          },
          {
            memberId: jordanMember.id,
            status: "BOOKED",
            roomAssignment: "Sofa bed",
          },
        ],
      },
    },
  });
  await db.booking.create({
    data: {
      tripId: trip.id,
      category: "ACCOMMODATION",
      title: "Sample: Last night near the airport",
      status: "PLANNED",
      startDate: date("2027-05-22"),
      endDate: date("2027-05-23"),
      notes: "Only Jordan has an early flight. Price not known yet.",
      createdById: jordan.id,
      participants: {
        create: [{ memberId: jordanMember.id, status: "CONSIDERING" }],
      },
    },
  });

  await db.itineraryEvent.createMany({
    data: [
      {
        tripId: trip.id,
        title: "Land at LIS, metro to Alfama",
        kind: "TRANSFER",
        status: "PLANNED",
        date: date("2027-05-20"),
        startMinute: 7 * 60 + 10,
        endMinute: 8 * 60 + 30,
        bookingId: flight.id,
        createdById: alex.id,
      },
      {
        tripId: trip.id,
        title: "Late breakfast at a pastelaria",
        kind: "MEAL",
        status: "PLANNED",
        date: date("2027-05-20"),
        startMinute: 10 * 60,
        endMinute: 11 * 60,
        createdById: sam.id,
      },
      {
        tripId: trip.id,
        title: "Sintra day trip",
        kind: "ACTIVITY",
        status: "PLANNED",
        date: date("2027-05-21"),
        startMinute: 9 * 60,
        endMinute: 17 * 60,
        researchOptionId: sintra.id,
        createdById: jordan.id,
      },
      {
        tripId: trip.id,
        title: "Fado dinner",
        kind: "MEAL",
        status: "CONFIRMED",
        date: date("2027-05-22"),
        startMinute: 20 * 60,
        endMinute: 22 * 60,
        locationName: "Alfama",
        createdById: sam.id,
      },
      {
        tripId: trip.id,
        title: "Sample suggestion: LX Factory and Belém pastries",
        kind: "ACTIVITY",
        status: "SUGGESTED",
        origin: "ATLAS",
        date: date("2027-05-22"),
        startMinute: 13 * 60,
        endMinute: 16 * 60,
        locationName: "Alcântara and Belém",
        rationale:
          "Fills the open afternoon with food and design shops the group mentioned.",
        caveats: "Opening hours and travel time are not verified.",
        createdById: alex.id,
      },
    ],
  });

  await db.activityLog.createMany({
    data: [
      {
        tripId: trip.id,
        actorId: alex.id,
        type: "TRIP_CREATED",
        summary: `created the trip "${trip.title}"`,
        createdAt: new Date(Date.now() - 6 * 86_400_000),
      },
      {
        tripId: trip.id,
        actorId: sam.id,
        type: "MEMBER_JOINED",
        summary: "joined the trip",
        createdAt: new Date(Date.now() - 5 * 86_400_000),
      },
      {
        tripId: trip.id,
        actorId: jordan.id,
        type: "MEMBER_JOINED",
        summary: "joined the trip",
        createdAt: new Date(Date.now() - 5 * 86_400_000),
      },
      {
        tripId: trip.id,
        actorId: alex.id,
        type: "BOOKING_CONFIRMED",
        summary: 'marked "Sample: Alfama apartment" as confirmed',
        createdAt: new Date(Date.now() - 2 * 86_400_000),
      },
      {
        tripId: trip.id,
        actorId: jordan.id,
        type: "DECISION_CREATED",
        summary: "started a vote: How should we do Sintra?",
        createdAt: new Date(Date.now() - 86_400_000),
      },
    ],
  });

  console.log(`Seeded sample trip ${trip.id} (${trip.title}).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
