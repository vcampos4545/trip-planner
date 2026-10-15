"use client";

import { useRouter } from "next/navigation";
import { useCallback, useTransition } from "react";
import { toast } from "sonner";

import type { ActionFailure, ActionResult } from "@/lib/action-result";

/**
 * Runs a server action inside a transition and turns failures into toasts. Conflicts offer a
 * reload so the user can see the other member's change before trying again.
 */
export function useAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const run = useCallback(
    <T>(
      action: () => Promise<ActionResult<T>>,
      options: {
        success?: string;
        onSuccess?: (data: T) => void;
        onError?: (failure: ActionFailure) => void;
      } = {},
    ) => {
      startTransition(async () => {
        const result = await action();
        if (result.ok) {
          if (options.success) toast.success(options.success);
          options.onSuccess?.(result.data);
          return;
        }
        reportFailure(result, router);
        options.onError?.(result);
      });
    },
    [router],
  );

  return { run, pending };
}

export function reportFailure(
  failure: ActionFailure,
  router: { refresh: () => void; push: (href: "/signin") => void },
) {
  if (failure.code === "CONFLICT") {
    toast.error(failure.error, {
      action: { label: "Reload", onClick: () => router.refresh() },
      duration: 10_000,
    });
    return;
  }
  if (failure.code === "UNAUTHENTICATED") {
    toast.error(failure.error, {
      action: {
        label: "Sign in",
        onClick: () => router.push("/signin"),
      },
      duration: 10_000,
    });
    return;
  }
  toast.error(failure.error);
}
