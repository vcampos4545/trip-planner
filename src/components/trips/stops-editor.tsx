"use client";

import { ArrowDown, ArrowUp, Plus, Route, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { useFieldArray } from "react-hook-form";
import { toast } from "sonner";

import { FieldShell, useFieldId } from "@/components/shared/form-fields";
import { FormError } from "@/components/shared/form-error";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useZodForm } from "@/hooks/use-zod-form";
import { MAX_STOPS } from "@/lib/domain/stops";
import {
  tripRouteFormSchema,
  type TripRouteFormInput,
} from "@/lib/validation/trip";
import { updateTripRouteAction } from "@/server/actions/trips";

/** Edits the places a trip visits, in order, and the airports people fly into and home from. */
export function StopsEditorButton({
  tripId,
  version,
  initial,
}: {
  tripId: string;
  version: number;
  initial: TripRouteFormInput;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Route aria-hidden />
          Stops
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Stops and airports</DialogTitle>
          <DialogDescription>
            The places the trip visits, in order. Dates are optional. Changes
            are visible to everyone on the trip.
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <StopsForm
            tripId={tripId}
            version={version}
            initial={initial}
            onDone={() => setOpen(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function StopsForm({
  tripId,
  version,
  initial,
  onDone,
}: {
  tripId: string;
  version: number;
  initial: TripRouteFormInput;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const { form, formError, applyResult } = useZodForm(
    tripRouteFormSchema,
    initial,
  );
  const stops = useFieldArray({ control: form.control, name: "stops" });
  const errors = form.formState.errors;
  const id = {
    flyInto: useFieldId("flyInto"),
    flyOutOf: useFieldId("flyOutOf"),
    stop: useFieldId("stop"),
  };

  return (
    <form
      className="grid gap-5"
      noValidate
      onSubmit={form.handleSubmit(() =>
        startTransition(async () => {
          const result = await updateTripRouteAction(
            tripId,
            form.getValues(),
            version,
          );
          if (applyResult(result)) {
            toast.success("Stops saved");
            onDone();
          }
        }),
      )}
    >
      <FormError message={formError ?? errors.stops?.message} />
      <fieldset className="grid gap-3">
        <legend className="mb-1 text-sm font-semibold">Stops</legend>
        {stops.fields.length === 0 ? (
          <p className="rounded-lg border border-dashed px-3 py-3 text-sm text-muted-foreground">
            No stops yet. Add each place the trip visits, in travel order.
          </p>
        ) : (
          <ol className="grid gap-3" data-testid="stops-editor-list">
            {stops.fields.map((field, index) => {
              const stopErrors = errors.stops?.[index];
              return (
                <li
                  key={field.id}
                  className="grid gap-2 rounded-lg border bg-muted/20 p-3"
                >
                  <div className="flex items-end gap-2">
                    <FieldShell
                      label={`Stop ${index + 1}`}
                      htmlFor={`${id.stop}-${index}-name`}
                      error={stopErrors?.name?.message}
                      className="flex-1"
                    >
                      <Input
                        id={`${id.stop}-${index}-name`}
                        placeholder="Jackson Hole"
                        aria-invalid={Boolean(stopErrors?.name)}
                        {...form.register(`stops.${index}.name`)}
                      />
                    </FieldShell>
                    <div className="flex shrink-0 gap-1 pb-0.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Move stop ${index + 1} up`}
                        disabled={index === 0}
                        onClick={() => stops.move(index, index - 1)}
                      >
                        <ArrowUp aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Move stop ${index + 1} down`}
                        disabled={index === stops.fields.length - 1}
                        onClick={() => stops.move(index, index + 1)}
                      >
                        <ArrowDown aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove stop ${index + 1}`}
                        onClick={() => stops.remove(index)}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <FieldShell
                      label="Arrive"
                      htmlFor={`${id.stop}-${index}-start`}
                      optional
                      error={stopErrors?.startDate?.message}
                    >
                      <Input
                        id={`${id.stop}-${index}-start`}
                        type="date"
                        {...form.register(`stops.${index}.startDate`)}
                      />
                    </FieldShell>
                    <FieldShell
                      label="Leave"
                      htmlFor={`${id.stop}-${index}-end`}
                      optional
                      error={stopErrors?.endDate?.message}
                    >
                      <Input
                        id={`${id.stop}-${index}-end`}
                        type="date"
                        aria-invalid={Boolean(stopErrors?.endDate)}
                        {...form.register(`stops.${index}.endDate`)}
                      />
                    </FieldShell>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-fit"
          disabled={stops.fields.length >= MAX_STOPS}
          onClick={() => stops.append({ name: "", startDate: "", endDate: "" })}
        >
          <Plus aria-hidden />
          Add stop
        </Button>
      </fieldset>
      <fieldset className="grid gap-3">
        <legend className="mb-1 text-sm font-semibold">Airports</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <FieldShell
            label="Flying into"
            htmlFor={id.flyInto}
            optional
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
      </fieldset>
      <div className="flex justify-end gap-2 border-t pt-3">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving..." : "Save stops"}
        </Button>
      </div>
    </form>
  );
}
