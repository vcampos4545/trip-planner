/** A message the app sends. Both a plain-text and an HTML body are always provided. */
export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

/**
 * Sends email. One implementation exists (Resend). To add another, implement this interface and
 * select it in `getEmailProvider`.
 */
export interface EmailProvider {
  readonly id: string;
  readonly label: string;
  /** Resolves with the provider's message ID once the provider accepted the message. */
  send(message: EmailMessage): Promise<{ id: string | null }>;
}

/** The provider rejected or could not take the message. The message is safe to show. */
export class EmailSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailSendError";
  }
}
