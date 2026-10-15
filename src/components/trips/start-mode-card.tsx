"use client";

import { ArrowRight, Loader2 } from "lucide-react";

import { useAction } from "@/hooks/use-action";
import { startConversationAction } from "@/server/actions/atlas";

export function StartModeCard({
  mode,
  icon,
  title,
  subtitle,
  example,
}: {
  mode: "KNOWN_DESTINATION" | "VIBE" | "DISCOVER";
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  example: string;
}) {
  const { run, pending } = useAction();
  return (
    <button
      type="button"
      onClick={() => run(() => startConversationAction(mode))}
      disabled={pending}
      className="group flex h-full flex-col rounded-xl border bg-card p-5 text-left transition-all outline-none hover:border-primary/40 hover:shadow-sm focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-70"
    >
      <span className="flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
        {icon}
      </span>
      <span className="mt-4 block text-base font-semibold tracking-tight">
        {title}
      </span>
      <span className="block text-sm text-muted-foreground">{subtitle}</span>
      <span className="mt-4 block flex-1 rounded-lg bg-muted/60 px-3 py-2 text-[13px] text-foreground/80 italic">
        &ldquo;{example}&rdquo;
      </span>
      <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary">
        {pending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : null}
        Start
        <ArrowRight
          className="size-4 transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
      </span>
    </button>
  );
}
