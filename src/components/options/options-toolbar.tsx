"use client";

import { Search } from "lucide-react";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { NativeSelect } from "@/components/shared/form-fields";
import { Input } from "@/components/ui/input";
import { OptionCategory, OptionStatus } from "@/generated/prisma/enums";
import { OPTION_CATEGORY_LABELS, OPTION_STATUS_LABELS } from "@/lib/labels";

export function OptionsToolbar() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [query, setQuery] = useState(params.get("q") ?? "");

  function update(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    const search = next.toString();
    router.replace(`${pathname}${search ? `?${search}` : ""}` as Route, {
      scroll: false,
    });
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <form
        role="search"
        className="relative flex-1"
        onSubmit={(event) => {
          event.preventDefault();
          update("q", query.trim());
        }}
      >
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <label htmlFor="option-search" className="sr-only">
          Search saved options
        </label>
        <Input
          id="option-search"
          className="pl-8"
          placeholder="Search saved options"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onBlur={() => update("q", query.trim())}
        />
      </form>
      <div className="flex gap-2">
        <label htmlFor="option-category" className="sr-only">
          Filter by type
        </label>
        <NativeSelect
          id="option-category"
          className="sm:w-40"
          value={params.get("category") ?? ""}
          onChange={(event) => update("category", event.target.value)}
        >
          <option value="">All types</option>
          {Object.values(OptionCategory).map((value) => (
            <option key={value} value={value}>
              {OPTION_CATEGORY_LABELS[value]}
            </option>
          ))}
        </NativeSelect>
        <label htmlFor="option-status" className="sr-only">
          Filter by status
        </label>
        <NativeSelect
          id="option-status"
          className="sm:w-40"
          value={params.get("status") ?? ""}
          onChange={(event) => update("status", event.target.value)}
        >
          <option value="">Active</option>
          {Object.values(OptionStatus).map((value) => (
            <option key={value} value={value}>
              {OPTION_STATUS_LABELS[value]}
            </option>
          ))}
          <option value="ALL">All statuses</option>
        </NativeSelect>
      </div>
    </div>
  );
}
