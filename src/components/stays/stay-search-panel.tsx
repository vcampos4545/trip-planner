"use client";

import {
  BedDouble,
  ExternalLink,
  History,
  Link2,
  MapPin,
  SearchX,
  Star,
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
import { useZodForm } from "@/hooks/use-zod-form";
import { formatDateOnly, formatTimestamp } from "@/lib/dates";
import { formatMoneyValue } from "@/lib/money";
import {
  MAX_STAY_BEDROOMS,
  MAX_STAY_GUESTS,
  STAY_KIND_LABELS,
  STAY_SORTS,
  STAY_SORT_LABELS,
  guestsLabel,
  nightsLabel,
  type StayOffer,
} from "@/lib/stays";
import {
  staySearchFormSchema,
  type StaySearchFormInput,
  type StaySearchPlace,
} from "@/lib/validation/stays";
import {
  saveStayAction,
  searchStaysAction,
  type StaySearchResponse,
} from "@/server/actions/stays";

import { StayLinkDialog } from "./stay-link-dialog";

export type StaySearchPanelStatus =
  | { configured: true; label: string; supportsVacationRentals: boolean }
  | { configured: false; reason: string };

export function StaySearchPanel({
  tripId,
  status,
  defaults,
  places,
  members,
  currentMemberId,
  currency,
}: {
  tripId: string;
  status: StaySearchPanelStatus;
  defaults: StaySearchFormInput;
  places: StaySearchPlace[];
  members: { id: string; name: string }[];
  currentMemberId: string;
  currency: string;
}) {
  const link = (
    <StayLinkDialog
      tripId={tripId}
      members={members}
      currentMemberId={currentMemberId}
      currency={currency}
      defaults={{ checkIn: defaults.checkIn, checkOut: defaults.checkOut }}
    />
  );
  return (
    <section
      className="rounded-xl border bg-card p-4 sm:p-5"
      aria-labelledby="stay-search-heading"
      data-testid="stay-search-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BedDouble className="size-4 text-muted-foreground" aria-hidden />
          <h3 id="stay-search-heading" className="text-sm font-semibold">
            Search stays
          </h3>
        </div>
        {link}
      </div>
      {status.configured ? (
        <>
          <p className="mt-1 text-xs text-muted-foreground">
            Results from {status.label}: Google Hotels&apos; lowest prices when
            retrieved, from the sites Google compares. Prices can change before
            you book. Searches share a limited monthly quota with flight search,
            so an identical search within a few hours reuses the earlier
            results. Found a place on Airbnb, Vrbo, or elsewhere? Use Add from
            link. Nothing is booked through the app.
          </p>
          {status.supportsVacationRentals ? null : (
            <p className="mt-1 text-xs text-muted-foreground">
              {status.label} only searches hotels. Add vacation rentals from
              their links.
            </p>
          )}
          <StaySearch
            tripId={tripId}
            defaults={defaults}
            places={places}
            supportsVacationRentals={status.supportsVacationRentals}
          />
        </>
      ) : (
        <Alert className="mt-3" data-testid="stays-not-configured">
          <SearchX aria-hidden />
          <AlertTitle>Stay search is not configured</AlertTitle>
          <AlertDescription>
            {status.reason} There are no hotel or rental results, prices, or
            availability. You can still add a place from its link or with Add,
            and {ASSISTANT_NAME} will say the same if you ask about stays.
          </AlertDescription>
        </Alert>
      )}
    </section>
  );
}

function StaySearch({
  tripId,
  defaults,
  places,
  supportsVacationRentals,
}: {
  tripId: string;
  defaults: StaySearchFormInput;
  places: StaySearchPlace[];
  supportsVacationRentals: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [response, setResponse] = useState<StaySearchResponse | null>(null);
  const { form, formError, applyResult } = useZodForm(
    staySearchFormSchema,
    defaults,
  );
  const errors = form.formState.errors;
  const kind = form.watch("kind");
  const rentals = kind === "vacation_rental";
  const id = {
    place: useFieldId("place"),
    location: useFieldId("location"),
    checkIn: useFieldId("checkIn"),
    checkOut: useFieldId("checkOut"),
    guests: useFieldId("guests"),
    kind: useFieldId("kind"),
    bedrooms: useFieldId("bedrooms"),
    minPrice: useFieldId("minPrice"),
    maxPrice: useFieldId("maxPrice"),
    sort: useFieldId("sort"),
  };

  const search = form.handleSubmit(() =>
    startTransition(async () => {
      const result = await searchStaysAction(tripId, form.getValues());
      if (applyResult(result) && result.ok) setResponse(result.data);
      else setResponse(null);
    }),
  );

  function fillFrom(index: string) {
    const place = places[Number(index)];
    if (!place) return;
    form.setValue("location", place.location, { shouldValidate: true });
    form.setValue("checkIn", place.checkIn);
    form.setValue("checkOut", place.checkOut);
  }

  return (
    <div className="mt-4 space-y-4">
      <form
        noValidate
        className="grid gap-3"
        aria-label="Stay search"
        onSubmit={search}
      >
        <FormError message={formError} />
        {places.length > 1 ? (
          <FieldShell
            label="Stop"
            htmlFor={id.place}
            hint="Fills in the place and its dates"
            className="sm:max-w-xs"
          >
            <NativeSelect
              id={id.place}
              defaultValue={String(
                Math.max(
                  places.findIndex(
                    (place) =>
                      place.location === defaults.location &&
                      place.checkIn === defaults.checkIn,
                  ),
                  0,
                ),
              )}
              onChange={(event) => fillFrom(event.target.value)}
            >
              {places.map((place, index) => (
                <option key={`${place.label}-${index}`} value={index}>
                  {place.label}
                  {place.checkIn
                    ? ` (${formatDateOnly(place.checkIn, "short")} to ${place.checkOut ? formatDateOnly(place.checkOut, "short") : "?"})`
                    : ""}
                </option>
              ))}
            </NativeSelect>
          </FieldShell>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <FieldShell
            label="Where"
            htmlFor={id.location}
            error={errors.location?.message}
            hint="Town, area, or address"
          >
            <Input
              id={id.location}
              placeholder="Park City, Utah"
              aria-invalid={Boolean(errors.location)}
              {...form.register("location")}
            />
          </FieldShell>
          <FieldShell
            label="Check-in"
            htmlFor={id.checkIn}
            error={errors.checkIn?.message}
          >
            <Input
              id={id.checkIn}
              type="date"
              aria-invalid={Boolean(errors.checkIn)}
              {...form.register("checkIn")}
            />
          </FieldShell>
          <FieldShell
            label="Check-out"
            htmlFor={id.checkOut}
            error={errors.checkOut?.message}
          >
            <Input
              id={id.checkOut}
              type="date"
              aria-invalid={Boolean(errors.checkOut)}
              {...form.register("checkOut")}
            />
          </FieldShell>
          <FieldShell
            label="Guests"
            htmlFor={id.guests}
            error={errors.guests?.message}
          >
            <Input
              id={id.guests}
              type="number"
              min={1}
              max={MAX_STAY_GUESTS}
              inputMode="numeric"
              aria-invalid={Boolean(errors.guests)}
              {...form.register("guests")}
            />
          </FieldShell>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[10rem_8rem_8rem_8rem_10rem_auto] lg:items-start">
          <FieldShell label="Type" htmlFor={id.kind}>
            <NativeSelect id={id.kind} {...form.register("kind")}>
              <option value="hotel">{STAY_KIND_LABELS.hotel}</option>
              {supportsVacationRentals ? (
                <option value="vacation_rental">
                  {STAY_KIND_LABELS.vacation_rental}
                </option>
              ) : null}
            </NativeSelect>
          </FieldShell>
          <FieldShell
            label="Bedrooms"
            htmlFor={id.bedrooms}
            error={errors.bedrooms?.message}
            hint={rentals ? "At least this many" : "Rentals only"}
          >
            <Input
              id={id.bedrooms}
              type="number"
              min={0}
              max={MAX_STAY_BEDROOMS}
              inputMode="numeric"
              disabled={!rentals}
              aria-invalid={Boolean(errors.bedrooms)}
              {...form.register("bedrooms")}
            />
          </FieldShell>
          <FieldShell
            label="Min price"
            htmlFor={id.minPrice}
            error={errors.minPrice?.message}
            hint="USD a night"
          >
            <Input
              id={id.minPrice}
              type="number"
              min={0}
              inputMode="numeric"
              placeholder="Any"
              aria-invalid={Boolean(errors.minPrice)}
              {...form.register("minPrice")}
            />
          </FieldShell>
          <FieldShell
            label="Max price"
            htmlFor={id.maxPrice}
            error={errors.maxPrice?.message}
            hint="USD a night"
          >
            <Input
              id={id.maxPrice}
              type="number"
              min={1}
              inputMode="numeric"
              placeholder="Any"
              aria-invalid={Boolean(errors.maxPrice)}
              {...form.register("maxPrice")}
            />
          </FieldShell>
          <FieldShell label="Sort" htmlFor={id.sort}>
            <NativeSelect id={id.sort} {...form.register("sort")}>
              {STAY_SORTS.map((value) => (
                <option key={value} value={value}>
                  {STAY_SORT_LABELS[value]}
                </option>
              ))}
            </NativeSelect>
          </FieldShell>
          <Button type="submit" disabled={pending} className="sm:w-fit lg:mt-6">
            {pending ? "Searching..." : "Search stays"}
          </Button>
        </div>
      </form>

      {response ? <StayResults tripId={tripId} response={response} /> : null}
    </div>
  );
}

function StayResults({
  tripId,
  response,
}: {
  tripId: string;
  response: StaySearchResponse;
}) {
  const { search } = response;
  return (
    <div className="space-y-3" data-testid="stay-results">
      <p className="text-xs text-muted-foreground">
        {response.results.length}{" "}
        {response.results.length === 1 ? "result" : "results"} from{" "}
        {response.sourceName}, retrieved {formatTimestamp(response.retrievedAt)}
        .{" "}
        {search.kind === "vacation_rental"
          ? "Vacation rentals"
          : "Hotels and other places Google lists"}{" "}
        in {search.location}, {formatDateOnly(search.checkIn, "short")} to{" "}
        {formatDateOnly(search.checkOut, "short")} ({nightsLabel(search.nights)}
        ), {guestsLabel(search.guests)}. Prices are in {search.currency} and
        include taxes and fees as Google showed them.
      </p>
      <p className="text-xs text-muted-foreground">
        Google Hotels prices a stay for the number of guests and has no room
        filter, so check how many rooms or beds a price covers before you book.
        Each result says whether it is a hotel or a vacation rental.
      </p>
      {response.cached ? (
        <p
          className="flex items-start gap-1.5 text-xs text-muted-foreground"
          data-testid="stay-cached-notice"
        >
          <History className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Reused the same search from {formatTimestamp(response.retrievedAt)} to
          save the search quota. Prices were not refreshed and may have changed.
        </p>
      ) : null}
      {response.results.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          No places with prices matched. Try other dates, a wider price range,
          or the other type.
        </p>
      ) : (
        <ul className="grid gap-3">
          {response.results.map((result) => (
            <StayResultCard
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

function StayResultCard({
  tripId,
  offer,
  token,
}: {
  tripId: string;
  offer: StayOffer;
  token: string;
}) {
  const { run, pending } = useAction();
  const [saved, setSaved] = useState<"option" | "booking" | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const nightly = offer.nightlyAmount
    ? formatMoneyValue(offer.nightlyAmount, offer.currency)
    : null;
  const total = offer.totalAmount
    ? formatMoneyValue(offer.totalAmount, offer.currency)
    : null;

  function save(asBooking: boolean) {
    run(() => saveStayAction(tripId, { token, asBooking }), {
      onSuccess: (data) => {
        setSaved(asBooking ? "booking" : (saved ?? "option"));
        if (data.alreadySaved && !asBooking) {
          toast.info("This stay is already in the trip's options.");
        } else {
          toast.success(
            asBooking
              ? "Saved to Accommodations. You're marked as considering it."
              : "Saved to options for the group to review.",
          );
        }
      },
    });
  }

  return (
    <li
      className="rounded-lg border bg-background p-3 sm:p-4"
      data-testid="stay-result"
    >
      <div className="flex flex-col gap-3 sm:flex-row">
        {offer.imageUrl && !imageFailed ? (
          // Thumbnails come from Google's image hosts and listing sites; they are shown as sent.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={offer.imageUrl}
            alt={`Photo of ${offer.name}`}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setImageFailed(true)}
            className="h-32 w-full shrink-0 rounded-md bg-muted object-cover sm:h-24 sm:w-36"
          />
        ) : null}
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium break-words">{offer.name}</span>
            <Pill tone="neutral">{STAY_KIND_LABELS[offer.kind]}</Pill>
            {offer.sponsored ? <Pill tone="warning">Sponsored</Pill> : null}
          </div>
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            {offer.hotelClass ? <span>{offer.hotelClass}-star</span> : null}
            {offer.rating !== null ? (
              <span className="inline-flex items-center gap-0.5">
                <Star className="size-3" aria-hidden />
                {offer.rating.toFixed(1)}/5
                {offer.reviews ? ` (${offer.reviews} reviews)` : ""}
              </span>
            ) : null}
            {offer.essentialInfo.length > 0 ? (
              <span>{offer.essentialInfo.slice(0, 4).join(" · ")}</span>
            ) : null}
          </p>
          {offer.latitude !== null && offer.longitude !== null ? (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="size-3" aria-hidden />
              Near {offer.location} ({offer.latitude.toFixed(3)},{" "}
              {offer.longitude.toFixed(3)})
            </p>
          ) : null}
          {offer.priceSources.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              Prices from{" "}
              {offer.priceSources.map((price) => price.source).join(", ")}
            </p>
          ) : null}
        </div>
        <div className="text-left sm:text-right">
          {nightly ? (
            <p className="text-lg font-semibold" data-testid="stay-nightly">
              {nightly}
              <span className="text-xs font-normal text-muted-foreground">
                {" "}
                a night
              </span>
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground" data-testid="stay-total">
            {total
              ? `${total} ${offer.currency} total, ${nightsLabel(offer.nights)}`
              : "Total not shown by Google"}
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
        <a
          href={offer.bookingUrl}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          Find on Google Hotels to book
          <ExternalLink className="size-3" aria-hidden />
        </a>
        {offer.propertyUrl ? (
          <a
            href={offer.propertyUrl}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            Property website
            <Link2 className="size-3" aria-hidden />
          </a>
        ) : null}
      </div>
    </li>
  );
}
