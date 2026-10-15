/**
 * Product naming lives here and nowhere else.
 *
 * The product name is configurable through NEXT_PUBLIC_APP_NAME so it can change without a
 * code edit. The assistant is always called Atlas.
 */
export const APP_NAME =
  process.env.NEXT_PUBLIC_APP_NAME?.trim() || "Trip Planner";

export const ASSISTANT_NAME = "Atlas";
