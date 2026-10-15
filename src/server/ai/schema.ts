import { z } from "zod";

/**
 * Converts a Zod schema into the strict JSON Schema form that function calling expects:
 * every object lists all of its properties as required and forbids extra properties. Optional
 * values are modelled as nullable instead.
 */
export function toStrictJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, {
    io: "input",
    unrepresentable: "any",
  }) as Record<string, unknown>;
  delete json.$schema;
  return tighten(json) as Record<string, unknown>;
}

function tighten(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(tighten);
  if (!node || typeof node !== "object") return node;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    // Zod adds the safe-integer range to every int. It adds noise and nothing else.
    if (
      (key === "maximum" && value === Number.MAX_SAFE_INTEGER) ||
      (key === "minimum" && value === Number.MIN_SAFE_INTEGER)
    ) {
      continue;
    }
    result[key] = tighten(value);
  }
  if (
    result.type === "object" &&
    result.properties &&
    typeof result.properties === "object"
  ) {
    result.required = Object.keys(result.properties as object);
    result.additionalProperties = false;
  }
  return result;
}
