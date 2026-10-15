"use client";

import { Plus } from "lucide-react";
import { useState, useTransition } from "react";

import { FieldShell, useFieldId } from "@/components/shared/form-fields";
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
import { useZodForm } from "@/hooks/use-zod-form";
import { quickTripFormSchema } from "@/lib/validation/trip";
import { createQuickTripAction } from "@/server/actions/trips";

export function QuickTripDialog() {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const { form, formError, applyResult } = useZodForm(quickTripFormSchema, {
    title: "",
    destination: "",
    startDate: "",
    endDate: "",
  });
  const ids = {
    title: useFieldId("title"),
    destination: useFieldId("destination"),
    start: useFieldId("start"),
    end: useFieldId("end"),
  };
  const errors = form.formState.errors;

  const onSubmit = form.handleSubmit(() => {
    startTransition(async () => {
      const result = await createQuickTripAction(form.getValues());
      applyResult(result);
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Plus aria-hidden />
          Create manually
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>Create a trip</DialogTitle>
            <DialogDescription>
              Only the name is required. Everything else can wait.
            </DialogDescription>
          </DialogHeader>
          <FormError message={formError} />
          <FieldShell
            label="Trip name"
            htmlFor={ids.title}
            error={errors.title?.message}
          >
            <Input
              id={ids.title}
              placeholder="Summer in Portugal"
              autoFocus
              aria-invalid={Boolean(errors.title)}
              {...form.register("title")}
            />
          </FieldShell>
          <FieldShell
            label="Destination"
            htmlFor={ids.destination}
            optional
            error={errors.destination?.message}
          >
            <Input
              id={ids.destination}
              placeholder="Lisbon"
              {...form.register("destination")}
            />
          </FieldShell>
          <div className="grid grid-cols-2 gap-3">
            <FieldShell
              label="Start date"
              htmlFor={ids.start}
              optional
              error={errors.startDate?.message}
            >
              <Input
                id={ids.start}
                type="date"
                {...form.register("startDate")}
              />
            </FieldShell>
            <FieldShell
              label="End date"
              htmlFor={ids.end}
              optional
              error={errors.endDate?.message}
            >
              <Input
                id={ids.end}
                type="date"
                aria-invalid={Boolean(errors.endDate)}
                {...form.register("endDate")}
              />
            </FieldShell>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating..." : "Create trip"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
