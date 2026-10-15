import { Banknote, CalendarDays, Luggage, MapPin, Users } from "lucide-react";

import { formatDateRange } from "@/lib/dates";
import type { TripDetails } from "@/lib/domain/trip-details";
import {
  ARRANGEMENT_LABELS,
  BUDGET_BASIS_LABELS,
  BUDGET_COMPONENT_LABELS,
  DATE_FLEXIBILITY_LABELS,
} from "@/lib/labels";
import { formatMoneyValue } from "@/lib/money";
import { cn } from "@/lib/utils";

function Unknown({ children = "Unknown" }: { children?: React.ReactNode }) {
  return <span className="text-muted-foreground/80 italic">{children}</span>;
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-2 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function Group({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof MapPin;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-1">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        <Icon className="size-3.5" aria-hidden />
        {title}
      </h3>
      <dl className="divide-y divide-border/60">{children}</dl>
    </section>
  );
}

export function TripDetailsSummary({
  details,
  candidateDestinations = [],
  preferences = [],
  className,
}: {
  details: TripDetails;
  candidateDestinations?: { name: string; reason: string | null }[];
  preferences?: { kind: string; strength: string; description: string }[];
  className?: string;
}) {
  const dates = formatDateRange(details.startDate, details.endDate);
  const budget = formatMoneyValue(details.budgetAmount, details.budgetCurrency);
  return (
    <div className={cn("space-y-5", className)}>
      <Group icon={MapPin} title="Where">
        <Row label="Destination">
          {details.destination ? (
            <>
              {details.destination}{" "}
              <span className="text-xs text-muted-foreground">
                ({details.destinationConfirmed ? "decided" : "tentative"})
              </span>
            </>
          ) : (
            <Unknown>Not decided</Unknown>
          )}
        </Row>
        {candidateDestinations.length > 0 ? (
          <Row label="Ideas">
            {candidateDestinations
              .map((candidate) => candidate.name)
              .join(", ")}
          </Row>
        ) : null}
        <Row label="Trip style">{details.tripStyle ?? <Unknown />}</Row>
        <Row label="Leaving from">
          {details.departureLocation ?? <Unknown />}
        </Row>
      </Group>
      <Group icon={CalendarDays} title="When">
        <Row label="Dates">{dates ?? <Unknown>Not set</Unknown>}</Row>
        <Row label="Flexibility">
          {details.dateFlexibility === "UNKNOWN" ? (
            <Unknown />
          ) : (
            DATE_FLEXIBILITY_LABELS[details.dateFlexibility]
          )}
        </Row>
        {details.dateNotes ? (
          <Row label="Timing notes">{details.dateNotes}</Row>
        ) : null}
        <Row label="Length">
          {details.durationDays ? `${details.durationDays} days` : <Unknown />}
        </Row>
      </Group>
      <Group icon={Users} title="Who">
        <Row label="Group size">{details.groupSize ?? <Unknown />}</Row>
        {details.groupNotes ? (
          <Row label="About the group">{details.groupNotes}</Row>
        ) : null}
        {preferences.length > 0 ? (
          <Row label="Preferences">
            <ul className="flex flex-wrap gap-1">
              {preferences.map((preference) => (
                <li
                  key={`${preference.kind}-${preference.description}`}
                  className={cn(
                    "rounded-md border px-1.5 py-0.5 text-xs",
                    preference.strength === "REQUIREMENT"
                      ? "border-primary/30 bg-accent text-accent-foreground"
                      : "bg-muted/60",
                  )}
                >
                  {preference.strength === "REQUIREMENT" ? "Must: " : ""}
                  {preference.description}
                </li>
              ))}
            </ul>
          </Row>
        ) : null}
      </Group>
      <Group icon={Banknote} title="Budget">
        <Row label="Target">
          {budget ? (
            <>
              {budget}{" "}
              {details.budgetBasis !== "UNKNOWN" ? (
                <span className="text-muted-foreground">
                  {BUDGET_BASIS_LABELS[details.budgetBasis].toLowerCase()}
                </span>
              ) : null}
            </>
          ) : (
            <Unknown>Not set</Unknown>
          )}
        </Row>
        <Row label="Covers">
          {details.budgetIncludes.length > 0 ? (
            details.budgetIncludes
              .map((item) => BUDGET_COMPONENT_LABELS[item])
              .join(", ")
          ) : (
            <Unknown />
          )}
        </Row>
        {details.budgetNotes ? (
          <Row label="Notes">{details.budgetNotes}</Row>
        ) : null}
      </Group>
      <Group icon={Luggage} title="Arrangements">
        <Row label="Flights">{arrangement(details.flightsStatus)}</Row>
        <Row label="Lodging">{arrangement(details.lodgingStatus)}</Row>
        <Row label="Getting around">
          {arrangement(details.localTransportStatus)}
        </Row>
        <Row label="Activities">{arrangement(details.activitiesStatus)}</Row>
      </Group>
    </div>
  );
}

function arrangement(status: TripDetails["flightsStatus"]) {
  return status === "UNKNOWN" ? <Unknown /> : ARRANGEMENT_LABELS[status];
}
