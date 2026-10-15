"use client";

import { ArrowUp, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Message input for Atlas. Kept self-contained so other input methods (for example voice
 * dictation) can feed text into it later through `initialValue` or a ref.
 */
export function ChatComposer({
  onSubmit,
  disabled,
  pending,
  placeholder,
  initialValue = "",
  maxLength,
}: {
  onSubmit: (text: string) => boolean | void;
  disabled?: boolean;
  pending?: boolean;
  placeholder: string;
  initialValue?: string;
  maxLength: number;
}) {
  const [value, setValue] = useState(initialValue);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 200)}px`;
  }, [value]);

  const canSend = !disabled && !pending && value.trim().length > 0;

  function submit() {
    if (!canSend) return;
    const accepted = onSubmit(value.trim());
    if (accepted !== false) setValue("");
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className={cn(
        "flex items-end gap-2 rounded-xl border bg-card p-2 shadow-xs transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30",
        disabled && "opacity-60",
      )}
    >
      <label htmlFor="atlas-message" className="sr-only">
        Message
      </label>
      <textarea
        id="atlas-message"
        ref={ref}
        rows={1}
        value={value}
        maxLength={maxLength}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            submit();
          }
        }}
        className="max-h-[200px] min-h-9 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
      />
      <Button
        type="submit"
        size="icon"
        disabled={!canSend}
        aria-label="Send message"
      >
        {pending ? (
          <Loader2 className="animate-spin" aria-hidden />
        ) : (
          <ArrowUp aria-hidden />
        )}
      </Button>
    </form>
  );
}
