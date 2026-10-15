import type { ErrorCode } from "@/server/errors";

export type ActionSuccess<T> = { ok: true; data: T };
export type ActionFailure = {
  ok: false;
  code: ErrorCode;
  error: string;
  fieldErrors?: Record<string, string[]>;
};
export type ActionResult<T = null> = ActionSuccess<T> | ActionFailure;
