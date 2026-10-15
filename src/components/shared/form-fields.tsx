"use client";

import { useId } from "react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function FieldShell({
  label,
  htmlFor,
  error,
  hint,
  className,
  children,
  optional = false,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  className?: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={htmlFor} className="text-[13px]">
        {label}
        {optional ? (
          <span className="font-normal text-muted-foreground">
            <span className="sr-only"> </span>(optional)
          </span>
        ) : null}
      </Label>
      {children}
      {error ? (
        <p
          id={`${htmlFor}-error`}
          className="text-xs text-destructive"
          role="alert"
        >
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function useFieldId(name: string) {
  return `${useId()}-${name}`.replace(/:/g, "");
}

/** A styled native select. Native controls keep keyboard and screen reader behavior intact. */
export function NativeSelect({
  className,
  children,
  ...props
}: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-input bg-background px-2 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive md:text-sm",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function fieldError(
  errors: Record<string, { message?: string } | undefined>,
  name: string,
) {
  return errors[name]?.message;
}
