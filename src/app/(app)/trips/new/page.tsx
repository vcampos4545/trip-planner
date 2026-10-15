import { Compass, MapPin, Sparkles } from "lucide-react";
import type { Metadata } from "next";

import { AiStatusNotice } from "@/components/atlas/ai-status-notice";
import { PageHeader } from "@/components/shared/page-header";
import { QuickTripDialog } from "@/components/trips/quick-trip-dialog";
import { StartModeCard } from "@/components/trips/start-mode-card";
import { ASSISTANT_NAME } from "@/config/brand";
import { requireUser } from "@/server/auth/session";
import { getAiStatus } from "@/server/ai/config";
import { OPENING_PROMPTS } from "@/server/ai/prompts";

export const metadata: Metadata = { title: "New trip" };

export default async function NewTripPage() {
  await requireUser("/trips/new");
  const ai = getAiStatus();
  return (
    <main className="mx-auto w-full max-w-4xl space-y-8 px-4 py-8 sm:px-6">
      <PageHeader
        title="Start a new trip"
        description={`Pick how you'd like to begin. ${ASSISTANT_NAME} will ask a few questions and keep track of the details.`}
      />
      {!ai.configured ? <AiStatusNotice reason={ai.reason} /> : null}
      <div className="grid gap-4 md:grid-cols-3">
        <StartModeCard
          mode="KNOWN_DESTINATION"
          icon={<MapPin className="size-5" aria-hidden />}
          title="I know where I want to go"
          subtitle="Help me plan it."
          example={OPENING_PROMPTS.KNOWN_DESTINATION}
        />
        <StartModeCard
          mode="VIBE"
          icon={<Sparkles className="size-5" aria-hidden />}
          title="I have a vibe in mind"
          subtitle="Help me find the destination."
          example={OPENING_PROMPTS.VIBE}
        />
        <StartModeCard
          mode="DISCOVER"
          icon={<Compass className="size-5" aria-hidden />}
          title="I have no idea"
          subtitle="Help me discover a trip."
          example={OPENING_PROMPTS.DISCOVER}
        />
      </div>
      <div className="flex flex-col items-start gap-2 rounded-xl border bg-card px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium">
            Prefer to skip the conversation?
          </p>
          <p className="text-sm text-muted-foreground">
            Create the trip with a name and fill in the rest later.
          </p>
        </div>
        <QuickTripDialog />
      </div>
    </main>
  );
}
