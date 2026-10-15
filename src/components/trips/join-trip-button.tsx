"use client";

import { UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAction } from "@/hooks/use-action";
import { acceptInvitationAction } from "@/server/actions/members";

export function JoinTripButton({ token }: { token: string }) {
  const { run, pending } = useAction();
  return (
    <Button
      className="w-full"
      size="lg"
      disabled={pending}
      onClick={() => run(() => acceptInvitationAction(token))}
    >
      <UserPlus aria-hidden />
      {pending ? "Joining..." : "Join this trip"}
    </Button>
  );
}
