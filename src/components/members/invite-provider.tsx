"use client";

import { UserPlus } from "lucide-react";
import { createContext, useContext, useMemo } from "react";

import { Button } from "@/components/ui/button";
import { useOpenParam } from "@/hooks/use-open-param";

import {
  InviteDialog,
  type EmailInviteView,
  type InviteLinkView,
  type InviteSettings,
} from "./invite-dialog";

type InviteContextValue = {
  canInvite: boolean;
  openInvite: () => void;
};

const InviteContext = createContext<InviteContextValue>({
  canInvite: false,
  openInvite: () => {},
});

export function useInvite() {
  return useContext(InviteContext);
}

/**
 * Holds the trip's one invite dialog. The header button, the next-step card, and the members card
 * all open it, and a link can open it with `?open=invite`.
 */
export function InviteProvider({
  canInvite,
  settings,
  links,
  emails,
  children,
}: {
  canInvite: boolean;
  settings: InviteSettings;
  links: InviteLinkView[];
  emails: EmailInviteView[];
  children: React.ReactNode;
}) {
  const [requested, setOpen] = useOpenParam("invite");
  const open = canInvite && requested;
  const value = useMemo(
    () => ({ canInvite, openInvite: () => setOpen(true) }),
    [canInvite, setOpen],
  );
  return (
    <InviteContext.Provider value={value}>
      {children}
      {canInvite ? (
        <InviteDialog
          open={open}
          onOpenChange={setOpen}
          settings={settings}
          links={links}
          emails={emails}
        />
      ) : null}
    </InviteContext.Provider>
  );
}

/** Opens the invite dialog. Renders nothing for someone who isn't allowed to invite. */
export function InviteButton({
  variant = "outline",
  label = "Invite",
}: {
  variant?: "outline" | "default" | "secondary";
  label?: string;
}) {
  const { canInvite, openInvite } = useInvite();
  if (!canInvite) return null;
  return (
    <Button size="sm" variant={variant} onClick={openInvite}>
      <UserPlus aria-hidden />
      {label}
    </Button>
  );
}
