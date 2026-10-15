"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import {
  useForm,
  type DefaultValues,
  type FieldValues,
  type Path,
} from "react-hook-form";
import type { z } from "zod";

import type { ActionResult } from "@/lib/action-result";

/**
 * React Hook Form with a Zod schema. The schema validates on the client, then the raw form
 * values go to the server action, which validates them again with the same schema.
 */
export function useZodForm<S extends z.ZodType<unknown, FieldValues>>(
  schema: S,
  defaultValues: z.input<S>,
) {
  const form = useForm<z.input<S>>({
    // The resolver validates raw input; submitted values are re-read as raw input below.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(schema as any) as any,
    defaultValues: defaultValues as DefaultValues<z.input<S>>,
    mode: "onTouched",
  });
  const [formError, setFormError] = useState<string | null>(null);

  /** Applies server-side field errors to the form and returns whether the action succeeded. */
  function applyResult<T>(result: ActionResult<T>) {
    if (result.ok) {
      setFormError(null);
      return true;
    }
    let mapped = false;
    for (const [field, messages] of Object.entries(result.fieldErrors ?? {})) {
      if (field === "_form") continue;
      form.setError(field as Path<z.input<S>>, { message: messages[0] });
      mapped = true;
    }
    setFormError(mapped && result.code === "VALIDATION" ? null : result.error);
    return false;
  }

  return { form, formError, setFormError, applyResult };
}
