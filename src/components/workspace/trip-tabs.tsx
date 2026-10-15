"use client";

import {
  CalendarRange,
  LayoutDashboard,
  ListChecks,
  Sparkles,
  Ticket,
  Bookmark,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const TABS = [
  { segment: "", label: "Overview", icon: LayoutDashboard },
  { segment: "plan", label: "Plan with AI", icon: Sparkles },
  { segment: "options", label: "Options", icon: Bookmark },
  { segment: "itinerary", label: "Itinerary", icon: CalendarRange },
  { segment: "bookings", label: "Bookings", icon: Ticket },
  { segment: "tasks", label: "Tasks & decisions", icon: ListChecks },
] as const;

export function TripTabs({
  tripId,
  counts,
}: {
  tripId: string;
  counts?: Partial<Record<string, number>>;
}) {
  const pathname = usePathname();
  const base = `/trips/${tripId}`;
  return (
    <nav
      aria-label="Trip sections"
      className="-mb-px flex [scrollbar-width:none] gap-1 overflow-x-auto"
    >
      {TABS.map((tab) => {
        const href = tab.segment ? `${base}/${tab.segment}` : base;
        const active = tab.segment
          ? pathname.startsWith(href)
          : pathname === base;
        const count = counts?.[tab.segment || "overview"];
        return (
          <Link
            key={tab.label}
            href={href as Route}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:bg-muted",
              active
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <tab.icon className="size-4" aria-hidden />
            {tab.label}
            {count ? (
              <span
                className="rounded-full bg-amber-100 px-1.5 text-[11px] leading-4 text-amber-900"
                aria-label={`${count} to review`}
              >
                {count}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
