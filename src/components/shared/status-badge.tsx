import type {
  BookingStatus,
  DecisionStatus,
  EventStatus,
  OptionStatus,
  RecordOrigin,
  TaskPriority,
  TaskStatus,
  TripStage,
} from "@/generated/prisma/enums";
import {
  BOOKING_STATUS_LABELS,
  DECISION_STATUS_LABELS,
  EVENT_STATUS_LABELS,
  OPTION_STATUS_LABELS,
  ORIGIN_LABELS,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  TRIP_STAGE_LABELS,
} from "@/lib/labels";
import { cn } from "@/lib/utils";

/**
 * Status colors carry one meaning across the app:
 * amber = suggestion awaiting review, sky = under consideration, violet = approved or decided,
 * emerald = booked or confirmed, neutral = planned or open, muted = rejected or cancelled.
 */
const TONES = {
  suggestion: "border-amber-200 bg-amber-50 text-amber-800",
  considering: "border-sky-200 bg-sky-50 text-sky-800",
  approved: "border-violet-200 bg-violet-50 text-violet-800",
  confirmed: "border-emerald-200 bg-emerald-50 text-emerald-800",
  neutral: "border-border bg-secondary text-secondary-foreground",
  muted:
    "border-transparent bg-muted text-muted-foreground line-through decoration-muted-foreground/40",
  warning: "border-orange-200 bg-orange-50 text-orange-800",
  info: "border-primary/20 bg-accent text-accent-foreground",
} as const;

export type Tone = keyof typeof TONES;

export function Pill({
  tone = "neutral",
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-2 text-[11px] font-medium whitespace-nowrap [&>svg]:size-3",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const OPTION_TONES: Record<OptionStatus, Tone> = {
  SUGGESTED: "suggestion",
  SHORTLISTED: "considering",
  APPROVED: "approved",
  BOOKED: "confirmed",
  REJECTED: "muted",
  CANCELLED: "muted",
};

export function OptionStatusBadge({ status }: { status: OptionStatus }) {
  return (
    <Pill tone={OPTION_TONES[status]}>{OPTION_STATUS_LABELS[status]}</Pill>
  );
}

const TASK_TONES: Record<TaskStatus, Tone> = {
  SUGGESTED: "suggestion",
  OPEN: "neutral",
  IN_PROGRESS: "considering",
  COMPLETED: "confirmed",
  CANCELLED: "muted",
};

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return <Pill tone={TASK_TONES[status]}>{TASK_STATUS_LABELS[status]}</Pill>;
}

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  if (priority === "MEDIUM") return null;
  return (
    <Pill tone={priority === "HIGH" ? "warning" : "neutral"}>
      {TASK_PRIORITY_LABELS[priority]} priority
    </Pill>
  );
}

const EVENT_TONES: Record<EventStatus, Tone> = {
  SUGGESTED: "suggestion",
  PLANNED: "neutral",
  CONFIRMED: "confirmed",
  CANCELLED: "muted",
};

export function EventStatusBadge({ status }: { status: EventStatus }) {
  return <Pill tone={EVENT_TONES[status]}>{EVENT_STATUS_LABELS[status]}</Pill>;
}

const BOOKING_TONES: Record<BookingStatus, Tone> = {
  PLANNED: "considering",
  BOOKED: "approved",
  CONFIRMED: "confirmed",
  CANCELLED: "muted",
};

export function BookingStatusBadge({ status }: { status: BookingStatus }) {
  return (
    <Pill tone={BOOKING_TONES[status]}>{BOOKING_STATUS_LABELS[status]}</Pill>
  );
}

const DECISION_TONES: Record<DecisionStatus, Tone> = {
  OPEN: "considering",
  RESOLVED: "approved",
  CANCELLED: "muted",
};

export function DecisionStatusBadge({ status }: { status: DecisionStatus }) {
  return (
    <Pill tone={DECISION_TONES[status]}>{DECISION_STATUS_LABELS[status]}</Pill>
  );
}

const STAGE_TONES: Record<TripStage, Tone> = {
  DREAMING: "suggestion",
  PLANNING: "considering",
  BOOKING: "approved",
  READY: "confirmed",
  COMPLETED: "neutral",
};

export function StageBadge({ stage }: { stage: TripStage }) {
  return <Pill tone={STAGE_TONES[stage]}>{TRIP_STAGE_LABELS[stage]}</Pill>;
}

const ORIGIN_TONES: Record<RecordOrigin, Tone> = {
  USER: "neutral",
  ATLAS: "info",
  RESEARCH_PROVIDER: "confirmed",
  SAMPLE_DATA: "warning",
};

export function OriginBadge({
  origin,
  short = false,
}: {
  origin: RecordOrigin;
  short?: boolean;
}) {
  if (origin === "USER" && short) return null;
  const label = short
    ? {
        USER: "Member",
        ATLAS: "Atlas idea",
        RESEARCH_PROVIDER: "Live result",
        SAMPLE_DATA: "Sample data",
      }[origin]
    : ORIGIN_LABELS[origin];
  return <Pill tone={ORIGIN_TONES[origin]}>{label}</Pill>;
}
