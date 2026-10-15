"use client";

import { Pencil } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { ActionResult } from "@/lib/action-result";
import type { TripDetailsFormInput } from "@/lib/validation/trip";

import { TripDetailsForm } from "./trip-details-form";

export function EditDetailsSheet({
  initial,
  save,
  triggerLabel = "Edit details",
  triggerVariant = "outline",
  description = "Changes are visible to everyone on the trip.",
}: {
  initial: TripDetailsFormInput;
  save: (values: TripDetailsFormInput) => Promise<ActionResult>;
  triggerLabel?: string;
  triggerVariant?: "outline" | "ghost" | "secondary";
  description?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant={triggerVariant} size="sm">
          <Pencil aria-hidden />
          {triggerLabel}
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Trip details</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">
          {open ? (
            <TripDetailsForm
              initial={initial}
              onSubmit={async (values) => {
                const result = await save(values);
                if (result.ok) toast.success("Trip details saved");
                return result;
              }}
              onDone={() => setOpen(false)}
            />
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
