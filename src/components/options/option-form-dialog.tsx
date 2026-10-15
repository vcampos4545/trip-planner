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
import { OptionCategory } from "@/generated/prisma/enums";
import { useControllableOpen } from "@/hooks/use-controllable-open";
import { useZodForm } from "@/hooks/use-zod-form";
import { OPTION_CATEGORY_LABELS } from "@/lib/labels";
import {
  optionFormSchema,
  type OptionFormInput,
} from "@/lib/validation/research";
import {
  createOptionAction,
  updateOptionAction,
} from "@/server/actions/research";

export const EMPTY_OPTION: OptionFormInput = {
  category: "LODGING",
  title: "",
  description: "",
  url: "",
  sourceName: "",
  priceAmount: "",
  priceCurrency: "",
  priceUnit: "",
  priceNote: "",
  locationName: "",
  address: "",
  latitude: "",
  longitude: "",
};

export function OptionFormDialog({
  tripId,
  trigger,
  open: openProp,
  onOpenChange,
  initial = EMPTY_OPTION,
  editing,
  defaultCurrency,
}: {
  tripId: string;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  initial?: OptionFormInput;
  editing?: { id: string; version: number };
  defaultCurrency: string;
}) {
  const [open, setOpen] = useControllableOpen(openProp, onOpenChange);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit option" : "Add an option"}</DialogTitle>
          <DialogDescription>
            Save something you found so the group can compare it. Include the
            link so others can check the source.
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <OptionForm
            tripId={tripId}
            initial={{
              ...initial,
              priceCurrency: initial.priceCurrency || defaultCurrency,
            }}
            editing={editing}
            onDone={() => setOpen(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function OptionForm({
  tripId,
  initial,
  editing,
  onDone,
}: {
  tripId: string;
  initial: OptionFormInput;
  editing?: { id: string; version: number };
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const { form, formError, applyResult } = useZodForm(
    optionFormSchema,
    initial,
  );
  const errors = form.formState.errors;
  const id = {
    category: useFieldId("category"),
    title: useFieldId("title"),
    description: useFieldId("description"),
    url: useFieldId("url"),
    source: useFieldId("source"),
    price: useFieldId("price"),
    currency: useFieldId("currency"),
    unit: useFieldId("unit"),
    location: useFieldId("location"),
    address: useFieldId("address"),
  };
  return (
    <form
      className="grid gap-4"
      noValidate
      onSubmit={form.handleSubmit(() =>
        startTransition(async () => {
          const values = form.getValues();
          const result = editing
            ? await updateOptionAction(
                tripId,
                editing.id,
                values,
                editing.version,
              )
            : await createOptionAction(tripId, values);
          if (applyResult(result)) onDone();
        }),
      )}
    >
      <FormError message={formError} />
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <FieldShell label="Type" htmlFor={id.category}>
          <NativeSelect id={id.category} {...form.register("category")}>
            {Object.values(OptionCategory).map((value) => (
              <option key={value} value={value}>
                {OPTION_CATEGORY_LABELS[value]}
              </option>
            ))}
          </NativeSelect>
        </FieldShell>
        <FieldShell
          label="Name"
          htmlFor={id.title}
          error={errors.title?.message}
        >
          <Input
            id={id.title}
            placeholder="Casa do Largo apartment"
            aria-invalid={Boolean(errors.title)}
            {...form.register("title")}
          />
        </FieldShell>
      </div>
      <FieldShell
        label="Why it's worth considering"
        htmlFor={id.description}
        optional
        error={errors.description?.message}
      >
        <Textarea
          id={id.description}
          rows={3}
          {...form.register("description")}
        />
      </FieldShell>
      <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
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
          label="Source"
          htmlFor={id.source}
          optional
          error={errors.sourceName?.message}
        >
          <Input
            id={id.source}
            placeholder="Airbnb"
            {...form.register("sourceName")}
          />
        </FieldShell>
      </div>
      <div className="grid grid-cols-[1fr_6rem_1fr] gap-3">
        <FieldShell
          label="Price"
          htmlFor={id.price}
          optional
          error={errors.priceAmount?.message}
        >
          <Input
            id={id.price}
            inputMode="decimal"
            placeholder="Leave blank if unknown"
            {...form.register("priceAmount")}
          />
        </FieldShell>
        <FieldShell
          label="Currency"
          htmlFor={id.currency}
          error={errors.priceCurrency?.message}
        >
          <Input
            id={id.currency}
            maxLength={3}
            className="uppercase"
            {...form.register("priceCurrency")}
          />
        </FieldShell>
        <FieldShell
          label="Per"
          htmlFor={id.unit}
          optional
          error={errors.priceUnit?.message}
        >
          <Input
            id={id.unit}
            placeholder="night, person, total"
            {...form.register("priceUnit")}
          />
        </FieldShell>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <FieldShell
          label="Place or area"
          htmlFor={id.location}
          optional
          error={errors.locationName?.message}
        >
          <Input
            id={id.location}
            placeholder="Alfama"
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
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving..." : editing ? "Save changes" : "Save option"}
        </Button>
      </DialogFooter>
    </form>
  );
}
