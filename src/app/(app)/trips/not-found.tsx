import { MapPinOff } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function TripNotFound() {
  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <MapPinOff className="size-5" aria-hidden />
      </span>
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">Trip not found</h1>
        <p className="text-sm text-muted-foreground">
          This trip doesn&apos;t exist, or you don&apos;t have access to it. If
          someone invited you, open their invite link again.
        </p>
      </div>
      <Button asChild variant="outline">
        <Link href="/trips">Back to trips</Link>
      </Button>
    </main>
  );
}
