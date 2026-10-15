import {
  AlertCircle,
  CalendarDays,
  ListChecks,
  Sparkles,
  Users,
} from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { BrandMark } from "@/components/brand-mark";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ASSISTANT_NAME } from "@/config/brand";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { isGoogleAuthConfigured } from "@/auth";
import { getCurrentUser } from "@/server/auth/session";

import { signInWithGoogle } from "./actions";

export const metadata: Metadata = { title: "Sign in" };

const ERROR_MESSAGES: Record<string, string> = {
  AccessDenied:
    "Access was denied. Check that you picked the right Google account and try again.",
  Configuration:
    "Sign-in is not configured correctly on this server. Check the Auth.js settings.",
  OAuthSignin: "We could not start Google sign-in. Please try again.",
  OAuthCallback: "Google sign-in did not complete. Please try again.",
  OAuthCallbackError: "Google sign-in did not complete. Please try again.",
  OAuthAccountNotLinked:
    "That email is already linked to a different sign-in method.",
  Verification: "The sign-in link is no longer valid.",
};

const FEATURES = [
  { icon: Users, text: "One shared workspace for the whole group" },
  {
    icon: Sparkles,
    text: `${ASSISTANT_NAME} turns loose ideas into a structured plan`,
  },
  {
    icon: ListChecks,
    text: "Tasks, votes, and decisions so research isn't duplicated",
  },
  {
    icon: CalendarDays,
    text: "A day-by-day itinerary and every booking in one place",
  },
];

export default async function SignInPage({
  searchParams,
}: PageProps<"/signin">) {
  const params = await searchParams;
  const callbackUrl = safeRedirectPath(params.callbackUrl);
  const user = await getCurrentUser();
  if (user) redirect(callbackUrl as "/trips");

  const errorCode = typeof params.error === "string" ? params.error : undefined;
  const errorMessage = errorCode
    ? (ERROR_MESSAGES[errorCode] ??
      "Something went wrong while signing in. Please try again.")
    : undefined;
  const expired = params.reason === "expired";
  const googleConfigured = isGoogleAuthConfigured();

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12 sm:px-6">
      <div className="grid w-full max-w-4xl items-center gap-10 md:grid-cols-[1.1fr_1fr] md:gap-16">
        <section className="space-y-8">
          <BrandMark />
          <div className="space-y-3">
            <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              Plan the trip together, not in the group chat.
            </h1>
            <p className="max-w-md text-base text-muted-foreground">
              Go from &ldquo;we should go somewhere&rdquo; to a shared itinerary
              with your group.
            </p>
          </div>
          <ul className="space-y-3">
            {FEATURES.map(({ icon: Icon, text }) => (
              <li
                key={text}
                className="flex items-center gap-3 text-sm text-foreground/80"
              >
                <span className="flex size-8 items-center justify-center rounded-md border bg-card">
                  <Icon className="size-4 text-primary" aria-hidden />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-xl border bg-card p-6 shadow-xs sm:p-8">
          <div className="space-y-1.5">
            <h2 className="text-lg font-semibold tracking-tight">Sign in</h2>
            <p className="text-sm text-muted-foreground">
              Use your Google account to continue.
            </p>
          </div>

          <div className="mt-6 space-y-4">
            {expired ? (
              <Alert>
                <AlertCircle aria-hidden />
                <AlertTitle>Your session expired</AlertTitle>
                <AlertDescription>
                  Sign in again to pick up where you left off.
                </AlertDescription>
              </Alert>
            ) : null}
            {errorMessage ? (
              <Alert variant="destructive">
                <AlertCircle aria-hidden />
                <AlertTitle>Sign-in failed</AlertTitle>
                <AlertDescription>{errorMessage}</AlertDescription>
              </Alert>
            ) : null}
            {!googleConfigured ? (
              <Alert>
                <AlertCircle aria-hidden />
                <AlertTitle>Google sign-in is not configured</AlertTitle>
                <AlertDescription>
                  Set AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET on the server. The
                  README explains how to create the OAuth client.
                </AlertDescription>
              </Alert>
            ) : null}

            <form action={signInWithGoogle}>
              <input type="hidden" name="callbackUrl" value={callbackUrl} />
              <Button
                type="submit"
                size="lg"
                className="w-full"
                disabled={!googleConfigured}
              >
                <GoogleIcon />
                Continue with Google
              </Button>
            </form>
            <p className="text-xs text-muted-foreground">
              We only use your name, email, and profile photo to identify you to
              your trip group.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path
        fill="#FFFFFF"
        d="M21.6 12.23c0-.68-.06-1.36-.18-2.02H12v3.83h5.4a4.62 4.62 0 0 1-2 3.03v2.5h3.23c1.9-1.75 2.97-4.32 2.97-7.34Z"
        opacity=".95"
      />
      <path
        fill="#FFFFFF"
        d="M12 22c2.7 0 4.97-.9 6.63-2.43l-3.23-2.5c-.9.6-2.05.95-3.4.95-2.6 0-4.82-1.76-5.6-4.13H3.06v2.58A10 10 0 0 0 12 22Z"
        opacity=".8"
      />
      <path
        fill="#FFFFFF"
        d="M6.4 13.9a6 6 0 0 1 0-3.8V7.52H3.06a10 10 0 0 0 0 8.96L6.4 13.9Z"
        opacity=".65"
      />
      <path
        fill="#FFFFFF"
        d="M12 5.98c1.47 0 2.79.5 3.83 1.5l2.86-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.94 5.52L6.4 10.1C7.18 7.73 9.4 5.98 12 5.98Z"
        opacity=".9"
      />
    </svg>
  );
}
