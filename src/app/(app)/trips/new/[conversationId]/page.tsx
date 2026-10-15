import type { Metadata, Route } from "next";
import { notFound, redirect } from "next/navigation";

import { AtlasChat } from "@/components/atlas/atlas-chat";
import { toChatMessages } from "@/components/atlas/message-mapping";
import { CreateFromDraftButton } from "@/components/trips/create-from-draft-button";
import { DraftDetailsEditButton } from "@/components/trips/details-editors";
import { toTripDetailsFormInput } from "@/lib/validation/form-defaults";
import { TripDetailsSummary } from "@/components/trips/trip-details-summary";
import { ASSISTANT_NAME } from "@/config/brand";
import { deriveTitle, isEstablishable } from "@/lib/domain/trip-details";
import { START_MODE_LABELS } from "@/lib/labels";
import { requireUser } from "@/server/auth/session";
import { getAiStatus } from "@/server/ai/config";
import { OPENING_PROMPTS } from "@/server/ai/prompts";
import { DomainError } from "@/server/errors";
import {
  draftOf,
  getOwnConversation,
  listMessages,
} from "@/server/services/conversations";

export const metadata: Metadata = { title: "Plan a new trip" };

export default async function NewTripConversationPage({
  params,
}: PageProps<"/trips/new/[conversationId]">) {
  const { conversationId } = await params;
  const user = await requireUser(`/trips/new/${conversationId}`);
  const conversation = await getOwnConversation(user.id, conversationId).catch(
    (error) => {
      if (error instanceof DomainError && error.code === "NOT_FOUND")
        notFound();
      throw error;
    },
  );
  if (conversation.tripId)
    redirect(`/trips/${conversation.tripId}/plan` as Route);

  const mode =
    conversation.startMode && conversation.startMode !== "MANUAL"
      ? conversation.startMode
      : "KNOWN_DESTINATION";
  const [messages, ai] = [await listMessages(conversation.id), getAiStatus()];
  const draft = draftOf(conversation);
  const title = deriveTitle(draft, mode);
  const ready = isEstablishable(draft);

  return (
    <main className="mx-auto grid w-full max-w-7xl flex-1 gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <section className="flex min-h-[60vh] flex-col rounded-xl border bg-card/40 p-4 sm:p-6 lg:h-[calc(100vh-7.5rem)]">
        <header className="mb-4 border-b pb-4">
          <p className="text-xs font-medium text-muted-foreground">
            {START_MODE_LABELS[mode]}
          </p>
          <h1 className="text-lg font-semibold tracking-tight">
            Plan a new trip with {ASSISTANT_NAME}
          </h1>
        </header>
        <AtlasChat
          className="flex-1"
          conversationId={conversation.id}
          messages={toChatMessages(messages)}
          openingPrompt={OPENING_PROMPTS[mode]}
          aiConfigured={ai.configured}
          aiReason={ai.configured ? undefined : ai.reason}
          placeholder="Describe the trip in your own words"
          redirectOnTripCreated
        />
      </section>

      <aside
        className="space-y-4 lg:sticky lg:top-20 lg:self-start"
        aria-label="Trip details so far"
      >
        <div className="rounded-xl border bg-card p-5">
          <div className="mb-4 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground">
                Taking shape
              </p>
              <h2
                className="truncate text-base font-semibold"
                data-testid="draft-title"
              >
                {title}
              </h2>
            </div>
            <DraftDetailsEditButton
              conversationId={conversation.id}
              initial={toTripDetailsFormInput(draft.details, title)}
            />
          </div>
          <TripDetailsSummary
            details={draft.details}
            candidateDestinations={draft.candidateDestinations}
            preferences={draft.preferences}
          />
        </div>
        <div className="space-y-2 rounded-xl border bg-card p-5">
          <p className="text-sm text-muted-foreground">
            {ready
              ? "There's enough here for a working trip. It will be created automatically after your next message, or create it now."
              : "Skip any question you can't answer yet. You can create the trip at any point and fill in the rest later."}
          </p>
          <CreateFromDraftButton
            conversationId={conversation.id}
            ready={ready}
          />
        </div>
      </aside>
    </main>
  );
}
