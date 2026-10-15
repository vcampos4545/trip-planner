"use client";

import { ArrowRight, Trash2 } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

import { ConfirmAction } from "@/components/shared/confirm-button";
import { Button } from "@/components/ui/button";
import type { TripStartMode } from "@/generated/prisma/enums";
import { useAction } from "@/hooks/use-action";
import { formatRelativeTime } from "@/lib/dates";
import { START_MODE_LABELS } from "@/lib/labels";
import { deleteDraftAction } from "@/server/actions/atlas";

export function DraftList({
  drafts,
}: {
  drafts: {
    id: string;
    title: string;
    startMode: TripStartMode | null;
    lastMessageAt: string;
    messageCount: number;
  }[];
}) {
  const { run, pending } = useAction();
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {drafts.map((draft) => (
        <li
          key={draft.id}
          className="flex items-center gap-3 rounded-xl border border-dashed bg-card/60 px-4 py-3"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{draft.title}</p>
            <p className="text-xs text-muted-foreground">
              {draft.startMode
                ? START_MODE_LABELS[draft.startMode]
                : "Conversation"}{" "}
              · {formatRelativeTime(draft.lastMessageAt)}
            </p>
          </div>
          <ConfirmAction
            title="Discard this trip idea?"
            description="The conversation and the details collected so far will be deleted."
            confirmLabel="Discard"
            onConfirm={() =>
              run(() => deleteDraftAction(draft.id), {
                success: "Draft discarded",
              })
            }
            trigger={
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={pending}
                aria-label={`Discard ${draft.title}`}
              >
                <Trash2 aria-hidden />
              </Button>
            }
          />
          <Button asChild variant="outline" size="sm">
            <Link href={`/trips/new/${draft.id}` as Route}>
              Continue
              <ArrowRight aria-hidden />
            </Link>
          </Button>
        </li>
      ))}
    </ul>
  );
}
