import type { ChatEffect, ChatMessage } from "./atlas-chat";

type StoredMessage = {
  id: string;
  role: "USER" | "ASSISTANT" | "NOTICE";
  content: string;
  model: string | null;
  metadata: unknown;
  createdAt: Date;
};

function effectsOf(metadata: unknown): ChatEffect[] {
  if (!metadata || typeof metadata !== "object" || !("effects" in metadata))
    return [];
  const effects = (metadata as { effects: unknown }).effects;
  if (!Array.isArray(effects)) return [];
  return effects
    .filter(
      (effect): effect is ChatEffect =>
        typeof effect === "object" && effect !== null && "summary" in effect,
    )
    .map((effect) => ({
      tool: String(effect.tool),
      ok: Boolean(effect.ok),
      kind: String(effect.kind),
      summary: String(effect.summary),
    }));
}

export function toChatMessages(messages: StoredMessage[]): ChatMessage[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    model: message.model,
    createdAt: message.createdAt.toISOString(),
    effects: effectsOf(message.metadata),
  }));
}
