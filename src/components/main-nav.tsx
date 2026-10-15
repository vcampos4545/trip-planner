"use client";

import { Map } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

export function MainNav() {
  const pathname = usePathname();
  const active = pathname === "/trips" || pathname.startsWith("/trips/");
  return (
    <nav aria-label="Main" className="flex items-center gap-1">
      <Link
        href="/trips"
        aria-current={active ? "page" : undefined}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
          active && "text-foreground",
        )}
      >
        <Map className="size-4" aria-hidden />
        Trips
      </Link>
    </nav>
  );
}
