import { ArrowRight, Compass } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import type { NextAction } from "@/lib/domain/next-action";

export function NextStepCard({
  tripId,
  action,
}: {
  tripId: string;
  action: NextAction;
}) {
  const href = (
    action.tab === "overview"
      ? `/trips/${tripId}#proposals`
      : `/trips/${tripId}/${action.tab}`
  ) as Route;
  return (
    <section
      aria-label="Next step"
      className="flex flex-col gap-4 rounded-xl border border-primary/20 bg-accent/60 p-5 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Compass className="size-4" aria-hidden />
        </span>
        <div>
          <p className="text-[11px] font-semibold tracking-wide text-accent-foreground/80 uppercase">
            Next step
          </p>
          <p className="text-base font-semibold" data-testid="next-step-title">
            {action.title}
          </p>
          <p className="text-sm text-muted-foreground">{action.description}</p>
        </div>
      </div>
      <Button asChild className="shrink-0">
        <Link href={href}>
          Continue
          <ArrowRight aria-hidden />
        </Link>
      </Button>
    </section>
  );
}
