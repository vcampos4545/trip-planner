/**
 * Server components hand Prisma records to client components. Dates become ISO strings and
 * Decimals become decimal strings, matching what JSON serialization produces.
 */
type DecimalLike = { toFixed(digits?: number): string; toNumber(): number };

export type Serialized<T> = T extends Date
  ? string
  : T extends DecimalLike
    ? string
    : T extends (infer U)[]
      ? Serialized<U>[]
      : T extends object
        ? { [K in keyof T]: Serialized<T[K]> }
        : T;

export function serialize<T>(value: T): Serialized<T> {
  return JSON.parse(JSON.stringify(value)) as Serialized<T>;
}
