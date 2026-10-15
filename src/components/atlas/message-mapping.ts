import type { ChatEffect, ChatMessage, ChatSource } from "./atlas-chat";

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

function sourcesOf(metadata: unknown): ChatSource[] {
  if (!metadata || typeof metadata !== "object" || !("sources" in metadata))
    return [];
  const sources = (metadata as { sources: unknown }).sources;
  if (!Array.isArray(sources)) return [];
  return sources
    .filter(
      (source): source is ChatSource =>
        typeof source === "object" &&
        source !== null &&
        typeof source.url === "string" &&
        /^https?:\/\//i.test(source.url),
    )
    .map((source) => ({
      title: String(source.title),
      url: source.url,
      sourceName: String(source.sourceName),
      retrievedAt: String(source.retrievedAt),
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
    sources: sourcesOf(message.metadata),
  }));
}
