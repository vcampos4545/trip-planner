"use client";

import { useState } from "react";

import { FieldShell, useFieldId } from "@/components/shared/form-fields";
import { OptionStatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";
import { OPTION_CATEGORY_LABELS } from "@/lib/labels";
import { formatMoneyValue } from "@/lib/money";
import { createDecisionAction } from "@/server/actions/research";

import type { OptionView } from "./options-board";

export function CompareDialog({
  tripId,
  options,
  trigger,
  onCreated,
}: {
  tripId: string;
  options: OptionView[];
  trigger: React.ReactNode;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const categories = new Set(options.map((option) => option.category));
  const noun =
    categories.size === 1
      ? OPTION_CATEGORY_LABELS[options[0]?.category ?? "OTHER"].toLowerCase()
      : "option";
  const [title, setTitle] = useState("");
  const { run, pending } = useAction();
  const titleId = useFieldId("question");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setTitle(`Which ${noun} should we pick?`);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Compare and start a vote</DialogTitle>
          <DialogDescription>
            Everyone on the trip can vote. An organizer makes the final call.
            Winning a vote approves an option; it does not book it.
          </DialogDescription>
        </DialogHeader>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[32rem] text-left text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Option
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Status
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Price
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Where
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Notes
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {options.map((option) => (
                <tr key={option.id} className="align-top">
                  <th scope="row" className="px-3 py-2 font-medium">
                    {option.title}
                    <span className="block text-xs font-normal text-muted-foreground">
                      {OPTION_CATEGORY_LABELS[option.category]}
                    </span>
                  </th>
                  <td className="px-3 py-2">
                    <OptionStatusBadge status={option.status} />
                  </td>
                  <td className="px-3 py-2">
                    {formatMoneyValue(
                      option.priceAmount,
                      option.priceCurrency,
                    ) ?? (
                      <span className="text-muted-foreground italic">
                        Unknown
                      </span>
                    )}
                    {option.priceAmount && option.priceUnit ? (
                      <span className="text-xs text-muted-foreground">
                        {" "}
                        / {option.priceUnit}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    {option.locationName ?? (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </td>
                  <td className="px-3 py-2">{option.notes.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            run(
              () =>
                createDecisionAction(tripId, {
                  title,
                  description: "",
                  choices: options.map((option) => ({
                    label: option.title,
                    researchOptionId: option.id,
                  })),
                }),
              {
                success: "Vote started. Find it under Tasks & decisions.",
                onSuccess: () => {
                  setOpen(false);
                  onCreated();
                },
              },
            );
          }}
        >
          <FieldShell label="Question for the group" htmlFor={titleId}>
            <Input
              id={titleId}
              value={title}
              maxLength={160}
              onChange={(event) => setTitle(event.target.value)}
              required
            />
          </FieldShell>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={pending || options.length < 2 || !title.trim()}
            >
              Start vote
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
