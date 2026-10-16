import { APP_NAME } from "@/config/brand";

import type { EmailMessage } from "./types";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** The invitation email. Names and titles come from users, so the HTML version escapes them. */
export function invitationEmail(input: {
  to: string;
  inviterName: string | null;
  tripTitle: string;
  url: string;
  expiresAt: Date;
}): EmailMessage {
  const inviter = input.inviterName?.trim() || "A friend";
  const expires = input.expiresAt.toUTCString().replace(/:\d\d GMT$/, " UTC");
  const subject = `${inviter} invited you to plan "${input.tripTitle}"`.slice(
    0,
    200,
  );
  const text = [
    `${inviter} invited you to plan "${input.tripTitle}" together on ${APP_NAME}.`,
    "",
    `Join the trip: ${input.url}`,
    "",
    `Sign in with the Google account for ${input.to} to accept. The invitation expires ${expires}.`,
    "If you weren't expecting this, you can ignore this email.",
  ].join("\n");
  const html = `<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;line-height:1.5;color:#1f2937">
<p>${escapeHtml(inviter)} invited you to plan <strong>${escapeHtml(input.tripTitle)}</strong> together on ${escapeHtml(APP_NAME)}.</p>
<p><a href="${escapeHtml(input.url)}" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#2563eb;color:#ffffff;text-decoration:none">Join the trip</a></p>
<p style="font-size:13px;color:#6b7280">Sign in with the Google account for ${escapeHtml(input.to)} to accept. The invitation expires ${escapeHtml(expires)}.<br>If you weren't expecting this, you can ignore this email.</p>
</body></html>`;
  return { to: input.to, subject, text, html };
}
