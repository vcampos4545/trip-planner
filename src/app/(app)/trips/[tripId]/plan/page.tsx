import { Lightbulb } from "lucide-react";
import type { Metadata, Route } from "next";
import Link from "next/link";

import { AtlasChat } from "@/components/atlas/atlas-chat";
import { toChatMessages } from "@/components/atlas/message-mapping";
import { Pill } from "@/components/shared/status-badge";
import { ASSISTANT_NAME } from "@/config/brand";
import { formatDateRange } from "@/lib/dates";
import { requireTripAccess } from "@/server/access";
import { requireUser } from "@/server/auth/session";
import { getAiStatus } from "@/server/ai/config";
import { db } from "@/server/db";
import { orNotFound } from "@/server/not-found";
import { getResearchProvider } from "@/server/research";
import {
  getOrCreateTripConversation,
  listMessages,
} from "@/server/services/conversations";

export const metadata: Metadata = { title: "Plan with AI" };

const QUICK_PROMPTS = [
  "Suggest tasks for what we still need to figure out",
  "Propose an activity for a free afternoon",
  "Compare the options we've saved so far",
  "What decisions are still open?",
];

export default async function PlanPage({
  params,
  searchParams,
}: PageProps<"/trips/[tripId]/plan">) {
  const { tripId } = await params;
  const query = await searchParams;
  const user = await requireUser(`/trips/${tripId}/plan`);
  const access = await orNotFound(requireTripAccess(tripId, user.id));
  const conversation = await getOrCreateTripConversation(access);
  const [messages, trip, counts] = await Promise.all([
    listMessages(conversation.id),
    db.trip.findUniqueOrThrow({
      where: { id: tripId },
      select: {
        destination: true,
        startDate: true,
        endDate: true,
        dateNotes: true,
        groupSize: true,
      },
    }),
    Promise.all([
      db.researchOption.count({
        where: { tripId, status: { notIn: ["REJECTED", "CANCELLED"] } },
      }),
      db.task.count({
        where: { tripId, status: { in: ["OPEN", "IN_PROGRESS"] } },
      }),
      db.itineraryEvent.count({
        where: { tripId, status: { not: "CANCELLED" } },
      }),
      db.booking.count({ where: { tripId, status: { not: "CANCELLED" } } }),
    ]),
  ]);
  const ai = getAiStatus();
  const research = getResearchProvider();
  const prompt =
    typeof query.prompt === "string" ? query.prompt.slice(0, 500) : undefined;
  const [optionCount, taskCount, eventCount, bookingCount] = counts;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <section
        className="flex min-h-[60vh] flex-col rounded-xl border bg-card/40 p-4 sm:p-6 lg:h-[calc(100vh-15rem)]"
        aria-label={`Chat with ${ASSISTANT_NAME}`}
      >
        <AtlasChat
          key={prompt ?? "chat"}
          className="flex-1"
          conversationId={conversation.id}
          messages={toChatMessages(messages)}
          openingPrompt={`What should we work on next? I can help pick a destination, compare options, suggest tasks for what's missing, or propose activities for open time. Everything I add waits for the group's review.`}
          aiConfigured={ai.configured}
          aiReason={ai.configured ? undefined : ai.reason}
          placeholder={`Ask ${ASSISTANT_NAME} about this trip`}
          initialPrompt={prompt}
        />
      </section>
      <aside className="space-y-4">
        <div className="rounded-xl border bg-card p-5">
          <h2 className="text-sm font-semibold">
            What {ASSISTANT_NAME} works from
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            The shared trip record, the same one every member sees. Your
            conversation with {ASSISTANT_NAME} is private to you.
          </p>
          <dl className="mt-3 space-y-1.5 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Destination</dt>
              <dd className="truncate text-right">
                {trip.destination ?? "Not decided"}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Dates</dt>
              <dd className="truncate text-right">
                {formatDateRange(trip.startDate, trip.endDate) ??
                  trip.dateNotes ??
                  "Not set"}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Saved options</dt>
              <dd>{optionCount}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Open tasks</dt>
              <dd>{taskCount}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Itinerary items</dt>
              <dd>{eventCount}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Bookings</dt>
              <dd>{bookingCount}</dd>
            </div>
          </dl>
          <div className="mt-3 border-t pt-3">
            {research.isConfigured ? (
              <Pill tone="confirmed">Live search: {research.label}</Pill>
            ) : research.unavailableReason ? (
              <p className="text-xs text-muted-foreground">
                <Pill tone="warning">Live search unavailable</Pill>{" "}
                <span className="mt-1 block">
                  {research.unavailableReason} {ASSISTANT_NAME} can suggest
                  ideas, but they come without live prices or availability.
                </span>
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                <Pill tone="neutral">Live search off</Pill>{" "}
                <span className="mt-1 block">
                  {ASSISTANT_NAME} can suggest ideas, but they come without live
                  prices or availability. Add options you find yourself on the
                  Options tab.
                </span>
              </p>
            )}
          </div>
        </div>
        {ai.configured ? (
          <div className="rounded-xl border bg-card p-5">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold">
              <Lightbulb className="size-4 text-muted-foreground" aria-hidden />
              Try asking
            </h2>
            <ul className="mt-2 space-y-1.5">
              {QUICK_PROMPTS.map((text) => (
                <li key={text}>
                  <Link
                    href={
                      `/trips/${tripId}/plan?prompt=${encodeURIComponent(text)}` as Route
                    }
                    className="block rounded-lg border px-3 py-2 text-sm transition-colors hover:border-primary/40 hover:bg-accent/50"
                  >
                    {text}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
