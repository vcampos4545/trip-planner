import { Plus } from "lucide-react";
import Link from "next/link";

import { BrandMark } from "@/components/brand-mark";
import { MainNav } from "@/components/main-nav";
import { UserMenu } from "@/components/user-menu";
import { Button } from "@/components/ui/button";
import type { CurrentUser } from "@/server/auth/session";

export function AppHeader({ user }: { user: CurrentUser }) {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur supports-backdrop-filter:bg-background/75">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 sm:px-6">
        <Link
          href="/trips"
          className="rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <BrandMark />
        </Link>
        <MainNav />
        <div className="ml-auto flex items-center gap-2">
          <Button asChild size="sm">
            <Link href="/trips/new">
              <Plus aria-hidden />
              <span className="hidden sm:inline">New trip</span>
              <span className="sr-only sm:hidden">New trip</span>
            </Link>
          </Button>
          <UserMenu user={user} />
        </div>
      </div>
    </header>
  );
}
