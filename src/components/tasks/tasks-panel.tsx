"use client";

import {
  CalendarClock,
  Check,
  Link2,
  ListChecks,
  MoreHorizontal,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";

import { ConfirmAction } from "@/components/shared/confirm-button";
import { EmptyState } from "@/components/shared/empty-state";
import { NativeSelect } from "@/components/shared/form-fields";
import { SectionHeader } from "@/components/shared/page-header";
import {
  PriorityBadge,
  TaskStatusBadge,
} from "@/components/shared/status-badge";
import { UserAvatar } from "@/components/user-avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ASSISTANT_NAME } from "@/config/brand";
import type {
  MemberRole,
  TaskPriority,
  TaskStatus,
} from "@/generated/prisma/enums";
import { useAction } from "@/hooks/use-action";
import { formatDateOnly, todayDateOnly } from "@/lib/dates";
import { cn } from "@/lib/utils";
import {
  assignTaskAction,
  deleteTaskAction,
  reviewTaskSuggestionAction,
  setTaskStatusAction,
} from "@/server/actions/tasks";

import { TaskFormDialog, type RelatedChoices } from "./task-form-dialog";

export type TaskView = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  version: number;
  origin: string;
  assignee: {
    id: string;
    user: {
      id: string;
      name: string | null;
      image: string | null;
      email: string | null;
    };
  } | null;
  createdBy: { id: string; name: string | null } | null;
  relatedOption: { id: string; title: string } | null;
  relatedBooking: { id: string; title: string } | null;
  relatedEvent: { id: string; title: string } | null;
};

type Filter = "all" | "mine" | "unassigned";

export function TasksPanel({
  tripId,
  tasks,
  choices,
  currentMemberId,
  currentUserId,
  role,
}: {
  tripId: string;
  tasks: TaskView[];
  choices: RelatedChoices;
  currentMemberId: string;
  currentUserId: string;
  role: MemberRole;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [showDone, setShowDone] = useState(false);
  const suggested = tasks.filter((task) => task.status === "SUGGESTED");
  const active = tasks.filter(
    (task) => task.status === "OPEN" || task.status === "IN_PROGRESS",
  );
  const done = tasks.filter(
    (task) => task.status === "COMPLETED" || task.status === "CANCELLED",
  );
  const visible = active.filter((task) =>
    filter === "mine"
      ? task.assignee?.id === currentMemberId
      : filter === "unassigned"
        ? !task.assignee
        : true,
  );

  return (
    <section aria-labelledby="tasks-heading" className="space-y-4">
      <SectionHeader
        title={<span id="tasks-heading">Tasks</span>}
        description="Who is doing what, so nobody researches the same thing twice."
        actions={
          <TaskFormDialog
            tripId={tripId}
            choices={choices}
            trigger={
              <Button size="sm">
                <Plus aria-hidden />
                New task
              </Button>
            }
          />
        }
      />

      {suggested.length > 0 ? (
        <div
          className="rounded-xl border border-dashed border-amber-300 bg-amber-50/50 p-4"
          data-testid="suggested-tasks"
        >
          <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-950">
            <Sparkles className="size-4" aria-hidden />
            Suggested by {ASSISTANT_NAME}
          </p>
          <p className="text-xs text-amber-900/80">
            These aren&apos;t on the list until someone accepts them.
          </p>
          <ul className="mt-3 space-y-2">
            {suggested.map((task) => (
              <SuggestedTaskRow key={task.id} tripId={tripId} task={task} />
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          role="group"
          aria-label="Filter tasks"
          className="inline-flex rounded-lg border bg-card p-0.5"
        >
          {(["all", "mine", "unassigned"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors",
                filter === value && "bg-secondary text-foreground",
              )}
            >
              {value === "all"
                ? "All open"
                : value === "mine"
                  ? "Assigned to me"
                  : "Unassigned"}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">
          {active.length} open
        </span>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          compact
          icon={ListChecks}
          title={active.length === 0 ? "No open tasks" : "Nothing in this view"}
          description={
            active.length === 0
              ? "Add a task or ask Atlas what still needs doing."
              : "Try another filter."
          }
        />
      ) : (
        <ul
          className="divide-y rounded-xl border bg-card"
          data-testid="task-list"
        >
          {visible.map((task) => (
            <TaskRow
              key={task.id}
              tripId={tripId}
              task={task}
              choices={choices}
              canDelete={
                role === "ORGANIZER" || task.createdBy?.id === currentUserId
              }
            />
          ))}
        </ul>
      )}

      {done.length > 0 ? (
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowDone((value) => !value)}
            aria-expanded={showDone}
          >
            {showDone ? "Hide" : "Show"} {done.length} completed or cancelled
          </Button>
          {showDone ? (
            <ul className="mt-2 divide-y rounded-xl border bg-card/60">
              {done.map((task) => (
                <TaskRow
                  key={task.id}
                  tripId={tripId}
                  task={task}
                  choices={choices}
                  canDelete={
                    role === "ORGANIZER" || task.createdBy?.id === currentUserId
                  }
                />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function SuggestedTaskRow({
  tripId,
  task,
}: {
  tripId: string;
  task: TaskView;
}) {
  const { run, pending } = useAction();
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-medium">{task.title}</p>
        {task.description ? (
          <p className="text-xs text-muted-foreground">{task.description}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() =>
            run(() => reviewTaskSuggestionAction(tripId, task.id, false), {
              success: "Suggestion dismissed",
            })
          }
        >
          <X aria-hidden />
          Dismiss
        </Button>
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            run(() => reviewTaskSuggestionAction(tripId, task.id, true), {
              success: "Added to tasks",
            })
          }
        >
          <Check aria-hidden />
          Accept
        </Button>
      </div>
    </li>
  );
}

function TaskRow({
  tripId,
  task,
  choices,
  canDelete,
}: {
  tripId: string;
  task: TaskView;
  choices: RelatedChoices;
  canDelete: boolean;
}) {
  const { run, pending } = useAction();
  const completed = task.status === "COMPLETED";
  const overdue =
    task.dueDate && !completed && task.dueDate.slice(0, 10) < todayDateOnly();
  const related =
    task.relatedOption?.title ??
    task.relatedBooking?.title ??
    task.relatedEvent?.title;
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <Checkbox
        className="mt-0.5"
        checked={completed}
        disabled={pending || task.status === "CANCELLED"}
        onCheckedChange={(checked) =>
          run(
            () =>
              setTaskStatusAction(
                tripId,
                task.id,
                checked === true ? "COMPLETED" : "OPEN",
              ),
            {
              success: checked === true ? "Task completed" : "Task reopened",
            },
          )
        }
        aria-label={
          completed ? `Reopen ${task.title}` : `Complete ${task.title}`
        }
      />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <p
            className={cn(
              "text-sm font-medium",
              completed && "text-muted-foreground line-through",
            )}
          >
            {task.title}
          </p>
          {task.status === "IN_PROGRESS" || task.status === "CANCELLED" ? (
            <TaskStatusBadge status={task.status} />
          ) : null}
          <PriorityBadge priority={task.priority} />
        </div>
        {task.description ? (
          <p className="text-xs text-muted-foreground">{task.description}</p>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {task.dueDate ? (
            <span
              className={cn(
                "inline-flex items-center gap-1",
                overdue && "text-destructive",
              )}
            >
              <CalendarClock className="size-3" aria-hidden />
              Due {formatDateOnly(task.dueDate, "short")}
            </span>
          ) : null}
          {related ? (
            <span className="inline-flex items-center gap-1">
              <Link2 className="size-3" aria-hidden />
              {related}
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <label htmlFor={`assignee-${task.id}`} className="sr-only">
          Assignee for {task.title}
        </label>
        {task.assignee ? (
          <UserAvatar
            name={task.assignee.user.name}
            image={task.assignee.user.image}
            className="size-6"
          />
        ) : null}
        <NativeSelect
          id={`assignee-${task.id}`}
          className="h-7 w-32 text-xs md:text-xs"
          value={task.assignee?.id ?? ""}
          disabled={pending}
          onChange={(event) =>
            run(
              () =>
                assignTaskAction(tripId, task.id, event.target.value || null),
              { success: "Assignee updated" },
            )
          }
        >
          <option value="">Unassigned</option>
          {choices.members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </NativeSelect>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`More actions for ${task.title}`}
              disabled={pending}
            >
              <MoreHorizontal aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {task.status === "OPEN" ? (
              <DropdownMenuItem
                onSelect={() =>
                  run(() => setTaskStatusAction(tripId, task.id, "IN_PROGRESS"))
                }
              >
                Mark in progress
              </DropdownMenuItem>
            ) : null}
            {task.status === "IN_PROGRESS" ? (
              <DropdownMenuItem
                onSelect={() =>
                  run(() => setTaskStatusAction(tripId, task.id, "OPEN"))
                }
              >
                Mark not started
              </DropdownMenuItem>
            ) : null}
            {task.status !== "CANCELLED" && task.status !== "COMPLETED" ? (
              <DropdownMenuItem
                onSelect={() =>
                  run(() => setTaskStatusAction(tripId, task.id, "CANCELLED"))
                }
              >
                Cancel task
              </DropdownMenuItem>
            ) : null}
            {task.status === "CANCELLED" ? (
              <DropdownMenuItem
                onSelect={() =>
                  run(() => setTaskStatusAction(tripId, task.id, "OPEN"))
                }
              >
                Reopen
              </DropdownMenuItem>
            ) : null}
            <TaskFormDialog
              tripId={tripId}
              choices={choices}
              editing={{ id: task.id, version: task.version }}
              initial={{
                title: task.title,
                description: task.description ?? "",
                priority: task.priority,
                dueDate: task.dueDate?.slice(0, 10) ?? "",
                assigneeMemberId: task.assignee?.id ?? "",
                relatedOptionId: task.relatedOption?.id ?? "",
                relatedBookingId: task.relatedBooking?.id ?? "",
                relatedEventId: task.relatedEvent?.id ?? "",
              }}
              trigger={
                <DropdownMenuItem onSelect={(event) => event.preventDefault()}>
                  <Pencil aria-hidden />
                  Edit
                </DropdownMenuItem>
              }
            />
            {canDelete ? (
              <>
                <DropdownMenuSeparator />
                <ConfirmAction
                  title={`Delete "${task.title}"?`}
                  description="The task is removed for everyone. Consider cancelling it instead to keep a record."
                  onConfirm={() =>
                    run(() => deleteTaskAction(tripId, task.id), {
                      success: "Task deleted",
                    })
                  }
                  trigger={
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={(event) => event.preventDefault()}
                    >
                      <Trash2 aria-hidden />
                      Delete
                    </DropdownMenuItem>
                  }
                />
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}
