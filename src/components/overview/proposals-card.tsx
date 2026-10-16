"use client";

import { Check, Sparkles, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ASSISTANT_NAME } from "@/config/brand";
import { useAction } from "@/hooks/use-action";
import { formatRelativeTime } from "@/lib/dates";
import { resolveProposalAction } from "@/server/actions/trips";

export type ProposalView = {
  id: string;
  createdAt: string;
  proposedBy: { name: string | null };
  changes: { label: string }[];
};

export function ProposalsCard({
  tripId,
  proposals,
  solo = false,
}: {
  tripId: string;
  proposals: ProposalView[];
  /** The viewer is the only member, so the copy speaks to them instead of a group. */
  solo?: boolean;
}) {
  const { run, pending } = useAction();
  if (proposals.length === 0) return null;
  return (
    <section
      id="proposals"
      aria-labelledby="proposals-heading"
      className="rounded-xl border border-amber-200 bg-amber-50/60 p-5"
    >
      <h2
        id="proposals-heading"
        className="flex items-center gap-2 text-sm font-semibold text-amber-950"
      >
        <Sparkles className="size-4" aria-hidden />
        {solo
          ? "Changes waiting for your OK"
          : "Proposed changes waiting for confirmation"}
      </h2>
      <p className="mt-1 text-xs text-amber-900/80">
        {ASSISTANT_NAME} never overwrites details {solo ? "you" : "someone"}{" "}
        already set. Accept to apply a change, or decline to keep things as they
        are.
      </p>
      <ul className="mt-3 space-y-2">
        {proposals.map((proposal) => (
          <li
            key={proposal.id}
            className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-card p-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0 space-y-1">
              <ul className="space-y-0.5 text-sm">
                {proposal.changes.map((change) => (
                  <li key={change.label} className="break-words">
                    {change.label}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">
                From {proposal.proposedBy.name ?? "a member"}&apos;s
                conversation · {formatRelativeTime(proposal.createdAt)}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  run(() => resolveProposalAction(tripId, proposal.id, false), {
                    success: "Change declined",
                  })
                }
              >
                <X aria-hidden />
                Decline
              </Button>
              <Button
                size="sm"
                disabled={pending}
                onClick={() =>
                  run(() => resolveProposalAction(tripId, proposal.id, true), {
                    success: "Change applied",
                  })
                }
              >
                <Check aria-hidden />
                Accept
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
