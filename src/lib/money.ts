/**
 * Money helpers. Amounts travel as decimal strings ("1234.50") and are summed as integer cents
 * so totals never pick up floating point drift. Currencies are never converted.
 */

const DECIMAL = /^(\d{1,10})(?:\.(\d{1,2}))?$/;

export function isMoneyString(value: string): boolean {
  return DECIMAL.test(value);
}

/** Converts a decimal string, Prisma Decimal, or number to integer cents. Null stays null. */
export function toCents(
  value: { toString(): string } | string | number | null | undefined,
): number | null {
  if (value === null || value === undefined) return null;
  const text = typeof value === "number" ? value.toFixed(2) : value.toString();
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(text.trim());
  if (!match) return null;
  const whole = Number(match[2]);
  const fraction = (match[3] ?? "").padEnd(3, "0");
  const cents =
    whole * 100 +
    Number(fraction.slice(0, 2)) +
    (Number(fraction[2]) >= 5 ? 1 : 0);
  return match[1] ? -cents : cents;
}

export function centsToDecimal(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Normalizes user input like "1,200" or "$85.5" into "1200.00", or null if it is not money. */
export function normalizeMoneyInput(value: string): string | null {
  const cleaned = value.replace(/[\s,$€£¥]/g, "");
  if (!DECIMAL.test(cleaned)) return null;
  return centsToDecimal(toCents(cleaned)!);
}

export function isCurrencyCode(value: string): boolean {
  return /^[A-Z]{3}$/.test(value);
}

export function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return `${centsToDecimal(cents)} ${currency}`;
  }
}

export function formatMoneyValue(
  value: { toString(): string } | string | null | undefined,
  currency: string | null | undefined,
): string | null {
  const cents = toCents(value ?? null);
  if (cents === null) return null;
  return formatMoney(cents, currency || "USD");
}

/** Splits cents across `parts` people so the shares always add back up to the total. */
export function splitCents(total: number, parts: number): number[] {
  if (parts <= 0) return [];
  const base = Math.trunc(total / parts);
  const remainder = total - base * parts;
  return Array.from(
    { length: parts },
    (_, index) => base + (index < remainder ? 1 : 0),
  );
}

export const COMMON_CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "CAD",
  "AUD",
  "JPY",
  "MXN",
  "CHF",
  "NZD",
  "SGD",
  "THB",
  "INR",
  "BRL",
  "ZAR",
  "SEK",
  "NOK",
  "DKK",
  "ISK",
] as const;
