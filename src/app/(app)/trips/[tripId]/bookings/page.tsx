import type { Metadata } from "next";

import { BookingsView } from "@/components/bookings/bookings-view";
import { BudgetSummaryCard } from "@/components/bookings/budget-summary";
import { emptyBooking } from "@/lib/validation/form-defaults";
import { PageHeader } from "@/components/shared/page-header";
import type { BookingCategory, OptionCategory } from "@/generated/prisma/enums";
import { summarizeBudget } from "@/lib/domain/budget";
import { serialize } from "@/lib/serialize";
import type { BookingFormInput } from "@/lib/validation/booking";
import { requireTripAccess } from "@/server/access";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { orNotFound } from "@/server/not-found";
import { listBookings } from "@/server/services/bookings";
import { listMembers } from "@/server/services/members";

export const metadata: Metadata = { title: "Bookings" };

const OPTION_TO_BOOKING: Record<OptionCategory, BookingCategory> = {
  DESTINATION: "OTHER",
  LODGING: "ACCOMMODATION",
  FLIGHT: "FLIGHT",
  TRANSPORT: "GROUND_TRANSPORT",
  ACTIVITY: "ACTIVITY",
  FOOD: "ACTIVITY",
  OTHER: "OTHER",
};

export default async function BookingsPage({
  params,
  searchParams,
}: PageProps<"/trips/[tripId]/bookings">) {
  const { tripId } = await params;
  const query = await searchParams;
  const user = await requireUser(`/trips/${tripId}/bookings`);
  const access = await orNotFound(requireTripAccess(tripId, user.id));
  const [bookings, members, trip, options] = await Promise.all([
    listBookings(access),
    listMembers(access),
    db.trip.findUniqueOrThrow({
      where: { id: tripId },
      select: {
        currency: true,
        budgetAmount: true,
        budgetCurrency: true,
        budgetBasis: true,
        groupSize: true,
      },
    }),
    db.researchOption.findMany({
      where: { tripId, status: { notIn: ["REJECTED", "CANCELLED"] } },
      select: {
        id: true,
        title: true,
        category: true,
        url: true,
        sourceName: true,
        priceAmount: true,
        priceCurrency: true,
        priceUnit: true,
        locationName: true,
        address: true,
      },
      take: 100,
    }),
  ]);

  let prefill: BookingFormInput | null = null;
  const optionId = typeof query.option === "string" ? query.option : null;
  const source = optionId
    ? options.find((option) => option.id === optionId)
    : undefined;
  if (source) {
    const category = OPTION_TO_BOOKING[source.category];
    prefill = {
      ...emptyBooking(category, source.priceCurrency ?? trip.currency),
      title: source.title,
      provider: source.sourceName ?? "",
      url: source.url ?? "",
      locationName: source.locationName ?? "",
      address: source.address ?? "",
      costAmount:
        source.priceAmount &&
        (source.priceUnit === null || /total/i.test(source.priceUnit))
          ? source.priceAmount.toFixed(2)
          : "",
      researchOptionId: source.id,
      participants: [],
    };
  }

  const budget = summarizeBudget(
    bookings,
    members.map((member) => member.id),
    trip.currency,
  );
  const memberNames = Object.fromEntries(
    members.map((member) => [
      member.id,
      member.user.name ?? member.user.email ?? "Member",
    ]),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bookings"
        description="Flights, stays, transport, and reservations the group has made or still needs to make. This organizes bookings; it never books anything."
      />
      <BudgetSummaryCard
        summary={budget}
        memberNames={memberNames}
        target={{
          amount: trip.budgetAmount?.toFixed(2) ?? null,
          currency: trip.budgetCurrency,
          basis: trip.budgetBasis,
        }}
        travelers={trip.groupSize ?? members.length}
      />
      <BookingsView
        tripId={tripId}
        bookings={serialize(bookings)}
        members={members.map((member) => ({
          id: member.id,
          name: member.user.name ?? member.user.email ?? "Member",
        }))}
        options={options.map((option) => ({
          id: option.id,
          title: option.title,
        }))}
        currentMemberId={access.memberId}
        currentUserId={user.id}
        isOrganizer={access.isOrganizer}
        currency={trip.currency}
        prefill={prefill}
      />
    </div>
  );
}
