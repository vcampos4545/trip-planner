"use client";

import { RefreshCcw, TriangleAlert } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function AppError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <TriangleAlert className="size-5" aria-hidden />
      </span>
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="text-sm text-muted-foreground">
          We couldn&apos;t load this page. Your data is safe. Try again, or go
          back to your trips.
        </p>
      </div>
      <div className="flex gap-2">
        <Button onClick={reset}>
          <RefreshCcw aria-hidden />
          Try again
        </Button>
        <Button asChild variant="outline">
          <Link href="/trips">Back to trips</Link>
        </Button>
      </div>
    </main>
  );
}
