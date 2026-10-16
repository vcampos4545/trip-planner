"use client";

import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Open state for a dialog that a link can open with `?open=<name>`, such as a next-step button on
 * another page. The parameter is removed once the dialog opens, so a reload doesn't reopen it.
 */
export function useOpenParam(name: string) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [handled, setHandled] = useState<string | null>(null);
  const requested = params.get("open") === name;
  const request = requested ? params.toString() : null;

  // Adjusting state while rendering (not in an effect) opens the dialog in the same pass.
  if (request !== handled) {
    setHandled(request);
    if (request) setOpen(true);
  }

  useEffect(() => {
    if (!requested) return;
    const next = new URLSearchParams(params);
    next.delete("open");
    const query = next.toString();
    router.replace((query ? `${pathname}?${query}` : pathname) as Route, {
      scroll: false,
    });
  }, [requested, params, pathname, router]);

  return [open, setOpen] as const;
}
