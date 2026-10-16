import type { ErrorCode } from "@/server/errors";

export type ActionSuccess<T> = { ok: true; data: T };
/** A value the user can pick to fix a field, such as one of several cities with the same name. */
export type FieldChoice = { label: string; value: string };
export type ActionFailure = {
  ok: false;
  code: ErrorCode;
  error: string;
  fieldErrors?: Record<string, string[]>;
  fieldChoices?: Record<string, FieldChoice[]>;
};
export type ActionResult<T = null> = ActionSuccess<T> | ActionFailure;
