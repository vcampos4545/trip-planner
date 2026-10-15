"use client";

import {
  AlertTriangle,
  Check,
  CircleAlert,
  Clock,
  Lightbulb,
  Search,
  Sparkles,
} from "lucide-react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useEffect, useOptimistic, useRef, useTransition } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ASSISTANT_NAME } from "@/config/brand";
import { reportFailure } from "@/hooks/use-action";
import { formatTimestamp } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { sendMessageAction } from "@/server/actions/atlas";

import { ChatComposer } from "./chat-composer";
import { RichText } from "./rich-text";

export type ChatEffect = {
  tool: string;
  ok: boolean;
  kind: string;
  summary: string;
  entityId?: string;
};

export type ChatSource = {
  title: string;
  url: string;
  sourceName: string;
  retrievedAt: string;
};

export type ChatMessage = {
  id: string;
  role: "USER" | "ASSISTANT" | "NOTICE";
  content: string;
  model: string | null;
  createdAt: string;
  effects: ChatEffect[];
  sources?: ChatSource[];
  pending?: boolean;
};

export function AtlasChat({
  conversationId,
  messages,
  openingPrompt,
  aiConfigured,
  aiReason,
  placeholder,
  initialPrompt,
  redirectOnTripCreated = false,
  className,
}: {
  conversationId: string;
  messages: ChatMessage[];
  openingPrompt: string;
  aiConfigured: boolean;
  aiReason?: string;
  placeholder: string;
  initialPrompt?: string;
  redirectOnTripCreated?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [optimistic, addOptimistic] = useOptimistic(
    messages,
    (state, message: ChatMessage) => [...state, message],
  );
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [optimistic.length, pending]);

  function send(text: string) {
    startTransition(async () => {
      addOptimistic({
        id: `pending-${Date.now()}`,
        role: "USER",
        content: text,
        model: null,
        createdAt: new Date().toISOString(),
        effects: [],
        pending: true,
      });
      const result = await sendMessageAction(conversationId, text);
      if (!result.ok) {
        reportFailure(result, router);
        return;
      }
      if (!result.data.replied)
        toast.error(
          `${ASSISTANT_NAME} couldn't reply. Your message was saved.`,
        );
      if (result.data.tripCreated && result.data.tripId) {
        toast.success(
          "Trip created. Everything so far is saved to the shared workspace.",
        );
        if (redirectOnTripCreated)
          router.push(`/trips/${result.data.tripId}/plan` as Route);
      }
    });
  }

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div
        className="flex-1 space-y-5 overflow-y-auto pr-1 pb-4"
        aria-live="polite"
        aria-label={`Conversation with ${ASSISTANT_NAME}`}
      >
        <AssistantBubble>
          <p>{openingPrompt}</p>
        </AssistantBubble>
        {optimistic.map((message) => (
          <MessageItem key={message.id} message={message} />
        ))}
        {pending ? (
          <div
            className="flex items-center gap-2 pl-10 text-sm text-muted-foreground"
            role="status"
          >
            <span className="flex gap-1" aria-hidden>
              <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.2s]" />
              <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.1s]" />
              <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60" />
            </span>
            {ASSISTANT_NAME} is working on it
          </div>
        ) : null}
        <div ref={endRef} />
      </div>

      <div className="space-y-2 pt-2">
        {!aiConfigured ? (
          <Alert data-testid="ai-not-configured">
            <AlertTriangle aria-hidden />
            <AlertTitle>{ASSISTANT_NAME} needs configuration</AlertTitle>
            <AlertDescription>
              {aiReason ?? "AI is not configured on this server."} You can still
              edit the trip details directly.
            </AlertDescription>
          </Alert>
        ) : null}
        <ChatComposer
          onSubmit={(text) => send(text)}
          disabled={!aiConfigured}
          pending={pending}
          placeholder={
            aiConfigured
              ? placeholder
              : `${ASSISTANT_NAME} is unavailable until AI is configured`
          }
          initialValue={initialPrompt}
          maxLength={4000}
        />
        <p className="px-1 text-[11px] text-muted-foreground">
          {ASSISTANT_NAME} can make mistakes and has no live prices or
          availability unless a search provider is connected. Suggestions wait
          for your review.
        </p>
      </div>
    </div>
  );
}

function AssistantBubble({
  children,
  footer,
}: {
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <Sparkles className="size-3.5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-xs font-medium text-muted-foreground">
          {ASSISTANT_NAME}
        </p>
        <div className="max-w-prose text-sm leading-relaxed">{children}</div>
        {footer}
      </div>
    </div>
  );
}

function MessageItem({ message }: { message: ChatMessage }) {
  if (message.role === "USER") {
    return (
      <div className="flex justify-end">
        <div
          className={cn(
            "max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-primary-foreground",
            message.pending && "opacity-70",
          )}
        >
          {message.content}
        </div>
      </div>
    );
  }
  if (message.role === "NOTICE") {
    return (
      <div
        role="note"
        className="ml-10 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900"
      >
        <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="space-y-1">
          <p>{message.content}</p>
          <EffectList
            effects={message.effects.filter((effect) => effect.kind !== "read")}
          />
        </div>
      </div>
    );
  }
  return (
    <AssistantBubble
      footer={
        <>
          <EffectList
            effects={message.effects.filter((effect) => effect.kind !== "read")}
          />
          <SourceList sources={message.sources ?? []} />
          {message.model ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-block cursor-default text-[11px] text-muted-foreground/80">
                  {formatTimestamp(message.createdAt)}
                </span>
              </TooltipTrigger>
              <TooltipContent>Generated by {message.model}</TooltipContent>
            </Tooltip>
          ) : null}
        </>
      }
    >
      <RichText text={message.content} />
    </AssistantBubble>
  );
}

function SourceList({ sources }: { sources: ChatSource[] }) {
  if (sources.length === 0) return null;
  return (
    <div className="space-y-1 text-xs" data-testid="atlas-sources">
      <p className="font-medium text-muted-foreground">
        Live search sources, retrieved{" "}
        {formatTimestamp(sources[0]!.retrievedAt)}
      </p>
      <ol className="list-decimal space-y-0.5 pl-5">
        {sources.map((source) => (
          <li key={source.url}>
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="text-primary underline underline-offset-2 hover:no-underline"
            >
              {source.title}
            </a>{" "}
            <span className="text-muted-foreground">({source.sourceName})</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

const EFFECT_ICONS: Record<string, typeof Check> = {
  updated: Check,
  saved: Check,
  proposal: Clock,
  suggestion: Lightbulb,
  searched: Search,
  error: CircleAlert,
};

function EffectList({ effects }: { effects: ChatEffect[] }) {
  if (effects.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="What changed">
      {effects.map((effect, index) => {
        const Icon = EFFECT_ICONS[effect.kind] ?? Check;
        return (
          <li
            key={index}
            className={cn(
              "inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-xs",
              !effect.ok || effect.kind === "error"
                ? "border-destructive/30 bg-destructive/5 text-destructive"
                : effect.kind === "proposal" || effect.kind === "suggestion"
                  ? "border-amber-200 bg-amber-50 text-amber-900"
                  : "border-emerald-200 bg-emerald-50 text-emerald-900",
            )}
          >
            <Icon className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{effect.summary}</span>
          </li>
        );
      })}
    </ul>
  );
}
