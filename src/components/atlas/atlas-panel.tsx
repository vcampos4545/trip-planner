"use client";

import { CircleHelp, Sparkles } from "lucide-react";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, use, useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ASSISTANT_NAME } from "@/config/brand";

import { AtlasChat, type ChatMessage } from "./atlas-chat";

type AtlasPanelControls = {
  /** Opens the panel, optionally with a message ready to send. */
  openAtlas: (prompt?: string) => void;
};

const AtlasPanelContext = createContext<AtlasPanelControls | null>(null);

/** Opens the trip's Atlas panel from anywhere inside the trip workspace. */
export function useAtlasPanel() {
  return use(AtlasPanelContext);
}

/**
 * The trip's conversation with Atlas, in a panel that opens from every tab. `?atlas=open` (and an
 * optional `prompt`) in the URL opens it too, so links and redirects can land on it.
 */
export function AtlasPanelProvider({
  tripId,
  conversationId,
  messages,
  aiConfigured,
  aiReason,
  quickPrompts,
  inlineProposalIds,
  info,
  children,
}: {
  tripId: string;
  conversationId: string;
  messages: ChatMessage[];
  aiConfigured: boolean;
  aiReason?: string;
  quickPrompts: string[];
  inlineProposalIds: string[];
  /** "Where Atlas works from", shown behind the info button. */
  info: React.ReactNode;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlOpen = searchParams.get("atlas") === "open";
  const urlPrompt = searchParams.get("prompt")?.slice(0, 500) ?? undefined;
  const [manual, setManual] = useState<{ open: boolean; prompt?: string }>({
    open: false,
  });
  const [promptKey, setPromptKey] = useState(0);
  const open = manual.open || urlOpen;
  const prompt = manual.open ? manual.prompt : urlPrompt;

  const openAtlas = useCallback((next?: string) => {
    setManual({ open: true, prompt: next });
    setPromptKey((key) => key + 1);
  }, []);

  function onOpenChange(next: boolean) {
    if (next) {
      openAtlas();
      return;
    }
    setManual({ open: false });
    if (urlOpen || searchParams.has("prompt")) {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("atlas");
      params.delete("prompt");
      const query = params.toString();
      router.replace(`${pathname}${query ? `?${query}` : ""}` as Route, {
        scroll: false,
      });
    }
  }

  return (
    <AtlasPanelContext value={{ openAtlas }}>
      {children}
      {!open ? (
        <Button
          size="lg"
          className="fixed right-4 bottom-4 z-40 size-12 rounded-full shadow-lg sm:right-6 sm:bottom-6 sm:size-auto sm:h-9 sm:px-4"
          onClick={() => openAtlas()}
        >
          <Sparkles className="size-5 sm:size-4" aria-hidden />
          {/* Icon only on phones, so the button covers less of the page. */}
          <span className="sr-only sm:not-sr-only">Ask {ASSISTANT_NAME}</span>
        </Button>
      ) : null}
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg"
          onOpenAutoFocus={(event) => {
            // Start in the message box rather than on the first header button.
            const message = document.getElementById("atlas-message");
            if (message instanceof HTMLTextAreaElement && !message.disabled) {
              event.preventDefault();
              message.focus();
            }
          }}
        >
          <SheetHeader className="flex-row items-center gap-2 border-b pr-12">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Sparkles className="size-3.5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <SheetTitle>{ASSISTANT_NAME}</SheetTitle>
              <SheetDescription className="text-xs">
                Plan this trip together. Your conversation is private to you.
              </SheetDescription>
            </div>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Where ${ASSISTANT_NAME} works from`}
                >
                  <CircleHelp aria-hidden />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="w-80"
                data-testid="atlas-sources-info"
              >
                {info}
              </PopoverContent>
            </Popover>
          </SheetHeader>
          {open ? (
            <AtlasChat
              key={`${promptKey}-${prompt ?? ""}`}
              className="min-h-0 flex-1 p-4"
              conversationId={conversationId}
              messages={messages}
              openingPrompt="What should we work on next? I can help pick a destination, compare options, suggest tasks for what's missing, or propose activities for open time. Tell me about anything you've already booked and I'll add it to Bookings."
              aiConfigured={aiConfigured}
              aiReason={aiReason}
              placeholder={`Ask ${ASSISTANT_NAME} about this trip`}
              initialPrompt={prompt}
              quickPrompts={quickPrompts}
              trip={{ tripId, inlineProposalIds }}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </AtlasPanelContext>
  );
}
