"use client";

import { Check, CircleCheck, Plus, Trash2, Vote } from "lucide-react";
import { useState } from "react";

import { ConfirmAction } from "@/components/shared/confirm-button";
import { EmptyState } from "@/components/shared/empty-state";
import {
  FieldShell,
  NativeSelect,
  useFieldId,
} from "@/components/shared/form-fields";
import { SectionHeader } from "@/components/shared/page-header";
import {
  DecisionStatusBadge,
  OptionStatusBadge,
} from "@/components/shared/status-badge";
import { AvatarStack } from "@/components/user-avatar";
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
import type { DecisionStatus, OptionStatus } from "@/generated/prisma/enums";
import { useAction } from "@/hooks/use-action";
import { formatRelativeTime } from "@/lib/dates";
import { cn } from "@/lib/utils";
import {
  cancelDecisionAction,
  castVoteAction,
  createDecisionAction,
  resolveDecisionAction,
} from "@/server/actions/research";

export type DecisionView = {
  id: string;
  title: string;
  description: string | null;
  status: DecisionStatus;
  chosenChoiceId: string | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
  createdAt: string;
  createdBy: { name: string | null } | null;
  resolvedBy: { name: string | null } | null;
  choices: {
    id: string;
    label: string;
    option: { id: string; title: string; status: OptionStatus } | null;
    votes: {
      userId: string;
      user: { id: string; name: string | null; image: string | null };
    }[];
  }[];
};

export function DecisionsPanel({
  tripId,
  decisions,
  currentUserId,
  isOrganizer,
  memberCount,
  options,
}: {
  tripId: string;
  decisions: DecisionView[];
  currentUserId: string;
  isOrganizer: boolean;
  memberCount: number;
  options: { id: string; title: string }[];
}) {
  const open = decisions.filter((decision) => decision.status === "OPEN");
  const closed = decisions.filter((decision) => decision.status !== "OPEN");
  return (
    <section aria-labelledby="decisions-heading" className="space-y-4">
      <SectionHeader
        title={<span id="decisions-heading">Decisions</span>}
        description="Vote on choices. An organizer makes the final call; a majority never books anything."
        actions={<NewDecisionDialog tripId={tripId} options={options} />}
      />
      {open.length === 0 ? (
        <EmptyState
          compact
          icon={Vote}
          title="No open decisions"
          description="Start a vote here, or select options to compare on the Options tab."
        />
      ) : (
        <ul className="space-y-3">
          {open.map((decision) => (
            <DecisionCard
              key={decision.id}
              tripId={tripId}
              decision={decision}
              currentUserId={currentUserId}
              isOrganizer={isOrganizer}
              memberCount={memberCount}
            />
          ))}
        </ul>
      )}
      {closed.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Closed</p>
          <ul className="space-y-3">
            {closed.map((decision) => (
              <DecisionCard
                key={decision.id}
                tripId={tripId}
                decision={decision}
                currentUserId={currentUserId}
                isOrganizer={isOrganizer}
                memberCount={memberCount}
              />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function DecisionCard({
  tripId,
  decision,
  currentUserId,
  isOrganizer,
  memberCount,
}: {
  tripId: string;
  decision: DecisionView;
  currentUserId: string;
  isOrganizer: boolean;
  memberCount: number;
}) {
  const { run, pending } = useAction();
  const totalVotes = decision.choices.reduce(
    (sum, choice) => sum + choice.votes.length,
    0,
  );
  const myChoice = decision.choices.find((choice) =>
    choice.votes.some((vote) => vote.userId === currentUserId),
  );
  const isOpen = decision.status === "OPEN";
  const leader = [...decision.choices].sort(
    (a, b) => b.votes.length - a.votes.length,
  )[0];

  return (
    <li
      id={`decision-${decision.id}`}
      className="scroll-mt-24 rounded-xl border bg-card p-4"
      data-testid="decision-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{decision.title}</h3>
          <p className="text-xs text-muted-foreground">
            {totalVotes} of {memberCount} voted · started by{" "}
            {decision.createdBy?.name ?? "a member"}{" "}
            {formatRelativeTime(decision.createdAt)}
          </p>
        </div>
        <DecisionStatusBadge status={decision.status} />
      </div>
      {decision.description ? (
        <p className="mt-2 text-sm text-muted-foreground">
          {decision.description}
        </p>
      ) : null}
      <ul className="mt-3 space-y-2">
        {decision.choices.map((choice) => {
          const share =
            totalVotes > 0
              ? Math.round((choice.votes.length / totalVotes) * 100)
              : 0;
          const mine = myChoice?.id === choice.id;
          const chosen = decision.chosenChoiceId === choice.id;
          return (
            <li
              key={choice.id}
              className={cn(
                "relative overflow-hidden rounded-lg border",
                chosen && "border-violet-300 bg-violet-50/60",
                mine && isOpen && "border-primary/50",
              )}
            >
              <div
                className="absolute inset-y-0 left-0 bg-accent/70"
                style={{ width: `${share}%` }}
                aria-hidden
              />
              <div className="relative flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                    {chosen ? (
                      <CircleCheck
                        className="size-4 text-violet-700"
                        aria-label="Chosen"
                      />
                    ) : null}
                    {choice.label}
                    {choice.option ? (
                      <OptionStatusBadge status={choice.option.status} />
                    ) : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {choice.votes.length}{" "}
                    {choice.votes.length === 1 ? "vote" : "votes"}
                  </p>
                </div>
                <AvatarStack
                  people={choice.votes.map((vote) => vote.user)}
                  max={3}
                  size="size-5"
                />
                {isOpen ? (
                  <Button
                    size="sm"
                    variant={mine ? "default" : "outline"}
                    disabled={pending}
                    aria-pressed={mine}
                    onClick={() =>
                      run(
                        () =>
                          castVoteAction(
                            tripId,
                            decision.id,
                            mine ? null : choice.id,
                          ),
                        { success: mine ? "Vote removed" : "Vote saved" },
                      )
                    }
                  >
                    {mine ? <Check aria-hidden /> : null}
                    {mine ? "Your vote" : "Vote"}
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {decision.status === "RESOLVED" ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Decided by {decision.resolvedBy?.name ?? "an organizer"}
          {decision.resolvedAt
            ? ` ${formatRelativeTime(decision.resolvedAt)}`
            : ""}
          {decision.resolutionNote ? `: ${decision.resolutionNote}` : ""}. The
          chosen option is approved, not booked. Record the booking once
          it&apos;s made.
        </p>
      ) : null}
      {isOpen && isOrganizer ? (
        <div className="mt-3 flex flex-wrap justify-end gap-2 border-t pt-3">
          <ConfirmAction
            title="Close this vote without deciding?"
            description="Votes are kept for reference. Nothing is approved."
            confirmLabel="Close vote"
            onConfirm={() =>
              run(() => cancelDecisionAction(tripId, decision.id), {
                success: "Vote closed",
              })
            }
            trigger={
              <Button variant="ghost" size="sm" disabled={pending}>
                <Trash2 aria-hidden />
                Close without deciding
              </Button>
            }
          />
          <ResolveDialog
            tripId={tripId}
            decision={decision}
            defaultChoiceId={leader?.id ?? decision.choices[0]?.id ?? ""}
          />
        </div>
      ) : null}
    </li>
  );
}

function ResolveDialog({
  tripId,
  decision,
  defaultChoiceId,
}: {
  tripId: string;
  decision: DecisionView;
  defaultChoiceId: string;
}) {
  const [open, setOpen] = useState(false);
  const [choiceId, setChoiceId] = useState(defaultChoiceId);
  const [note, setNote] = useState("");
  const { run, pending } = useAction();
  const choiceField = useFieldId("choice");
  const noteField = useFieldId("note");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">Resolve decision</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Resolve: {decision.title}</DialogTitle>
          <DialogDescription>
            Pick the outcome. You can choose differently from the vote. A linked
            option becomes approved, which is still not a booking.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            run(
              () =>
                resolveDecisionAction(tripId, decision.id, { choiceId, note }),
              {
                success: "Decision resolved",
                onSuccess: () => setOpen(false),
              },
            );
          }}
        >
          <FieldShell label="Outcome" htmlFor={choiceField}>
            <NativeSelect
              id={choiceField}
              value={choiceId}
              onChange={(event) => setChoiceId(event.target.value)}
            >
              {decision.choices.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.label} ({choice.votes.length}{" "}
                  {choice.votes.length === 1 ? "vote" : "votes"})
                </option>
              ))}
            </NativeSelect>
          </FieldShell>
          <FieldShell label="Note" htmlFor={noteField} optional>
            <Input
              id={noteField}
              value={note}
              maxLength={500}
              onChange={(event) => setNote(event.target.value)}
            />
          </FieldShell>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !choiceId}>
              Resolve
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NewDecisionDialog({
  tripId,
  options,
}: {
  tripId: string;
  options: { id: string; title: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [choices, setChoices] = useState<
    { label: string; researchOptionId: string }[]
  >([
    { label: "", researchOptionId: "" },
    { label: "", researchOptionId: "" },
  ]);
  const { run, pending } = useAction();
  const titleField = useFieldId("question");

  function reset() {
    setTitle("");
    setChoices([
      { label: "", researchOptionId: "" },
      { label: "", researchOptionId: "" },
    ]);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus aria-hidden />
          New decision
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Start a vote</DialogTitle>
          <DialogDescription>
            Add two to eight choices. Link a choice to a saved option to keep
            them connected.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            run(
              () =>
                createDecisionAction(tripId, {
                  title,
                  description: "",
                  choices,
                }),
              {
                success: "Vote started",
                onSuccess: () => {
                  setOpen(false);
                  reset();
                },
              },
            );
          }}
        >
          <FieldShell label="Question" htmlFor={titleField}>
            <Input
              id={titleField}
              value={title}
              maxLength={160}
              placeholder="Which weekend works best?"
              onChange={(event) => setTitle(event.target.value)}
            />
          </FieldShell>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-[13px] font-medium">Choices</legend>
            {choices.map((choice, index) => (
              <div
                key={index}
                className="grid grid-cols-[1fr_10rem_auto] gap-2"
              >
                <label className="sr-only" htmlFor={`choice-${index}`}>
                  Choice {index + 1}
                </label>
                <Input
                  id={`choice-${index}`}
                  value={choice.label}
                  maxLength={160}
                  placeholder={`Choice ${index + 1}`}
                  onChange={(event) =>
                    setChoices((current) =>
                      current.map((item, i) =>
                        i === index
                          ? { ...item, label: event.target.value }
                          : item,
                      ),
                    )
                  }
                />
                <label className="sr-only" htmlFor={`choice-option-${index}`}>
                  Linked option for choice {index + 1}
                </label>
                <NativeSelect
                  id={`choice-option-${index}`}
                  value={choice.researchOptionId}
                  onChange={(event) => {
                    const optionId = event.target.value;
                    const option = options.find((item) => item.id === optionId);
                    setChoices((current) =>
                      current.map((item, i) =>
                        i === index
                          ? {
                              label: item.label || option?.title || "",
                              researchOptionId: optionId,
                            }
                          : item,
                      ),
                    );
                  }}
                >
                  <option value="">No linked option</option>
                  {options.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.title}
                    </option>
                  ))}
                </NativeSelect>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove choice ${index + 1}`}
                  disabled={choices.length <= 2}
                  onClick={() =>
                    setChoices((current) =>
                      current.filter((_, i) => i !== index),
                    )
                  }
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
            ))}
            {choices.length < 8 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="justify-self-start"
                onClick={() =>
                  setChoices((current) => [
                    ...current,
                    { label: "", researchOptionId: "" },
                  ])
                }
              >
                <Plus aria-hidden />
                Add choice
              </Button>
            ) : null}
          </fieldset>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                pending ||
                !title.trim() ||
                choices.some((choice) => !choice.label.trim())
              }
            >
              Start vote
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
