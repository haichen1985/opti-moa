import type { ModelConfig } from "./config.js";

export function applyCacheControl(messages: any[], model: ModelConfig): any[] {
  if (!model.supportsCache) return messages;
  let marked = 0;
  const max = 4;
  return messages.map((msg) => {
    if (marked >= max) return msg;
    const content = msg.content;
    if (typeof content === "string") {
      marked++;
      return { ...msg, content: [{ type: "text", text: content, cache_control: { type: "ephemeral" } }] };
    }
    if (Array.isArray(content)) {
      const last = content[content.length - 1];
      if (last && typeof last === "object" && marked < max) {
        marked++;
        return { ...msg, content: content.map((b, i) => i === content.length - 1 ? { ...b, cache_control: { type: "ephemeral" } } : b) };
      }
    }
    return msg;
  });
}
