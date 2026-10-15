"use client";

import { useCallback, useState } from "react";

/** Open state that a parent can control (for dialogs opened from menus) or leave to the component. */
export function useControllableOpen(
  open?: boolean,
  onOpenChange?: (open: boolean) => void,
  defaultOpen = false,
) {
  const [internal, setInternal] = useState(defaultOpen);
  const controlled = open !== undefined;
  const value = controlled ? open : internal;
  const setValue = useCallback(
    (next: boolean) => {
      if (!controlled) setInternal(next);
      onOpenChange?.(next);
    },
    [controlled, onOpenChange],
  );
  return [value, setValue] as const;
}
