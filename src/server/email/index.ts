import "server-only";

import { ResendEmailProvider } from "./resend";
import type { EmailProvider } from "./types";

export type EmailStatus =
  { configured: true; label: string } | { configured: false; reason: string };

/**
 * Email is sent through Resend when RESEND_API_KEY and EMAIL_FROM are both set. Without them the
 * app still creates email invitations and shows their links to copy; it never claims an email was
 * sent.
 */
export function getEmailProvider(): EmailProvider | null {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  if (!apiKey || !from) return null;
  return new ResendEmailProvider({
    apiKey,
    from,
    apiUrl: process.env.RESEND_API_URL?.trim() || undefined,
  });
}

export function getEmailStatus(): EmailStatus {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  if (apiKey && from) return { configured: true, label: "Resend" };
  return {
    configured: false,
    reason: apiKey
      ? "EMAIL_FROM is not set on the server."
      : "RESEND_API_KEY is not set on the server.",
  };
}

export type { EmailMessage, EmailProvider } from "./types";
export { EmailSendError } from "./types";
