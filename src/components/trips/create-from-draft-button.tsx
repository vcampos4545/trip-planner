"use client";

import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAction } from "@/hooks/use-action";
import { createTripFromConversationAction } from "@/server/actions/atlas";

export function CreateFromDraftButton({
  conversationId,
  ready,
}: {
  conversationId: string;
  ready: boolean;
}) {
  const { run, pending } = useAction();
  return (
    <Button
      className="w-full"
      variant={ready ? "default" : "outline"}
      disabled={pending}
      onClick={() =>
        run(() => createTripFromConversationAction(conversationId))
      }
    >
      {pending ? "Creating trip..." : "Create trip with these details"}
      <ArrowRight aria-hidden />
    </Button>
  );
}
