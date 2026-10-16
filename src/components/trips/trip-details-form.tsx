"use client";

import { useTransition } from "react";
import { Controller } from "react-hook-form";

import {
  FieldShell,
  NativeSelect,
  useFieldId,
} from "@/components/shared/form-fields";
import { FormError } from "@/components/shared/form-error";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrangementStatus,
  BudgetBasis,
  BudgetComponent,
  DateFlexibility,
  TripTheme,
} from "@/generated/prisma/enums";
import { useZodForm } from "@/hooks/use-zod-form";
import type { ActionResult } from "@/lib/action-result";
import {
  ARRANGEMENT_LABELS,
  BUDGET_BASIS_LABELS,
  BUDGET_COMPONENT_LABELS,
  DATE_FLEXIBILITY_LABELS,
  TRIP_THEME_LABELS,
} from "@/lib/labels";
import {
  tripDetailsFormSchema,
  type TripDetailsFormInput,
} from "@/lib/validation/trip";

const ARRANGEMENT_FIELDS = [
  ["flightsStatus", "Flights"],
  ["lodgingStatus", "Lodging"],
  ["localTransportStatus", "Getting around"],
  ["activitiesStatus", "Activities"],
] as const;

export function TripDetailsForm({
  initial,
  onSubmit,
  onDone,
  submitLabel = "Save details",
}: {
  initial: TripDetailsFormInput;
  onSubmit: (values: TripDetailsFormInput) => Promise<ActionResult>;
  onDone?: () => void;
  submitLabel?: string;
}) {
  const [pending, startTransition] = useTransition();
  const { form, formError, applyResult } = useZodForm(
    tripDetailsFormSchema,
    initial,
  );
  const errors = form.formState.errors;
  const id = {
    title: useFieldId("title"),
    summary: useFieldId("summary"),
    destination: useFieldId("destination"),
    confirmed: useFieldId("confirmed"),
    departure: useFieldId("departure"),
    flyInto: useFieldId("flyInto"),
    flyOutOf: useFieldId("flyOutOf"),
    style: useFieldId("style"),
    theme: useFieldId("theme"),
    start: useFieldId("start"),
    end: useFieldId("end"),
    flexibility: useFieldId("flexibility"),
    dateNotes: useFieldId("dateNotes"),
    duration: useFieldId("duration"),
    groupSize: useFieldId("groupSize"),
    groupNotes: useFieldId("groupNotes"),
    budget: useFieldId("budget"),
    currency: useFieldId("currency"),
    basis: useFieldId("basis"),
    budgetNotes: useFieldId("budgetNotes"),
    arrangement: useFieldId("arrangement"),
  };

  const submit = form.handleSubmit(() => {
    startTransition(async () => {
      const result = await onSubmit(form.getValues());
      if (applyResult(result)) onDone?.();
    });
  });

  return (
    <form onSubmit={submit} className="grid gap-6" noValidate>
      <FormError message={formError} />
      <fieldset className="grid gap-3">
        <legend className="mb-1 text-sm font-semibold">Basics</legend>
        <FieldShell
          label="Trip name"
          htmlFor={id.title}
          error={errors.title?.message}
        >
          <Input
            id={id.title}
            aria-invalid={Boolean(errors.title)}
            {...form.register("title")}
          />
        </FieldShell>
        <FieldShell
          label="Summary"
          htmlFor={id.summary}
          optional
          error={errors.summary?.message}
        >
          <Textarea id={id.summary} rows={2} {...form.register("summary")} />
        </FieldShell>
      </fieldset>

      <fieldset className="grid gap-3">
        <legend className="mb-1 text-sm font-semibold">Where</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <FieldShell
            label="Destination"
            htmlFor={id.destination}
            optional
            error={errors.destination?.message}
          >
            <Input id={id.destination} {...form.register("destination")} />
          </FieldShell>
          <FieldShell
            label="Leaving from"
            htmlFor={id.departure}
            optional
            error={errors.departureLocation?.message}
          >
            <Input
              id={id.departure}
              placeholder="City or airport"
              {...form.register("departureLocation")}
            />
          </FieldShell>
        </div>
        <Controller
          control={form.control}
          name="destinationConfirmed"
          render={({ field }) => (
            <label
              htmlFor={id.confirmed}
              className="flex items-center gap-2 text-sm"
            >
              <Checkbox
                id={id.confirmed}
                checked={Boolean(field.value)}
                onCheckedChange={(value) => field.onChange(value === true)}
              />
              The destination is decided
            </label>
          )}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <FieldShell
            label="Flying into"
            htmlFor={id.flyInto}
            optional
            hint="Airport where people land, if not the destination"
            error={errors.flyIntoAirport?.message}
          >
            <Input
              id={id.flyInto}
              placeholder="SLC"
              {...form.register("flyIntoAirport")}
            />
          </FieldShell>
          <FieldShell
            label="Flying home from"
            htmlFor={id.flyOutOf}
            optional
            error={errors.flyOutOfAirport?.message}
          >
            <Input
              id={id.flyOutOf}
              placeholder="SLC"
              {...form.register("flyOutOfAirport")}
            />
          </FieldShell>
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
          <FieldShell
            label="Trip style or vibe"
            htmlFor={id.style}
            optional
            error={errors.tripStyle?.message}
          >
            <Input
              id={id.style}
              placeholder="Beaches, food, slow mornings"
              {...form.register("tripStyle")}
            />
          </FieldShell>
          <FieldShell label="Theme" htmlFor={id.theme} optional>
            <NativeSelect id={id.theme} {...form.register("theme")}>
              <option value="">Not set</option>
              {Object.values(TripTheme).map((value) => (
                <option key={value} value={value}>
                  {TRIP_THEME_LABELS[value]}
                </option>
              ))}
            </NativeSelect>
          </FieldShell>
        </div>
      </fieldset>

      <fieldset className="grid gap-3">
        <legend className="mb-1 text-sm font-semibold">When</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          <FieldShell
            label="Start date"
            htmlFor={id.start}
            optional
            error={errors.startDate?.message}
          >
            <Input id={id.start} type="date" {...form.register("startDate")} />
          </FieldShell>
          <FieldShell
            label="End date"
            htmlFor={id.end}
            optional
            error={errors.endDate?.message}
          >
            <Input
              id={id.end}
              type="date"
              aria-invalid={Boolean(errors.endDate)}
              {...form.register("endDate")}
            />
          </FieldShell>
          <FieldShell label="Dates are" htmlFor={id.flexibility}>
            <NativeSelect
              id={id.flexibility}
              {...form.register("dateFlexibility")}
            >
              {Object.values(DateFlexibility).map((value) => (
                <option key={value} value={value}>
                  {DATE_FLEXIBILITY_LABELS[value]}
                </option>
              ))}
            </NativeSelect>
          </FieldShell>
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
          <FieldShell
            label="Timing notes"
            htmlFor={id.dateNotes}
            optional
            error={errors.dateNotes?.message}
          >
            <Input
              id={id.dateNotes}
              placeholder="A long weekend in late May"
              {...form.register("dateNotes")}
            />
          </FieldShell>
          <FieldShell
            label="Length (days)"
            htmlFor={id.duration}
            optional
            error={errors.durationDays?.message}
          >
            <Input
              id={id.duration}
              inputMode="numeric"
              {...form.register("durationDays")}
            />
          </FieldShell>
        </div>
      </fieldset>

      <fieldset className="grid gap-3">
        <legend className="mb-1 text-sm font-semibold">Who</legend>
        <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
          <FieldShell
            label="Group size"
            htmlFor={id.groupSize}
            optional
            error={errors.groupSize?.message}
          >
            <Input
              id={id.groupSize}
              inputMode="numeric"
              {...form.register("groupSize")}
            />
          </FieldShell>
          <FieldShell
            label="About the group"
            htmlFor={id.groupNotes}
            optional
            error={errors.groupNotes?.message}
          >
            <Input
              id={id.groupNotes}
              placeholder="Four college friends"
              {...form.register("groupNotes")}
            />
          </FieldShell>
        </div>
      </fieldset>

      <fieldset className="grid gap-3">
        <legend className="mb-1 text-sm font-semibold">Budget</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          <FieldShell
            label="Amount"
            htmlFor={id.budget}
            optional
            error={errors.budgetAmount?.message}
          >
            <Input
              id={id.budget}
              inputMode="decimal"
              placeholder="1500"
              {...form.register("budgetAmount")}
            />
          </FieldShell>
          <FieldShell
            label="Currency"
            htmlFor={id.currency}
            optional
            error={errors.budgetCurrency?.message}
          >
            <Input
              id={id.currency}
              placeholder="USD"
              maxLength={3}
              className="uppercase"
              {...form.register("budgetCurrency")}
            />
          </FieldShell>
          <FieldShell label="Applies to" htmlFor={id.basis}>
            <NativeSelect id={id.basis} {...form.register("budgetBasis")}>
              {Object.values(BudgetBasis).map((value) => (
                <option key={value} value={value}>
                  {BUDGET_BASIS_LABELS[value]}
                </option>
              ))}
            </NativeSelect>
          </FieldShell>
        </div>
        <Controller
          control={form.control}
          name="budgetIncludes"
          render={({ field }) => {
            const selected = new Set(
              (field.value as string[] | undefined) ?? [],
            );
            return (
              <div className="space-y-1.5">
                <p className="text-[13px] font-medium">The budget covers</p>
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  {Object.values(BudgetComponent).map((value) => (
                    <label
                      key={value}
                      className="flex items-center gap-2 text-sm"
                    >
                      <Checkbox
                        checked={selected.has(value)}
                        onCheckedChange={(checked) => {
                          const next = new Set(selected);
                          if (checked === true) next.add(value);
                          else next.delete(value);
                          field.onChange([...next]);
                        }}
                      />
                      {BUDGET_COMPONENT_LABELS[value]}
                    </label>
                  ))}
                </div>
              </div>
            );
          }}
        />
        <FieldShell
          label="Budget notes"
          htmlFor={id.budgetNotes}
          optional
          error={errors.budgetNotes?.message}
        >
          <Input
            id={id.budgetNotes}
            placeholder="Sam can only do about half"
            {...form.register("budgetNotes")}
          />
        </FieldShell>
      </fieldset>

      <fieldset className="grid gap-3">
        <legend className="mb-1 text-sm font-semibold">Arrangements</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {ARRANGEMENT_FIELDS.map(([name, label]) => (
            <FieldShell
              key={name}
              label={label}
              htmlFor={`${id.arrangement}-${name}`}
            >
              <NativeSelect
                id={`${id.arrangement}-${name}`}
                {...form.register(name)}
              >
                {Object.values(ArrangementStatus).map((value) => (
                  <option key={value} value={value}>
                    {ARRANGEMENT_LABELS[value]}
                  </option>
                ))}
              </NativeSelect>
            </FieldShell>
          ))}
        </div>
      </fieldset>

      <div className="sticky bottom-0 -mx-1 flex justify-end gap-2 border-t bg-popover px-1 pt-3 pb-1">
        {onDone ? (
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" disabled={pending}>
          {pending ? "Saving..." : submitLabel}
        </Button>
      </div>
    </form>
  );
}
