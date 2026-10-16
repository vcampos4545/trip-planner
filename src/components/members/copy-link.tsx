"use client";

import { Check, Copy, Share2 } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const noop = () => () => {};

/** True in browsers with the Web Share API (most phones). Never true during server rendering. */
function useCanShare() {
  return useSyncExternalStore(
    noop,
    () => typeof navigator !== "undefined" && "share" in navigator,
    () => false,
  );
}

/** A read-only link with copy and, where supported, the native share sheet. */
export function CopyLink({
  url,
  id,
  label = "invite link",
  shareTitle,
  testId,
}: {
  url: string;
  id?: string;
  label?: string;
  shareTitle?: string;
  testId?: string;
}) {
  const [copied, setCopied] = useState(false);
  const canShare = useCanShare();

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Invite link copied");
    } catch {
      toast.error("Couldn't copy automatically. Select the link and copy it.");
    }
  }

  async function share() {
    try {
      await navigator.share({ title: shareTitle, url });
    } catch (error) {
      // Closing the share sheet is not an error worth reporting.
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.error("Couldn't open sharing. Copy the link instead.");
    }
  }

  return (
    <div className="flex gap-2">
      <Input
        id={id}
        readOnly
        value={url}
        aria-label={id ? undefined : label}
        onFocus={(event) => event.currentTarget.select()}
        data-testid={testId}
        className="min-w-0 font-mono text-xs"
      />
      <Button
        type="button"
        variant="outline"
        onClick={copy}
        aria-label={copied ? `Copied ${label}` : `Copy ${label}`}
      >
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
        <span className="hidden sm:inline">{copied ? "Copied" : "Copy"}</span>
      </Button>
      {canShare ? (
        <Button
          type="button"
          variant="outline"
          onClick={share}
          aria-label={`Share ${label}`}
        >
          <Share2 aria-hidden />
        </Button>
      ) : null}
    </div>
  );
}
