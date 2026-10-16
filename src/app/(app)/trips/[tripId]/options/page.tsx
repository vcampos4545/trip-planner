import { Bookmark, Plane, Plus, SearchX } from "lucide-react";
import type { Metadata, Route } from "next";
import Link from "next/link";

import { OptionFormDialog } from "@/components/options/option-form-dialog";
import { OptionsBoard } from "@/components/options/options-board";
import { OptionsToolbar } from "@/components/options/options-toolbar";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ASSISTANT_NAME } from "@/config/brand";
import { OptionCategory, OptionStatus } from "@/generated/prisma/enums";
import { serialize } from "@/lib/serialize";
import { requireTripAccess } from "@/server/access";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { orNotFound } from "@/server/not-found";
import { getResearchProvider } from "@/server/research";
import { listOptions, OPTION_PAGE_SIZE } from "@/server/services/research";

export const metadata: Metadata = { title: "Options" };

function pick<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | null {
  return typeof value === "string" &&
    (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

export default async function OptionsPage({
  params,
  searchParams,
}: PageProps<"/trips/[tripId]/options">) {
  const { tripId } = await params;
  const query = await searchParams;
  const user = await requireUser(`/trips/${tripId}/options`);
  const access = await orNotFound(requireTripAccess(tripId, user.id));
  const category = pick(query.category, Object.values(OptionCategory));
  const statusParam =
    query.status === "ALL"
      ? null
      : (pick(query.status, Object.values(OptionStatus)) ?? "ACTIVE");
  const search = typeof query.q === "string" ? query.q.slice(0, 100) : null;
  const [options, trip] = await Promise.all([
    listOptions(access, { category, status: statusParam, query: search }),
    db.trip.findUniqueOrThrow({
      where: { id: tripId },
      select: { currency: true },
    }),
  ]);
  const research = getResearchProvider();
  const filtered = Boolean(category || search || query.status);

  const addButton = (
    <OptionFormDialog
      tripId={tripId}
      defaultCurrency={trip.currency}
      trigger={
        <Button>
          <Plus aria-hidden />
          Add option
        </Button>
      }
    />
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Saved options"
        description="Destinations, stays, activities, and transport the group is considering."
        actions={addButton}
      />
      {!research.isConfigured ? (
        <Alert>
          <SearchX aria-hidden />
          <AlertTitle>Live research is unavailable</AlertTitle>
          {research.unavailableReason ? (
            <AlertDescription data-testid="research-unavailable-reason">
              {research.label} is selected but cannot run:{" "}
              {research.unavailableReason} There are no real-time results,
              prices, or availability. {ASSISTANT_NAME} can still suggest ideas
              from general knowledge, marked as unverified. Add anything you
              find yourself, with a link to the source.
            </AlertDescription>
          ) : (
            <AlertDescription>
              No search provider is connected, so there are no real-time
              results, prices, or availability. {ASSISTANT_NAME} can still
              suggest ideas from general knowledge, marked as unverified. Add
              anything you find yourself, with a link to the source.
            </AlertDescription>
          )}
        </Alert>
      ) : null}
      <p
        className="flex items-center gap-1.5 text-sm text-muted-foreground"
        data-testid="flight-search-pointer"
      >
        <Plane className="size-4" aria-hidden />
        Looking for flights?
        <Link
          href={`/trips/${tripId}/bookings#flights` as Route}
          className="font-medium text-primary hover:underline"
        >
          Search flights in Bookings
        </Link>
      </p>
      <OptionsToolbar />
      {options.length === 0 ? (
        <EmptyState
          icon={Bookmark}
          title={
            filtered ? "No options match these filters" : "No saved options yet"
          }
          description={
            filtered
              ? "Try a different type or status."
              : `Add a place to stay, an activity, or a destination idea, or ask ${ASSISTANT_NAME} for suggestions.`
          }
          action={filtered ? undefined : addButton}
        />
      ) : (
        <>
          <OptionsBoard
            tripId={tripId}
            options={serialize(options)}
            role={access.role}
            currentUserId={user.id}
            defaultCurrency={trip.currency}
          />
          {options.length >= OPTION_PAGE_SIZE ? (
            <p className="text-xs text-muted-foreground">
              Showing the {OPTION_PAGE_SIZE} most recently updated options. Use
              filters to narrow down.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
