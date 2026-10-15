"use server";

import { signIn } from "@/auth";
import { safeRedirectPath } from "@/lib/safe-redirect";

export async function signInWithGoogle(formData: FormData) {
  await signIn("google", {
    redirectTo: safeRedirectPath(formData.get("callbackUrl")),
  });
}
