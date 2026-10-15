"use client";

import { Plus, X } from "lucide-react";
import { useState, useTransition } from "react";

import {
  FieldShell,
  NativeSelect,
  useFieldId,
} from "@/components/shared/form-fields";
import { FormError } from "@/components/shared/form-error";
import { Pill } from "@/components/shared/status-badge";
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
import {
  PreferenceKind,
  PreferenceStrength,
  type RecordOrigin,
} from "@/generated/prisma/enums";
import { useAction } from "@/hooks/use-action";
import { useZodForm } from "@/hooks/use-zod-form";
import {
  PREFERENCE_KIND_LABELS,
  PREFERENCE_STRENGTH_LABELS,
} from "@/lib/labels";
import { cn } from "@/lib/utils";
import { preferenceFormSchema } from "@/lib/validation/trip";
import {
  addPreferenceAction,
  removePreferenceAction,
} from "@/server/actions/trips";

export type PreferenceView = {
  id: string;
  kind: PreferenceKind;
  strength: PreferenceStrength;
  description: string;
  origin: RecordOrigin;
  memberName: string | null;
};

export function PreferencesCard({
  tripId,
  preferences,
  members,
}: {
  tripId: string;
  preferences: PreferenceView[];
  members: { id: string; name: string }[];
}) {
  const { run, pending } = useAction();
  return (
    <section
      aria-labelledby="preferences-heading"
      className="rounded-xl border bg-card p-5"
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 id="preferences-heading" className="text-sm font-semibold">
            Preferences and constraints
          </h2>
          <p className="text-xs text-muted-foreground">
            Requirements are treated as hard constraints when planning.
          </p>
        </div>
        <AddPreferenceDialog tripId={tripId} members={members} />
      </div>
      {preferences.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          None yet. Add interests, accessibility needs, dietary needs, or
          anything the plan must respect.
        </p>
      ) : (
        <ul className="mt-3 flex flex-wrap gap-2">
          {preferences.map((preference) => (
            <li
              key={preference.id}
              className={cn(
                "inline-flex max-w-full items-center gap-1.5 rounded-lg border py-1 pr-1 pl-2.5 text-sm",
                preference.strength === "REQUIREMENT"
                  ? "border-primary/30 bg-accent"
                  : "bg-muted/40",
              )}
            >
              <span className="text-xs font-medium text-muted-foreground">
                {preference.strength === "REQUIREMENT"
                  ? "Must"
                  : PREFERENCE_KIND_LABELS[preference.kind]}
              </span>
              <span className="min-w-0 break-words">
                {preference.description}
                {preference.memberName ? (
                  <span className="text-muted-foreground">
                    {" "}
                    ({preference.memberName})
                  </span>
                ) : null}
              </span>
              {preference.origin === "ATLAS" ? (
                <Pill tone="info">via Atlas</Pill>
              ) : null}
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Remove ${preference.description}`}
                disabled={pending}
                onClick={() =>
                  run(() => removePreferenceAction(tripId, preference.id))
                }
              >
                <X aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AddPreferenceDialog({
  tripId,
  members,
}: {
  tripId: string;
  members: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const { form, formError, applyResult } = useZodForm(preferenceFormSchema, {
    kind: "INTEREST",
    strength: "PREFERENCE",
    description: "",
    memberId: "",
  });
  const ids = {
    kind: useFieldId("kind"),
    strength: useFieldId("strength"),
    description: useFieldId("description"),
    member: useFieldId("member"),
  };
  const errors = form.formState.errors;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) form.reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus aria-hidden />
          Add
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form
          className="grid gap-4"
          noValidate
          onSubmit={form.handleSubmit(() =>
            startTransition(async () => {
              if (
                applyResult(await addPreferenceAction(tripId, form.getValues()))
              ) {
                setOpen(false);
                form.reset();
              }
            }),
          )}
        >
          <DialogHeader>
            <DialogTitle>Add a preference</DialogTitle>
            <DialogDescription>
              Say whether it&apos;s a must-have or just nice to have.
            </DialogDescription>
          </DialogHeader>
          <FormError message={formError} />
          <FieldShell
            label="Description"
            htmlFor={ids.description}
            error={errors.description?.message}
          >
            <Input
              id={ids.description}
              placeholder="Step-free access to the hotel"
              {...form.register("description")}
            />
          </FieldShell>
          <div className="grid grid-cols-2 gap-3">
            <FieldShell label="Type" htmlFor={ids.kind}>
              <NativeSelect id={ids.kind} {...form.register("kind")}>
                {Object.values(PreferenceKind).map((value) => (
                  <option key={value} value={value}>
                    {PREFERENCE_KIND_LABELS[value]}
                  </option>
                ))}
              </NativeSelect>
            </FieldShell>
            <FieldShell label="How important" htmlFor={ids.strength}>
              <NativeSelect id={ids.strength} {...form.register("strength")}>
                {Object.values(PreferenceStrength).map((value) => (
                  <option key={value} value={value}>
                    {PREFERENCE_STRENGTH_LABELS[value]}
                  </option>
                ))}
              </NativeSelect>
            </FieldShell>
          </div>
          <FieldShell label="Applies to" htmlFor={ids.member}>
            <NativeSelect id={ids.member} {...form.register("memberId")}>
              <option value="">The whole group</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </NativeSelect>
          </FieldShell>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              Add preference
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
