import { AlertTriangle, Wallet } from "lucide-react";

import { Pill } from "@/components/shared/status-badge";
import { compareToTarget, type BudgetSummary } from "@/lib/domain/budget";
import { BOOKING_CATEGORY_SINGULAR } from "@/lib/labels";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

export function BudgetSummaryCard({
  summary,
  memberNames,
  target,
  travelers,
}: {
  summary: BudgetSummary;
  memberNames: Record<string, string>;
  target: { amount: string | null; currency: string | null; basis: string };
  travelers: number;
}) {
  const hasCosts = summary.currencies.length > 0;
  return (
    <section
      aria-labelledby="budget-heading"
      className="rounded-xl border bg-card p-5"
      data-testid="budget-summary"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2
            id="budget-heading"
            className="flex items-center gap-2 text-sm font-semibold"
          >
            <Wallet className="size-4 text-muted-foreground" aria-hidden />
            Budget summary
          </h2>
          <p className="text-xs text-muted-foreground">
            From recorded bookings. Estimates and actual costs are kept apart.
            Currencies are not converted.
          </p>
        </div>
      </div>

      {!hasCosts ? (
        <p className="mt-4 text-sm text-muted-foreground">
          No priced bookings yet. Add a cost to a booking to see totals here.
        </p>
      ) : (
        <div className="mt-4 space-y-6">
          {summary.currencies.map((currency) => {
            const comparison = compareToTarget(currency, target, travelers);
            const rows = currency.perMember.filter((row) => row.total > 0);
            return (
              <div key={currency.currency} className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-4">
                  <Stat
                    label={`Total (${currency.currency})`}
                    value={formatMoney(currency.total, currency.currency)}
                    emphasis
                    testId="budget-total"
                  />
                  <Stat
                    label="Actual"
                    value={formatMoney(currency.actual, currency.currency)}
                  />
                  <Stat
                    label="Estimated"
                    value={formatMoney(currency.estimated, currency.currency)}
                  />
                  <Stat
                    label="Shared / individual"
                    value={`${formatMoney(currency.shared, currency.currency)} / ${formatMoney(currency.individual, currency.currency)}`}
                  />
                </div>
                {comparison ? (
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">
                        {comparison.basis === "PER_PERSON"
                          ? "Average per traveler vs. target per person"
                          : "Total vs. group target"}
                      </span>
                      <span
                        className={cn(
                          "font-medium",
                          comparison.spentCents > comparison.targetCents &&
                            "text-destructive",
                        )}
                      >
                        {formatMoney(comparison.spentCents, currency.currency)}{" "}
                        of{" "}
                        {formatMoney(comparison.targetCents, currency.currency)}
                      </span>
                    </div>
                    <div
                      className="h-2 overflow-hidden rounded-full bg-muted"
                      role="presentation"
                    >
                      <div
                        className={cn(
                          "h-full rounded-full",
                          comparison.spentCents > comparison.targetCents
                            ? "bg-destructive"
                            : "bg-primary",
                        )}
                        style={{
                          width: `${Math.min(100, Math.round((comparison.spentCents / Math.max(comparison.targetCents, 1)) * 100))}%`,
                        }}
                      />
                    </div>
                  </div>
                ) : null}
                {rows.length > 0 || currency.unassigned > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[24rem] text-sm">
                      <caption className="sr-only">
                        Cost per person in {currency.currency}
                      </caption>
                      <thead className="text-xs text-muted-foreground">
                        <tr className="border-b">
                          <th
                            scope="col"
                            className="py-2 text-left font-medium"
                          >
                            Traveler
                          </th>
                          <th
                            scope="col"
                            className="py-2 text-right font-medium"
                          >
                            Actual
                          </th>
                          <th
                            scope="col"
                            className="py-2 text-right font-medium"
                          >
                            Estimated
                          </th>
                          <th
                            scope="col"
                            className="py-2 text-right font-medium"
                          >
                            Total
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {rows.map((row) => (
                          <tr key={row.memberId}>
                            <th
                              scope="row"
                              className="py-2 text-left font-normal"
                            >
                              {memberNames[row.memberId] ?? "Former member"}
                            </th>
                            <td className="py-2 text-right tabular-nums">
                              {formatMoney(row.actual, currency.currency)}
                            </td>
                            <td className="py-2 text-right tabular-nums">
                              {formatMoney(row.estimated, currency.currency)}
                            </td>
                            <td className="py-2 text-right font-medium tabular-nums">
                              {formatMoney(row.total, currency.currency)}
                            </td>
                          </tr>
                        ))}
                        {currency.unassigned > 0 ? (
                          <tr>
                            <th
                              scope="row"
                              className="py-2 text-left font-normal text-muted-foreground"
                            >
                              Not assigned to anyone yet
                            </th>
                            <td colSpan={2} />
                            <td className="py-2 text-right text-muted-foreground tabular-nums">
                              {formatMoney(
                                currency.unassigned,
                                currency.currency,
                              )}
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {summary.unpriced.length > 0 ? (
        <div
          className="mt-5 rounded-lg border border-amber-200 bg-amber-50/60 p-3"
          data-testid="budget-unpriced"
        >
          <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-950">
            <AlertTriangle className="size-3.5" aria-hidden />
            {summary.unpriced.length} booking
            {summary.unpriced.length === 1 ? "" : "s"} without a price (not
            counted)
          </p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {summary.unpriced.map((item) => (
              <li key={item.id}>
                <Pill tone="neutral">
                  {item.title} · {BOOKING_CATEGORY_SINGULAR[item.category]}
                </Pill>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {summary.warnings.length > 0 ? (
        <ul className="mt-3 space-y-1 text-xs text-amber-800">
          {summary.warnings.map((warning) => (
            <li key={`${warning.bookingId}-${warning.message}`}>
              {warning.title}: {warning.message}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function Stat({
  label,
  value,
  emphasis = false,
  testId,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  testId?: string;
}) {
  return (
    <div className="rounded-lg bg-muted/40 px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p
        className={cn(
          "tabular-nums",
          emphasis ? "text-lg font-semibold" : "text-sm font-medium",
        )}
        data-testid={testId}
      >
        {value}
      </p>
    </div>
  );
}
