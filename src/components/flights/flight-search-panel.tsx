"use client";

import {
  ArrowRight,
  ExternalLink,
  FlaskConical,
  History,
  Plane,
  PlaneLanding,
  PlaneTakeoff,
  SearchX,
  TrendingUp,
} from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  FieldShell,
  NativeSelect,
  useFieldId,
} from "@/components/shared/form-fields";
import { FormError } from "@/components/shared/form-error";
import { Pill } from "@/components/shared/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ASSISTANT_NAME } from "@/config/brand";
import { useAction } from "@/hooks/use-action";
import type { FieldChoice } from "@/lib/action-result";
import { useZodForm } from "@/hooks/use-zod-form";
import { formatDateOnly, formatTimestamp } from "@/lib/dates";
import {
  CABIN_CLASSES,
  CABIN_LABELS,
  MAX_FLIGHT_PASSENGERS,
  TEST_DATA_NOTICE,
  bookElsewhereUrl,
  formatDuration,
  isRoundTrip,
  localClock,
  localDate,
  placeCodes,
  stopsLabel,
  travelersLabel,
  type FlightOffer,
  type FlightSlice,
  type PendingReturn,
  type PriceInsights,
} from "@/lib/flights";
import { formatMoneyValue } from "@/lib/money";
import {
  flightSearchFormSchema,
  type FlightSearchFormInput,
} from "@/lib/validation/flights";
import {
  saveFlightAction,
  searchFlightsAction,
  searchReturnFlightsAction,
  type FlightSearchResponse,
} from "@/server/actions/flights";

export type FlightSearchPanelStatus =
  | { configured: true; label: string; testMode: boolean }
  | { configured: false; reason: string };

export function FlightSearchPanel({
  tripId,
  status,
  defaults,
}: {
  tripId: string;
  status: FlightSearchPanelStatus;
  defaults: FlightSearchFormInput;
}) {
  return (
    <section
      className="rounded-xl border bg-card p-4 sm:p-5"
      aria-labelledby="flight-search-heading"
      data-testid="flight-search-panel"
    >
      <div className="flex flex-wrap items-center gap-2">
        <PlaneTakeoff className="size-4 text-muted-foreground" aria-hidden />
        <h3 id="flight-search-heading" className="text-sm font-semibold">
          Search flights
        </h3>
        {status.configured && status.testMode ? (
          <Pill tone="warning">
            <FlaskConical aria-hidden />
            Test data
          </Pill>
        ) : null}
      </div>
      {status.configured ? (
        <>
          <p className="mt-1 text-xs text-muted-foreground">
            {status.testMode
              ? `Connected to ${status.label}. Results are samples from Duffel's test environment, not real flights, fares, or availability.`
              : `Results from ${status.label}, with prices as Google Flights shows them when retrieved. Prices can change before you book. Searches share a limited monthly quota, so an identical search within a few hours reuses the earlier results.`}{" "}
            Save a flight as considering to track it here with you on it, or to
            options only. Nothing is booked through the app.
          </p>
          <FlightSearch tripId={tripId} defaults={defaults} />
        </>
      ) : (
        <Alert className="mt-3" data-testid="flights-not-configured">
          <SearchX aria-hidden />
          <AlertTitle>Flight search is not configured</AlertTitle>
          <AlertDescription>
            {status.reason} There are no flight results, fares, or availability.
            You can still record flights you find yourself with Add, and{" "}
            {ASSISTANT_NAME} will say the same if you ask about flights.
          </AlertDescription>
        </Alert>
      )}
    </section>
  );
}

function FlightSearch({
  tripId,
  defaults,
}: {
  tripId: string;
  defaults: FlightSearchFormInput;
}) {
  const [pending, startTransition] = useTransition();
  const [response, setResponse] = useState<FlightSearchResponse | null>(null);
  const [choices, setChoices] = useState<
    Partial<Record<PlaceField, FieldChoice[]>>
  >({});
  const { form, formError, applyResult } = useZodForm(
    flightSearchFormSchema,
    defaults,
  );
  const errors = form.formState.errors;
  const id = {
    origin: useFieldId("origin"),
    destination: useFieldId("destination"),
    departureDate: useFieldId("departureDate"),
    returnDate: useFieldId("returnDate"),
    passengers: useFieldId("passengers"),
    cabin: useFieldId("cabin"),
    maxStops: useFieldId("maxStops"),
  };

  const search = form.handleSubmit(() =>
    startTransition(async () => {
      const result = await searchFlightsAction(tripId, form.getValues());
      setChoices(result.ok ? {} : (result.fieldChoices ?? {}));
      if (applyResult(result) && result.ok) setResponse(result.data);
      else setResponse(null);
    }),
  );
  const clearChoices = (field: PlaceField) =>
    setChoices((current) => ({ ...current, [field]: undefined }));
  // Picking one of several places with the same name fills it in and searches again.
  const pick = (field: PlaceField, value: string) => {
    form.setValue(field, value, { shouldValidate: true });
    clearChoices(field);
    void search();
  };

  return (
    <div className="mt-4 space-y-4">
      <form
        noValidate
        className="grid gap-3"
        aria-label="Flight search"
        onSubmit={search}
      >
        <FormError message={formError} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="grid content-start gap-1.5">
            <FieldShell
              label="From"
              htmlFor={id.origin}
              error={errors.origin?.message}
              hint="City or airport code"
            >
              <Input
                id={id.origin}
                placeholder="New York or JFK"
                aria-invalid={Boolean(errors.origin)}
                {...form.register("origin", {
                  onChange: () => clearChoices("origin"),
                })}
              />
            </FieldShell>
            <PlaceChoices
              label="From"
              choices={choices.origin}
              disabled={pending}
              onPick={(value) => pick("origin", value)}
            />
          </div>
          <div className="grid content-start gap-1.5">
            <FieldShell
              label="To"
              htmlFor={id.destination}
              error={errors.destination?.message}
              hint="City or airport code"
            >
              <Input
                id={id.destination}
                placeholder="Lisbon or LIS"
                aria-invalid={Boolean(errors.destination)}
                {...form.register("destination", {
                  onChange: () => clearChoices("destination"),
                })}
              />
            </FieldShell>
            <PlaceChoices
              label="To"
              choices={choices.destination}
              disabled={pending}
              onPick={(value) => pick("destination", value)}
            />
          </div>
          <FieldShell
            label="Depart"
            htmlFor={id.departureDate}
            error={errors.departureDate?.message}
          >
            <Input
              id={id.departureDate}
              type="date"
              aria-invalid={Boolean(errors.departureDate)}
              {...form.register("departureDate")}
            />
          </FieldShell>
          <FieldShell
            label="Return"
            htmlFor={id.returnDate}
            optional
            error={errors.returnDate?.message}
          >
            <Input
              id={id.returnDate}
              type="date"
              aria-invalid={Boolean(errors.returnDate)}
              {...form.register("returnDate")}
            />
          </FieldShell>
        </div>
        <div className="grid gap-3 sm:grid-cols-[8rem_12rem_10rem_auto] sm:items-end">
          <FieldShell
            label="Travelers"
            htmlFor={id.passengers}
            error={errors.passengers?.message}
          >
            <Input
              id={id.passengers}
              type="number"
              min={1}
              max={MAX_FLIGHT_PASSENGERS}
              inputMode="numeric"
              aria-invalid={Boolean(errors.passengers)}
              {...form.register("passengers")}
            />
          </FieldShell>
          <FieldShell label="Cabin" htmlFor={id.cabin}>
            <NativeSelect id={id.cabin} {...form.register("cabin")}>
              {CABIN_CLASSES.map((value) => (
                <option key={value} value={value}>
                  {CABIN_LABELS[value]}
                </option>
              ))}
              <option value="any">Any cabin</option>
            </NativeSelect>
          </FieldShell>
          <FieldShell label="Stops" htmlFor={id.maxStops}>
            <NativeSelect id={id.maxStops} {...form.register("maxStops")}>
              <option value="0">Nonstop only</option>
              <option value="1">Up to 1 stop</option>
              <option value="2">Up to 2 stops</option>
            </NativeSelect>
          </FieldShell>
          <Button type="submit" disabled={pending} className="sm:w-fit">
            {pending ? "Searching..." : "Search flights"}
          </Button>
        </div>
      </form>

      {response ? <FlightResults tripId={tripId} response={response} /> : null}
    </div>
  );
}

type PlaceField = "origin" | "destination";

/** The places a name could mean, to pick from instead of guessing. */
function PlaceChoices({
  label,
  choices,
  disabled,
  onPick,
}: {
  label: string;
  choices: FieldChoice[] | undefined;
  disabled: boolean;
  onPick: (value: string) => void;
}) {
  if (!choices?.length) return null;
  return (
    <div
      role="group"
      aria-label={`Places that match ${label}`}
      className="flex flex-wrap gap-1.5"
      data-testid="place-choices"
    >
      {choices.map((choice) => (
        <Button
          key={choice.value}
          type="button"
          size="xs"
          variant="outline"
          disabled={disabled}
          onClick={() => onPick(choice.value)}
        >
          {choice.label}
        </Button>
      ))}
    </div>
  );
}

function FlightResults({
  tripId,
  response,
}: {
  tripId: string;
  response: FlightSearchResponse;
}) {
  const { search } = response;
  const googleUrl = response.results.find((result) => result.offer.bookingUrl)
    ?.offer.bookingUrl;
  const compareUrl =
    googleUrl ??
    bookElsewhereUrl({
      origin: search.origin.iataCode,
      destination: search.destination.iataCode,
      departureDate: search.departureDate,
      returnDate: search.returnDate,
    });
  const resolved = [search.origin, search.destination].filter(
    (place) => place.query.toUpperCase() !== placeCodes(place),
  );
  return (
    <div className="space-y-3" data-testid="flight-results">
      {response.testMode ? (
        <Alert
          className="border-orange-200 bg-orange-50 text-orange-900"
          data-testid="flight-test-notice"
        >
          <FlaskConical aria-hidden />
          <AlertTitle>{TEST_DATA_NOTICE}</AlertTitle>
          <AlertDescription className="text-orange-900/80">
            These results come from Duffel&apos;s test environment. They can use
            real airline names, but the flights, times, and prices are samples.
            Do not plan or pay around them.
          </AlertDescription>
        </Alert>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {response.results.length}{" "}
        {response.results.length === 1 ? "result" : "results"} from{" "}
        {response.sourceName}, retrieved {formatTimestamp(response.retrievedAt)}
        . {travelersLabel(search.passengers)}, prices are totals.
        {resolved.length > 0
          ? ` Searched ${resolved.map((place) => `"${place.query}" as ${placeCodes(place)}`).join(" and ")}.`
          : ""}
      </p>
      {response.cached ? (
        <CachedNotice retrievedAt={response.retrievedAt} />
      ) : null}
      {response.priceInsights ? (
        <PriceInsightsNote insights={response.priceInsights} />
      ) : null}
      {response.results.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          No flights matched. Try other dates, more stops, or any cabin.
        </p>
      ) : (
        <ul className="grid gap-3">
          {response.results.map((result) => (
            <FlightResultCard
              key={result.offer.offerId}
              tripId={tripId}
              offer={result.offer}
              token={result.token}
            />
          ))}
        </ul>
      )}
      <a
        href={compareUrl}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
      >
        {googleUrl
          ? "Open this search on Google Flights to book"
          : "Compare this route on Google Flights to book elsewhere"}
        <ExternalLink className="size-3" aria-hidden />
      </a>
    </div>
  );
}

function CachedNotice({ retrievedAt }: { retrievedAt: string }) {
  return (
    <p
      className="flex items-start gap-1.5 text-xs text-muted-foreground"
      data-testid="flight-cached-notice"
    >
      <History className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      Reused the same search from {formatTimestamp(retrievedAt)} to save the
      search quota. Prices were not refreshed and may have changed.
    </p>
  );
}

function PriceInsightsNote({ insights }: { insights: PriceInsights }) {
  const money = (value: string | null) =>
    value ? formatMoneyValue(value, insights.currency) : null;
  const range =
    insights.typicalLow && insights.typicalHigh
      ? `usually ${money(insights.typicalLow)} to ${money(insights.typicalHigh)}`
      : null;
  const parts = [
    insights.priceLevel ? `prices are ${insights.priceLevel} right now` : null,
    range,
    insights.lowestPrice ? `lowest here ${money(insights.lowestPrice)}` : null,
  ].filter(Boolean);
  return (
    <p
      className="flex items-start gap-1.5 rounded-lg border bg-muted/40 px-3 py-2 text-xs"
      data-testid="flight-price-insights"
    >
      <TrendingUp
        className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
        aria-hidden
      />
      <span>
        <span className="font-medium">
          Price insight from {insights.sourceName}:
        </span>{" "}
        {parts.join(", ")}. This is Google&apos;s estimate for the route, not a
        promise of any fare.
      </span>
    </p>
  );
}

function FlightResultCard({
  tripId,
  offer,
  token,
}: {
  tripId: string;
  offer: FlightOffer;
  token: string;
}) {
  const { run, pending } = useAction();
  const [saved, setSaved] = useState<"option" | "booking" | null>(null);
  const price = formatMoneyValue(offer.totalAmount, offer.totalCurrency);

  function save(asBooking: boolean) {
    run(() => saveFlightAction(tripId, { token, asBooking }), {
      onSuccess: (data) => {
        setSaved(asBooking ? "booking" : (saved ?? "option"));
        if (data.alreadySaved && !asBooking) {
          toast.info("This flight is already in the trip's options.");
        } else {
          toast.success(
            asBooking
              ? "Saved to Flights. You're marked as considering it."
              : "Saved to options for the group to review.",
          );
        }
      },
    });
  }

  return (
    <li
      className="rounded-lg border bg-background p-3 sm:p-4"
      data-testid="flight-result"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Plane className="size-4 text-muted-foreground" aria-hidden />
            <span className="font-medium">{offer.airline.name}</span>
            {offer.testMode ? (
              <Pill tone="warning">Test data, not a real fare</Pill>
            ) : null}
          </div>
          {offer.slices.map((slice, index) => (
            <SliceRow
              key={index}
              slice={slice}
              label={
                isRoundTrip(offer)
                  ? index === 0
                    ? "Outbound"
                    : "Return"
                  : "One way"
              }
            />
          ))}
          {offer.pendingReturn ? (
            <PendingReturnRow pending={offer.pendingReturn} />
          ) : null}
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold" data-testid="flight-price">
            {price}
          </p>
          <p className="text-xs text-muted-foreground">
            {offer.totalCurrency}{" "}
            {isRoundTrip(offer) ? "round-trip total" : "total"},{" "}
            {travelersLabel(offer.passengers)}
          </p>
          <p className="text-xs text-muted-foreground">
            {offer.sourceName}, retrieved {formatTimestamp(offer.retrievedAt)}
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
        <Button
          size="sm"
          disabled={pending || saved === "booking"}
          onClick={() => save(true)}
        >
          {saved === "booking" ? "Saved as considering" : "Save as considering"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={pending || saved !== null}
          onClick={() => save(false)}
        >
          {saved ? "Saved to options" : "Save to options only"}
        </Button>
        {offer.bookingUrl ? (
          <a
            href={offer.bookingUrl}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            View on Google Flights to book
            <ExternalLink className="size-3" aria-hidden />
          </a>
        ) : null}
      </div>
      {offer.pendingReturn ? (
        <ReturnFlights tripId={tripId} token={token} />
      ) : null}
    </li>
  );
}

function PendingReturnRow({ pending }: { pending: PendingReturn }) {
  return (
    <div className="text-sm" data-testid="flight-pending-return">
      <p className="text-xs text-muted-foreground">
        Return · {formatDateOnly(pending.date, "weekday")}
      </p>
      <p className="text-xs text-muted-foreground">
        Return flight not chosen yet. The price is the round-trip total.
      </p>
    </div>
  );
}

/** Return options load only on request, because each load spends one search from the quota. */
function ReturnFlights({ tripId, token }: { tripId: string; token: string }) {
  const [pending, startTransition] = useTransition();
  const [response, setResponse] = useState<FlightSearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!response) {
    return (
      <div className="mt-3 space-y-2 border-t pt-3">
        <FormError message={error} />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await searchReturnFlightsAction(tripId, {
                  token,
                });
                if (result.ok) {
                  setError(null);
                  setResponse(result.data);
                } else {
                  setError(result.error);
                }
              })
            }
          >
            <PlaneLanding aria-hidden />
            {pending ? "Loading return flights..." : "Show return flights"}
          </Button>
          <span className="text-xs text-muted-foreground">
            Uses one search from the quota.
          </span>
        </div>
      </div>
    );
  }
  return (
    <div className="mt-3 space-y-2 border-t pt-3" data-testid="return-flights">
      <p className="text-xs text-muted-foreground">
        {response.results.length} return{" "}
        {response.results.length === 1 ? "option" : "options"} with this
        outbound flight from {response.sourceName}, retrieved{" "}
        {formatTimestamp(response.retrievedAt)}. Prices are round-trip totals.
      </p>
      {response.cached ? (
        <CachedNotice retrievedAt={response.retrievedAt} />
      ) : null}
      {response.results.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No return flights matched. Try other dates or more stops.
        </p>
      ) : (
        <ul className="grid gap-3">
          {response.results.map((result) => (
            <FlightResultCard
              key={result.offer.offerId}
              tripId={tripId}
              offer={result.offer}
              token={result.token}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function SliceRow({ slice, label }: { slice: FlightSlice; label: string }) {
  const operators = [
    ...new Set(
      slice.segments
        .filter(
          (segment) => segment.operatingCarrier !== segment.marketingCarrier,
        )
        .map((segment) => segment.operatingCarrier),
    ),
  ];
  const flightNumbers = slice.segments
    .map((segment) => segment.flightNumber)
    .filter(Boolean)
    .join(", ");
  return (
    <div className="text-sm" data-testid="flight-slice">
      <p className="text-xs text-muted-foreground">
        {label} · {formatDateOnly(localDate(slice.departingAt), "weekday")}
        {flightNumbers ? ` · ${flightNumbers}` : ""}
      </p>
      <p className="flex flex-wrap items-center gap-x-1.5">
        <span className="font-medium">{localClock(slice.departingAt)}</span>
        <span>{slice.origin.iataCode}</span>
        <ArrowRight
          className="size-3.5 text-muted-foreground"
          aria-label="to"
        />
        <span className="font-medium">{localClock(slice.arrivingAt)}</span>
        <span>{slice.destination.iataCode}</span>
        {localDate(slice.arrivingAt) !== localDate(slice.departingAt) ? (
          <span className="text-xs text-muted-foreground">
            (arrives {formatDateOnly(localDate(slice.arrivingAt), "short")})
          </span>
        ) : null}
      </p>
      <p className="text-xs text-muted-foreground">
        {[
          stopsLabel(slice.stops),
          formatDuration(slice.durationMinutes),
          "local times",
          operators.length > 0 ? `operated by ${operators.join(", ")}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
    </div>
  );
}
