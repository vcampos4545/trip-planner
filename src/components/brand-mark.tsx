import { Compass } from "lucide-react";

import { APP_NAME } from "@/config/brand";
import { cn } from "@/lib/utils";

export function BrandMark({
  className,
  showName = true,
}: {
  className?: string;
  showName?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <Compass className="size-4" aria-hidden />
      </span>
      {showName ? (
        <span className="text-[15px] font-semibold tracking-tight">
          {APP_NAME}
        </span>
      ) : null}
    </span>
  );
}
