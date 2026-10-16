import "server-only";

import { EmailSendError, type EmailMessage, type EmailProvider } from "./types";

const DEFAULT_API_URL = "https://api.resend.com";
const TIMEOUT_MS = 15_000;

/** Sends through Resend's REST API (https://resend.com/docs/api-reference/emails/send-email). */
export class ResendEmailProvider implements EmailProvider {
  readonly id = "resend";
  readonly label = "Resend";

  constructor(
    private readonly options: {
      apiKey: string;
      from: string;
      apiUrl?: string;
      fetch?: typeof fetch;
    },
  ) {}

  async send(message: EmailMessage) {
    const doFetch = this.options.fetch ?? fetch;
    const base = (this.options.apiUrl || DEFAULT_API_URL).replace(/\/$/, "");
    let response: Response;
    try {
      response = await doFetch(`${base}/emails`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: this.options.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new EmailSendError("The email service could not be reached.");
    }
    if (!response.ok) {
      console.error(
        `[email] Resend rejected a message: HTTP ${response.status}`,
      );
      throw new EmailSendError(
        response.status === 429
          ? "The email service is rate limiting this app. Try again later."
          : response.status === 401 || response.status === 403
            ? "The email service rejected the server's API key or sender address."
            : "The email service rejected the message.",
      );
    }
    const body = (await response.json().catch(() => null)) as {
      id?: unknown;
    } | null;
    return { id: typeof body?.id === "string" ? body.id : null };
  }
}
