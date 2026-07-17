export function trimToolResults(messages: any[], budget = 4000): any[] {
  return messages.map((msg) => {
    const role = msg.role;
    const content = msg.content;
    if (role === "tool" && typeof content === "string" && content.length > budget) {
      return { ...msg, content: headTail(content, budget) };
    }
    if (role === "assistant" && typeof content === "string" && content.length > budget * 2) {
      return { ...msg, content: headTail(content, budget) };
    }
    return msg;
  });
}

export function compressContext(messages: any[], threshold = 20000, budget = 4000): any[] {
  const total = messages.reduce((sum, m) => sum + msgLen(m), 0);
  if (total <= threshold) return messages;

  const system = messages.filter((m) => m.role === "system");
  const nonSys = messages.filter((m) => m.role !== "system");
  const keepCount = Math.min(6, nonSys.length);
  const recent = keepCount > 0 ? nonSys.slice(-keepCount) : [];
  const older = keepCount > 0 ? nonSys.slice(0, -keepCount) : nonSys;

  if (!older.length) return trimToolResults(messages, budget);

  const parts: string[] = [];
  for (const m of older) {
    const role = m.role || "unknown";
    const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    parts.push(`[${role}] ${content.slice(0, 200)}${content.length > 200 ? " [...]" : ""}`);
  }
  return [...system, { role: "system", content: `Earlier conversation summary:\n${parts.slice(-20).join("\n")}` }, ...trimToolResults(recent, budget)];
}

function headTail(text: string, budget: number): string {
  if (text.length <= budget) return text;
  const half = Math.floor(budget / 2);
  return `${text.slice(0, half)}\n\n[... ${text.length - budget} chars omitted ...]\n\n${text.slice(-half)}`;
}

function msgLen(msg: any): number {
  const c = msg.content;
  if (typeof c === "string") return c.length;
  if (Array.isArray(c)) return c.reduce((s: number, i: any) => s + String(i).length, 0);
  return 0;
}
