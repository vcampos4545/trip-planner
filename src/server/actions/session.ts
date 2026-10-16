"use server";

import { signOut } from "@/auth";
import { safeRedirectPath } from "@/lib/safe-redirect";

export async function signOutAction() {
  await signOut({ redirectTo: "/signin" });
}

/** Signs out and returns to sign-in, then to `callbackPath`, so someone can switch accounts. */
export async function switchAccountAction(formData: FormData) {
  const callbackUrl = safeRedirectPath(formData.get("callbackUrl"));
  await signOut({
    redirectTo: `/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`,
  });
}
