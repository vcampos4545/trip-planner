"use client";

import { useTransition } from "react";

import {
  FieldShell,
  NativeSelect,
  useFieldId,
} from "@/components/shared/form-fields";
import { FormError } from "@/components/shared/form-error";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EventKind } from "@/generated/prisma/enums";
import { useControllableOpen } from "@/hooks/use-controllable-open";
import { useZodForm } from "@/hooks/use-zod-form";
import { EVENT_KIND_LABELS } from "@/lib/labels";
import {
  eventFormSchema,
  type EventFormInput,
} from "@/lib/validation/itinerary";
import {
  createEventAction,
  updateEventAction,
} from "@/server/actions/itinerary";

export function EventFormDialog({
  tripId,
  trigger,
  open: openProp,
  onOpenChange,
  initial,
  editing,
  isSuggestion = false,
  links,
  tripStart,
  tripEnd,
}: {
  tripId: string;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  initial: EventFormInput;
  editing?: { id: string; version: number };
  isSuggestion?: boolean;
  links: {
    options: { id: string; title: string }[];
    bookings: { id: string; title: string }[];
  };
  tripStart: string | null;
  tripEnd: string | null;
}) {
  const [open, setOpen] = useControllableOpen(openProp, onOpenChange);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {editing
              ? isSuggestion
                ? "Edit suggestion"
                : "Edit itinerary item"
              : "Add to itinerary"}
          </DialogTitle>
          <DialogDescription>
            {isSuggestion
              ? "Adjust the suggestion, then accept it to add it to the plan."
              : "Times are local to the destination. Leave them blank if they aren't set yet."}
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <EventForm
            tripId={tripId}
            initial={initial}
            editing={editing}
            isSuggestion={isSuggestion}
            links={links}
            tripStart={tripStart}
            tripEnd={tripEnd}
            onDone={() => setOpen(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function EventForm({
  tripId,
  initial,
  editing,
  isSuggestion,
  links,
  tripStart,
  tripEnd,
  onDone,
}: {
  tripId: string;
  initial: EventFormInput;
  editing?: { id: string; version: number };
  isSuggestion: boolean;
  links: {
    options: { id: string; title: string }[];
    bookings: { id: string; title: string }[];
  };
  tripStart: string | null;
  tripEnd: string | null;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const { form, formError, applyResult } = useZodForm(eventFormSchema, initial);
  const errors = form.formState.errors;
  const id = {
    title: useFieldId("title"),
    kind: useFieldId("kind"),
    status: useFieldId("status"),
    date: useFieldId("date"),
    start: useFieldId("start"),
    end: useFieldId("end"),
    location: useFieldId("location"),
    address: useFieldId("address"),
    lat: useFieldId("lat"),
    lng: useFieldId("lng"),
    url: useFieldId("url"),
    notes: useFieldId("notes"),
    option: useFieldId("option"),
    booking: useFieldId("booking"),
  };
  return (
    <form
      className="grid gap-4"
      noValidate
      onSubmit={form.handleSubmit(() =>
        startTransition(async () => {
          const values = form.getValues();
          const result = editing
            ? await updateEventAction(
                tripId,
                editing.id,
                values,
                editing.version,
              )
            : await createEventAction(tripId, values);
          if (applyResult(result)) onDone();
        }),
      )}
    >
      <FormError message={formError} />
      <FieldShell label="What" htmlFor={id.title} error={errors.title?.message}>
        <Input
          id={id.title}
          placeholder="Tram 28 and the castle"
          aria-invalid={Boolean(errors.title)}
          {...form.register("title")}
        />
      </FieldShell>
      <div className="grid grid-cols-2 gap-3">
        <FieldShell label="Type" htmlFor={id.kind}>
          <NativeSelect id={id.kind} {...form.register("kind")}>
            {Object.values(EventKind).map((value) => (
              <option key={value} value={value}>
                {EVENT_KIND_LABELS[value]}
              </option>
            ))}
          </NativeSelect>
        </FieldShell>
        {isSuggestion ? null : (
          <FieldShell label="Status" htmlFor={id.status}>
            <NativeSelect id={id.status} {...form.register("status")}>
              <option value="PLANNED">Planned</option>
              <option value="CONFIRMED">Confirmed</option>
            </NativeSelect>
          </FieldShell>
        )}
      </div>
      <div className="grid grid-cols-3 gap-3">
        <FieldShell label="Date" htmlFor={id.date} error={errors.date?.message}>
          <Input
            id={id.date}
            type="date"
            min={tripStart ?? undefined}
            max={tripEnd ?? undefined}
            {...form.register("date")}
          />
        </FieldShell>
        <FieldShell
          label="Start"
          htmlFor={id.start}
          optional
          error={errors.startTime?.message}
        >
          <Input id={id.start} type="time" {...form.register("startTime")} />
        </FieldShell>
        <FieldShell
          label="End"
          htmlFor={id.end}
          optional
          error={errors.endTime?.message}
        >
          <Input
            id={id.end}
            type="time"
            aria-invalid={Boolean(errors.endTime)}
            {...form.register("endTime")}
          />
        </FieldShell>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <FieldShell
          label="Place"
          htmlFor={id.location}
          optional
          error={errors.locationName?.message}
        >
          <Input
            id={id.location}
            placeholder="Castelo de São Jorge"
            {...form.register("locationName")}
          />
        </FieldShell>
        <FieldShell
          label="Address"
          htmlFor={id.address}
          optional
          error={errors.address?.message}
        >
          <Input id={id.address} {...form.register("address")} />
        </FieldShell>
      </div>
      <FieldShell
        label="Link"
        htmlFor={id.url}
        optional
        error={errors.url?.message}
      >
        <Input
          id={id.url}
          type="url"
          placeholder="https://"
          {...form.register("url")}
        />
      </FieldShell>
      <FieldShell
        label="Notes"
        htmlFor={id.notes}
        optional
        error={errors.notes?.message}
      >
        <Textarea id={id.notes} rows={2} {...form.register("notes")} />
      </FieldShell>
      <details className="rounded-lg border px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium">
          Map coordinates and links
        </summary>
        <div className="mt-3 grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <FieldShell
              label="Latitude"
              htmlFor={id.lat}
              optional
              error={errors.latitude?.message}
            >
              <Input
                id={id.lat}
                inputMode="decimal"
                {...form.register("latitude")}
              />
            </FieldShell>
            <FieldShell
              label="Longitude"
              htmlFor={id.lng}
              optional
              error={errors.longitude?.message}
            >
              <Input
                id={id.lng}
                inputMode="decimal"
                {...form.register("longitude")}
              />
            </FieldShell>
          </div>
          <FieldShell label="Saved option" htmlFor={id.option}>
            <NativeSelect id={id.option} {...form.register("researchOptionId")}>
              <option value="">None</option>
              {links.options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.title}
                </option>
              ))}
            </NativeSelect>
          </FieldShell>
          <FieldShell label="Booking" htmlFor={id.booking}>
            <NativeSelect id={id.booking} {...form.register("bookingId")}>
              <option value="">None</option>
              {links.bookings.map((booking) => (
                <option key={booking.id} value={booking.id}>
                  {booking.title}
                </option>
              ))}
            </NativeSelect>
          </FieldShell>
        </div>
      </details>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending
            ? "Saving..."
            : editing
              ? "Save changes"
              : "Add to itinerary"}
        </Button>
      </DialogFooter>
    </form>
  );
}
