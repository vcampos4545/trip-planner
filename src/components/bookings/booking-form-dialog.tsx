"use client";

import { useState, useTransition } from "react";
import { Controller, useFieldArray } from "react-hook-form";

import {
  FieldShell,
  NativeSelect,
  useFieldId,
} from "@/components/shared/form-fields";
import { FormError } from "@/components/shared/form-error";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  BookingCategory,
  BookingStatus,
  CostSplit,
} from "@/generated/prisma/enums";
import { useZodForm } from "@/hooks/use-zod-form";
import {
  BOOKING_CATEGORY_SINGULAR,
  BOOKING_STATUS_LABELS,
  COST_SPLIT_LABELS,
} from "@/lib/labels";
import {
  bookingFormSchema,
  type BookingFormInput,
} from "@/lib/validation/booking";
import {
  createBookingAction,
  updateBookingAction,
} from "@/server/actions/bookings";

type Member = { id: string; name: string };

export function BookingFormDialog({
  tripId,
  trigger,
  initial,
  editing,
  members,
  options,
  defaultOpen = false,
  onOpenChange,
}: {
  tripId: string;
  trigger?: React.ReactNode;
  initial: BookingFormInput;
  editing?: { id: string; version: number };
  members: Member[];
  options: { id: string; title: string }[];
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        onOpenChange?.(next);
      }}
    >
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {editing ? "Edit booking" : "Record a booking"}
          </DialogTitle>
          <DialogDescription>
            Keep track of something booked elsewhere, or something you still
            need to book. Nothing is purchased here.
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <BookingForm
            tripId={tripId}
            initial={initial}
            editing={editing}
            members={members}
            options={options}
            onDone={() => {
              setOpen(false);
              onOpenChange?.(false);
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function BookingForm({
  tripId,
  initial,
  editing,
  members,
  options,
  onDone,
}: {
  tripId: string;
  initial: BookingFormInput;
  editing?: { id: string; version: number };
  members: Member[];
  options: { id: string; title: string }[];
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const { form, formError, applyResult } = useZodForm(
    bookingFormSchema,
    initial,
  );
  const participants = useFieldArray({
    control: form.control,
    name: "participants",
  });
  const errors = form.formState.errors;
  const category = form.watch("category") as BookingCategory;
  const split = form.watch("costSplit") as CostSplit;
  const id = {
    category: useFieldId("category"),
    title: useFieldId("title"),
    status: useFieldId("status"),
    provider: useFieldId("provider"),
    reference: useFieldId("reference"),
    url: useFieldId("url"),
    from: useFieldId("from"),
    to: useFieldId("to"),
    location: useFieldId("location"),
    address: useFieldId("address"),
    startDate: useFieldId("startDate"),
    startTime: useFieldId("startTime"),
    endDate: useFieldId("endDate"),
    endTime: useFieldId("endTime"),
    cost: useFieldId("cost"),
    currency: useFieldId("currency"),
    split: useFieldId("split"),
    estimate: useFieldId("estimate"),
    notes: useFieldId("notes"),
    option: useFieldId("option"),
  };
  const travel = category === "FLIGHT" || category === "GROUND_TRANSPORT";
  const lodging = category === "ACCOMMODATION";
  const startLabel =
    category === "FLIGHT" ? "Departs" : lodging ? "Check-in" : "Starts";
  const endLabel =
    category === "FLIGHT" ? "Arrives" : lodging ? "Check-out" : "Ends";

  function toggleMember(memberId: string, checked: boolean) {
    const index = participants.fields.findIndex(
      (field) => field.memberId === memberId,
    );
    if (checked && index === -1)
      participants.append({
        memberId,
        status: "BOOKED",
        shareAmount: "",
        roomAssignment: "",
      });
    if (!checked && index !== -1) participants.remove(index);
  }

  return (
    <form
      className="grid gap-5"
      noValidate
      onSubmit={form.handleSubmit(() =>
        startTransition(async () => {
          const values = form.getValues();
          const result = editing
            ? await updateBookingAction(
                tripId,
                editing.id,
                values,
                editing.version,
              )
            : await createBookingAction(tripId, values);
          if (applyResult(result)) onDone();
        }),
      )}
    >
      <FormError message={formError} />
      <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
        <FieldShell label="Category" htmlFor={id.category}>
          <NativeSelect id={id.category} {...form.register("category")}>
            {Object.values(BookingCategory).map((value) => (
              <option key={value} value={value}>
                {BOOKING_CATEGORY_SINGULAR[value]}
              </option>
            ))}
          </NativeSelect>
        </FieldShell>
        <FieldShell
          label="Title"
          htmlFor={id.title}
          error={errors.title?.message}
        >
          <Input
            id={id.title}
            placeholder={
              category === "FLIGHT"
                ? "TP 202 Boston to Lisbon"
                : lodging
                  ? "Apartment in Alfama"
                  : "What is it?"
            }
            aria-invalid={Boolean(errors.title)}
            {...form.register("title")}
          />
        </FieldShell>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <FieldShell
          label="Status"
          htmlFor={id.status}
          hint="Only mark confirmed once you have a confirmation."
        >
          <NativeSelect id={id.status} {...form.register("status")}>
            {Object.values(BookingStatus).map((value) => (
              <option key={value} value={value}>
                {BOOKING_STATUS_LABELS[value]}
              </option>
            ))}
          </NativeSelect>
        </FieldShell>
        <FieldShell
          label="Provider"
          htmlFor={id.provider}
          optional
          error={errors.provider?.message}
        >
          <Input
            id={id.provider}
            placeholder={category === "FLIGHT" ? "Airline" : "Booking site"}
            {...form.register("provider")}
          />
        </FieldShell>
        <FieldShell
          label="Booking reference"
          htmlFor={id.reference}
          optional
          error={errors.reference?.message}
        >
          <Input
            id={id.reference}
            autoComplete="off"
            {...form.register("reference")}
          />
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

      {travel ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <FieldShell
            label="From"
            htmlFor={id.from}
            optional
            error={errors.fromLocation?.message}
          >
            <Input
              id={id.from}
              placeholder="BOS"
              {...form.register("fromLocation")}
            />
          </FieldShell>
          <FieldShell
            label="To"
            htmlFor={id.to}
            optional
            error={errors.toLocation?.message}
          >
            <Input
              id={id.to}
              placeholder="LIS"
              {...form.register("toLocation")}
            />
          </FieldShell>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <FieldShell
            label={lodging ? "Property" : "Place"}
            htmlFor={id.location}
            optional
            error={errors.locationName?.message}
          >
            <Input id={id.location} {...form.register("locationName")} />
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
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <FieldShell
          label={`${startLabel} date`}
          htmlFor={id.startDate}
          optional
          error={errors.startDate?.message}
        >
          <Input
            id={id.startDate}
            type="date"
            {...form.register("startDate")}
          />
        </FieldShell>
        <FieldShell
          label="Time"
          htmlFor={id.startTime}
          optional
          error={errors.startTime?.message}
        >
          <Input
            id={id.startTime}
            type="time"
            {...form.register("startTime")}
          />
        </FieldShell>
        <FieldShell
          label={`${endLabel} date`}
          htmlFor={id.endDate}
          optional
          error={errors.endDate?.message}
        >
          <Input id={id.endDate} type="date" {...form.register("endDate")} />
        </FieldShell>
        <FieldShell
          label="Time"
          htmlFor={id.endTime}
          optional
          error={errors.endTime?.message}
        >
          <Input id={id.endTime} type="time" {...form.register("endTime")} />
        </FieldShell>
      </div>

      <fieldset className="grid gap-3 rounded-lg border p-3">
        <legend className="px-1 text-sm font-semibold">Cost</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_6rem_1.4fr]">
          <FieldShell
            label="Amount"
            htmlFor={id.cost}
            optional
            hint="Leave blank if unknown. It won't count as zero."
            error={errors.costAmount?.message}
          >
            <Input
              id={id.cost}
              inputMode="decimal"
              {...form.register("costAmount")}
            />
          </FieldShell>
          <FieldShell
            label="Currency"
            htmlFor={id.currency}
            error={errors.currency?.message}
          >
            <Input
              id={id.currency}
              maxLength={3}
              className="uppercase"
              {...form.register("currency")}
            />
          </FieldShell>
          <FieldShell label="How it's split" htmlFor={id.split}>
            <NativeSelect id={id.split} {...form.register("costSplit")}>
              {Object.values(CostSplit).map((value) => (
                <option key={value} value={value}>
                  {COST_SPLIT_LABELS[value]}
                </option>
              ))}
            </NativeSelect>
          </FieldShell>
        </div>
        <Controller
          control={form.control}
          name="costIsEstimate"
          render={({ field }) => (
            <label
              htmlFor={id.estimate}
              className="flex items-center gap-2 text-sm"
            >
              <Checkbox
                id={id.estimate}
                checked={Boolean(field.value)}
                onCheckedChange={(value) => field.onChange(value === true)}
              />
              This is an estimate, not the final price
            </label>
          )}
        />
      </fieldset>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-semibold">
          Travelers on this booking
        </legend>
        <p className="text-xs text-muted-foreground">
          {category === "FLIGHT"
            ? "Add everyone on this flight. People can be booked or still considering it."
            : lodging
              ? "Add who is staying here. Room assignments are optional."
              : "Add who this booking is for."}
        </p>
        <ul className="divide-y rounded-lg border">
          {members.map((member) => {
            const index = participants.fields.findIndex(
              (field) => field.memberId === member.id,
            );
            const checked = index !== -1;
            return (
              <li
                key={member.id}
                className="flex flex-wrap items-center gap-3 px-3 py-2"
              >
                <label className="flex min-w-36 flex-1 items-center gap-2 text-sm">
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(value) =>
                      toggleMember(member.id, value === true)
                    }
                  />
                  {member.name}
                </label>
                {checked ? (
                  <>
                    <label
                      className="sr-only"
                      htmlFor={`p-status-${member.id}`}
                    >
                      Status for {member.name}
                    </label>
                    <NativeSelect
                      id={`p-status-${member.id}`}
                      className="h-7 w-32 text-xs md:text-xs"
                      {...form.register(`participants.${index}.status`)}
                    >
                      <option value="BOOKED">Booked</option>
                      <option value="CONSIDERING">Considering</option>
                    </NativeSelect>
                    {split === "CUSTOM" ? (
                      <>
                        <label
                          className="sr-only"
                          htmlFor={`p-share-${member.id}`}
                        >
                          Share for {member.name}
                        </label>
                        <Input
                          id={`p-share-${member.id}`}
                          className="h-7 w-24 text-xs md:text-xs"
                          inputMode="decimal"
                          placeholder="Share"
                          {...form.register(
                            `participants.${index}.shareAmount`,
                          )}
                        />
                      </>
                    ) : null}
                    {lodging ? (
                      <>
                        <label
                          className="sr-only"
                          htmlFor={`p-room-${member.id}`}
                        >
                          Room for {member.name}
                        </label>
                        <Input
                          id={`p-room-${member.id}`}
                          className="h-7 w-28 text-xs md:text-xs"
                          placeholder="Room"
                          {...form.register(
                            `participants.${index}.roomAssignment`,
                          )}
                        />
                      </>
                    ) : null}
                  </>
                ) : null}
              </li>
            );
          })}
        </ul>
        {errors.participants?.message ? (
          <p className="text-xs text-destructive">
            {errors.participants.message}
          </p>
        ) : null}
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <FieldShell
          label="Notes"
          htmlFor={id.notes}
          optional
          error={errors.notes?.message}
        >
          <Textarea id={id.notes} rows={2} {...form.register("notes")} />
        </FieldShell>
        <FieldShell
          label="Saved option"
          htmlFor={id.option}
          hint="Linking a booked option marks it as booked."
        >
          <NativeSelect id={id.option} {...form.register("researchOptionId")}>
            <option value="">None</option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.title}
              </option>
            ))}
          </NativeSelect>
        </FieldShell>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving..." : editing ? "Save changes" : "Save booking"}
        </Button>
      </DialogFooter>
    </form>
  );
}
