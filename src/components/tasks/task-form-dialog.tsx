"use client";

import { useState, useTransition } from "react";

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
import { TaskPriority } from "@/generated/prisma/enums";
import { useZodForm } from "@/hooks/use-zod-form";
import { TASK_PRIORITY_LABELS } from "@/lib/labels";
import { taskFormSchema, type TaskFormInput } from "@/lib/validation/task";
import { createTaskAction, updateTaskAction } from "@/server/actions/tasks";

export type RelatedChoices = {
  members: { id: string; name: string }[];
  options: { id: string; title: string }[];
  bookings: { id: string; title: string }[];
  events: { id: string; title: string }[];
};

export const EMPTY_TASK: TaskFormInput = {
  title: "",
  description: "",
  priority: "MEDIUM",
  dueDate: "",
  assigneeMemberId: "",
  relatedOptionId: "",
  relatedBookingId: "",
  relatedEventId: "",
};

export function TaskFormDialog({
  tripId,
  trigger,
  choices,
  initial = EMPTY_TASK,
  editing,
}: {
  tripId: string;
  trigger: React.ReactNode;
  choices: RelatedChoices;
  initial?: TaskFormInput;
  editing?: { id: string; version: number };
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit task" : "New task"}</DialogTitle>
          <DialogDescription>
            Give it an owner so nobody duplicates the work.
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <TaskForm
            tripId={tripId}
            choices={choices}
            initial={initial}
            editing={editing}
            onDone={() => setOpen(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function TaskForm({
  tripId,
  choices,
  initial,
  editing,
  onDone,
}: {
  tripId: string;
  choices: RelatedChoices;
  initial: TaskFormInput;
  editing?: { id: string; version: number };
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const { form, formError, applyResult } = useZodForm(taskFormSchema, initial);
  const errors = form.formState.errors;
  const id = {
    title: useFieldId("title"),
    description: useFieldId("description"),
    priority: useFieldId("priority"),
    due: useFieldId("due"),
    assignee: useFieldId("assignee"),
    option: useFieldId("option"),
    booking: useFieldId("booking"),
    event: useFieldId("event"),
  };
  return (
    <form
      className="grid gap-4"
      noValidate
      onSubmit={form.handleSubmit(() =>
        startTransition(async () => {
          const values = form.getValues();
          const result = editing
            ? await updateTaskAction(
                tripId,
                editing.id,
                values,
                editing.version,
              )
            : await createTaskAction(tripId, values);
          if (applyResult(result)) onDone();
        }),
      )}
    >
      <FormError message={formError} />
      <FieldShell
        label="Title"
        htmlFor={id.title}
        error={errors.title?.message}
      >
        <Input
          id={id.title}
          placeholder="Compare airport transfer options"
          aria-invalid={Boolean(errors.title)}
          {...form.register("title")}
        />
      </FieldShell>
      <FieldShell
        label="Details"
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
      <div className="grid gap-3 sm:grid-cols-3">
        <FieldShell label="Assignee" htmlFor={id.assignee}>
          <NativeSelect id={id.assignee} {...form.register("assigneeMemberId")}>
            <option value="">Unassigned</option>
            {choices.members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </NativeSelect>
        </FieldShell>
        <FieldShell label="Priority" htmlFor={id.priority}>
          <NativeSelect id={id.priority} {...form.register("priority")}>
            {Object.values(TaskPriority).map((value) => (
              <option key={value} value={value}>
                {TASK_PRIORITY_LABELS[value]}
              </option>
            ))}
          </NativeSelect>
        </FieldShell>
        <FieldShell
          label="Due"
          htmlFor={id.due}
          optional
          error={errors.dueDate?.message}
        >
          <Input id={id.due} type="date" {...form.register("dueDate")} />
        </FieldShell>
      </div>
      <details className="rounded-lg border px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium">
          Link to a trip item
        </summary>
        <div className="mt-3 grid gap-3">
          <FieldShell label="Saved option" htmlFor={id.option}>
            <NativeSelect id={id.option} {...form.register("relatedOptionId")}>
              <option value="">None</option>
              {choices.options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.title}
                </option>
              ))}
            </NativeSelect>
          </FieldShell>
          <FieldShell label="Booking" htmlFor={id.booking}>
            <NativeSelect
              id={id.booking}
              {...form.register("relatedBookingId")}
            >
              <option value="">None</option>
              {choices.bookings.map((booking) => (
                <option key={booking.id} value={booking.id}>
                  {booking.title}
                </option>
              ))}
            </NativeSelect>
          </FieldShell>
          <FieldShell label="Itinerary item" htmlFor={id.event}>
            <NativeSelect id={id.event} {...form.register("relatedEventId")}>
              <option value="">None</option>
              {choices.events.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.title}
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
          {pending ? "Saving..." : editing ? "Save changes" : "Create task"}
        </Button>
      </DialogFooter>
    </form>
  );
}
