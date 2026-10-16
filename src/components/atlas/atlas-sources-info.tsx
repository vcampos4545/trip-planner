import { Pill } from "@/components/shared/status-badge";
import { ASSISTANT_NAME } from "@/config/brand";

/** What Atlas reads and which live sources it can use. Shown behind the panel's info button. */
export function AtlasSourcesInfo({
  route,
  dates,
  counts,
  research,
  flights,
}: {
  route: string;
  dates: string;
  counts: {
    options: number;
    openTasks: number;
    itinerary: number;
    bookings: number;
  };
  research: { configured: boolean; label: string; unavailableReason?: string };
  flights:
    | { configured: true; label: string; testMode: boolean }
    | { configured: false };
}) {
  const rows: [string, React.ReactNode][] = [
    ["Where", route],
    ["Dates", dates],
    ["Saved options", counts.options],
    ["Open tasks", counts.openTasks],
    ["Itinerary items", counts.itinerary],
    ["Bookings", counts.bookings],
  ];
  return (
    <div className="space-y-3 text-sm">
      <div>
        <p className="font-medium">Where {ASSISTANT_NAME} works from</p>
        <p className="text-xs text-muted-foreground">
          The shared trip record, the same one every member sees. Your
          conversation with {ASSISTANT_NAME} is private to you.
        </p>
      </div>
      <dl className="space-y-1">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="truncate text-right">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="space-y-2 border-t pt-2 text-xs text-muted-foreground">
        {research.configured ? (
          <Pill tone="confirmed">Live search: {research.label}</Pill>
        ) : research.unavailableReason ? (
          <p>
            <Pill tone="warning">Live search unavailable</Pill>
            <span className="mt-1 block">
              {research.unavailableReason} {ASSISTANT_NAME} can suggest ideas,
              but they come without live prices or availability.
            </span>
          </p>
        ) : (
          <p>
            <Pill tone="neutral">Live search off</Pill>
            <span className="mt-1 block">
              {ASSISTANT_NAME} can suggest ideas, but they come without live
              prices or availability. Add options you find yourself on the
              Options tab.
            </span>
          </p>
        )}
        <div data-testid="flight-search-status">
          {flights.configured ? (
            <p>
              <Pill tone={flights.testMode ? "warning" : "confirmed"}>
                Flight search: {flights.label}
              </Pill>
              {flights.testMode ? (
                <span className="mt-1 block">
                  Flight results are Duffel test data, not real fares or
                  availability.
                </span>
              ) : null}
            </p>
          ) : (
            <Pill tone="neutral">Flight search not configured</Pill>
          )}
        </div>
      </div>
    </div>
  );
}
