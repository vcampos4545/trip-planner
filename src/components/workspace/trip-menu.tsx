"use client";

import { DoorOpen, Flag, MoreHorizontal, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TripStage } from "@/generated/prisma/enums";
import { useAction } from "@/hooks/use-action";
import { TRIP_STAGE_LABELS } from "@/lib/labels";
import { leaveTripAction } from "@/server/actions/members";
import { deleteTripAction, setTripStageAction } from "@/server/actions/trips";

export function TripMenu({
  tripId,
  title,
  stage,
  isOrganizer,
}: {
  tripId: string;
  title: string;
  stage: TripStage;
  isOrganizer: boolean;
}) {
  const { run, pending } = useAction();
  const [confirm, setConfirm] = useState<"delete" | "leave" | null>(null);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Trip options"
            disabled={pending}
          >
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Flag aria-hidden />
              Planning status
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuLabel>Planning status</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={stage}
                onValueChange={(value) =>
                  run(() => setTripStageAction(tripId, value), {
                    success: "Status updated",
                  })
                }
              >
                {Object.values(TripStage).map((value) => (
                  <DropdownMenuRadioItem key={value} value={value}>
                    {TRIP_STAGE_LABELS[value]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setConfirm("leave")}>
            <DoorOpen aria-hidden />
            Leave trip
          </DropdownMenuItem>
          {isOrganizer ? (
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => setConfirm("delete")}
            >
              <Trash2 aria-hidden />
              Delete trip
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === "delete"
                ? `Delete "${title}"?`
                : `Leave "${title}"?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "delete"
                ? "This permanently deletes the trip for every member, including options, tasks, itinerary, and bookings."
                : "You'll lose access to this trip until someone invites you again."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const action = confirm;
                setConfirm(null);
                if (action === "delete") run(() => deleteTripAction(tripId));
                if (action === "leave") run(() => leaveTripAction(tripId));
              }}
            >
              {confirm === "delete" ? "Delete trip" : "Leave trip"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
