"use client";

import { Link2 } from "lucide-react";
import { useState, useTransition } from "react";
import { Controller } from "react-hook-form";
import { toast } from "sonner";

import {
  FieldShell,
  NativeSelect,
  useFieldId,
} from "@/components/shared/form-fields";
import { FormError } from "@/components/shared/form-error";
import { Pill } from "@/components/shared/status-badge";
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
import { useZodForm } from "@/hooks/use-zod-form";
import { parseListingLink } from "@/lib/domain/listing-link";
import {
  stayLinkFormSchema,
  type StayLinkFormInput,
} from "@/lib/validation/stays";
import { addStayFromLinkAction } from "@/server/actions/stays";

type Member = { id: string; name: string };

/**
 * Adds a place from Airbnb, Vrbo, Booking.com, or any other listing link. The app reads only the
 * link itself to name the site; it never opens the page, so the traveler types the details.
 */
export function StayLinkDialog({
  tripId,
  members,
  currentMemberId,
  currency,
  defaults,
}: {
  tripId: string;
  members: Member[];
  currentMemberId: string;
  currency: string;
  defaults: { checkIn: string; checkOut: string };
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Link2 aria-hidden />
          Add from link
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a stay from a link</DialogTitle>
          <DialogDescription>
            Paste a listing from Airbnb, Vrbo, Booking.com, or any other site.
            The app keeps the link and names the site, but never opens the page,
            so enter the details as the listing shows them.
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <StayLinkForm
            tripId={tripId}
            members={members}
            initial={{
              url: "",
              title: "",
              checkIn: defaults.checkIn,
              checkOut: defaults.checkOut,
              priceAmount: "",
              priceBasis: "total",
              currency,
              travelers: [currentMemberId],
              booked: false,
              notes: "",
            }}
            onDone={() => setOpen(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function StayLinkForm({
  tripId,
  members,
  initial,
  onDone,
}: {
  tripId: string;
  members: Member[];
  initial: StayLinkFormInput;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const { form, formError, applyResult } = useZodForm(
    stayLinkFormSchema,
    initial,
  );
  const errors = form.formState.errors;
  const url = form.watch("url");
  const travelers = form.watch("travelers");
  const link = url ? parseListingLink(url) : null;
  const id = {
    url: useFieldId("url"),
    title: useFieldId("title"),
    checkIn: useFieldId("checkIn"),
    checkOut: useFieldId("checkOut"),
    price: useFieldId("price"),
    basis: useFieldId("basis"),
    currency: useFieldId("currency"),
    booked: useFieldId("booked"),
    notes: useFieldId("notes"),
  };

  function onUrlBlur() {
    const parsed = parseListingLink(form.getValues("url"));
    if (parsed?.suggestedName && !form.getValues("title").trim()) {
      form.setValue("title", parsed.suggestedName, { shouldValidate: true });
    }
  }

  function toggle(memberId: string, checked: boolean) {
    const current = form.getValues("travelers");
    form.setValue(
      "travelers",
      checked
        ? [...new Set([...current, memberId])]
        : current.filter((value) => value !== memberId),
    );
  }

  const submit = form.handleSubmit(() =>
    startTransition(async () => {
      const result = await addStayFromLinkAction(tripId, form.getValues());
      if (applyResult(result)) {
        toast.success(
          form.getValues("booked")
            ? "Added to Accommodations as booked."
            : "Added to Accommodations as considering.",
        );
        onDone();
      }
    }),
  );

  return (
    <form
      noValidate
      className="grid gap-4"
      aria-label="Add a stay from a link"
      onSubmit={submit}
    >
      <FormError message={formError} />
      <FieldShell
        label="Listing link"
        htmlFor={id.url}
        error={errors.url?.message}
      >
        <Input
          id={id.url}
          type="url"
          inputMode="url"
          placeholder="https://www.airbnb.com/rooms/..."
          aria-invalid={Boolean(errors.url)}
          {...form.register("url", { onBlur: onUrlBlur })}
        />
      </FieldShell>
      {link ? (
        <p
          className="-mt-2 flex items-center gap-2 text-xs text-muted-foreground"
          data-testid="stay-link-site"
        >
          <Pill tone={link.site.known ? "confirmed" : "neutral"}>
            {link.site.name}
          </Pill>
          {link.site.known
            ? `Recognized ${link.site.host}.`
            : `Saved as a link to ${link.site.host}.`}{" "}
          The page is not opened.
        </p>
      ) : null}
      <FieldShell label="Name" htmlFor={id.title} error={errors.title?.message}>
        <Input
          id={id.title}
          placeholder="Cabin near Main Street"
          aria-invalid={Boolean(errors.title)}
          {...form.register("title")}
        />
      </FieldShell>
      <div className="grid gap-3 sm:grid-cols-2">
        <FieldShell
          label="Check-in"
          htmlFor={id.checkIn}
          optional
          error={errors.checkIn?.message}
        >
          <Input id={id.checkIn} type="date" {...form.register("checkIn")} />
        </FieldShell>
        <FieldShell
          label="Check-out"
          htmlFor={id.checkOut}
          optional
          error={errors.checkOut?.message}
        >
          <Input id={id.checkOut} type="date" {...form.register("checkOut")} />
        </FieldShell>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_8rem_6rem]">
        <FieldShell
          label="Price"
          htmlFor={id.price}
          optional
          error={errors.priceAmount?.message}
        >
          <Input
            id={id.price}
            inputMode="decimal"
            placeholder="1450"
            aria-invalid={Boolean(errors.priceAmount)}
            {...form.register("priceAmount")}
          />
        </FieldShell>
        <FieldShell label="Price is" htmlFor={id.basis}>
          <NativeSelect id={id.basis} {...form.register("priceBasis")}>
            <option value="total">Total</option>
            <option value="night">Per night</option>
          </NativeSelect>
        </FieldShell>
        <FieldShell
          label="Currency"
          htmlFor={id.currency}
          error={errors.currency?.message}
        >
          <Input
            id={id.currency}
            maxLength={3}
            aria-invalid={Boolean(errors.currency)}
            {...form.register("currency")}
          />
        </FieldShell>
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-semibold">
          Who is staying here
        </legend>
        <ul className="divide-y rounded-lg border">
          {members.map((member) => (
            <li key={member.id} className="px-3 py-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={travelers.includes(member.id)}
                  onCheckedChange={(value) => toggle(member.id, value === true)}
                />
                {member.name}
              </label>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          Room assignments can be added later by editing the booking.
        </p>
      </fieldset>
      <Controller
        control={form.control}
        name="booked"
        render={({ field }) => (
          <label
            htmlFor={id.booked}
            className="flex items-center gap-2 text-sm"
          >
            <Checkbox
              id={id.booked}
              checked={Boolean(field.value)}
              onCheckedChange={(value) => field.onChange(value === true)}
            />
            Already booked (otherwise saved as considering)
          </label>
        )}
      />
      <FieldShell
        label="Notes"
        htmlFor={id.notes}
        optional
        error={errors.notes?.message}
      >
        <Textarea id={id.notes} rows={2} {...form.register("notes")} />
      </FieldShell>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving..." : "Add stay"}
        </Button>
      </DialogFooter>
    </form>
  );
}
