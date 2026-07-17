import type { ModelConfig } from "./config.js";
import { chat, LLMResponse } from "./llmClient.js";
import { trimToolResults } from "./compressor.js";
import { applyCacheControl } from "./cacheControl.js";

const ADVISORY = `You are a reference advisor in a Mixture of Agents process. You do NOT execute anything: you cannot call tools, run commands, browse, or access files. Your job is to give your most intelligent analysis of the task and advise on the best approach, risks, and anything the acting agent may have missed. Respond with your advice directly.`;

const AGGREGATOR = `You are the aggregator in a Mixture of Agents process. Synthesize the following reference responses into a single, comprehensive answer. Focus on the best insights, resolve disagreements, and provide a clear final answer.\n\nReference responses:\n{refs}\n\nProvide your synthesized answer:`;

export async function executeCommittee(
  messages: any[],
  members: ModelConfig[],
  aggregator: ModelConfig,
  refMaxTokens = 2048
): Promise<{ text: string; info: any[] }> {
  const refMsgs = [{ role: "system", content: ADVISORY }, ...trimToolResults(messages, 4000)];

  const results = await Promise.allSettled(
    members.map((m) => chat(m, refMsgs, { temperature: 0.5, maxTokens: refMaxTokens, timeoutMs: 45_000, retries: 0 }))
  );

  const texts: string[] = [];
  const info: any[] = [];
  results.forEach((r, i) => {
    const name = members[i].name;
    if (r.status === "fulfilled") {
      texts.push(`--- ${name} ---\n${r.value.content}`);
      info.push({ model: name, status: "ok", inputTokens: r.value.inputTokens, outputTokens: r.value.outputTokens, latencyMs: r.value.latencyMs });
    } else {
      texts.push(`[Reference ${name}: unavailable]`);
      info.push({ model: name, status: "failed", error: String(r.reason) });
    }
  });

  const joined = texts.join("\n\n");
  const aggPrompt = AGGREGATOR.replace("{refs}", joined);
  let aggMsgs = [{ role: "user", content: aggPrompt }];
  aggMsgs = applyCacheControl(aggMsgs, aggregator);

  try {
    const agg = await chat(aggregator, aggMsgs, { temperature: 0.3, maxTokens: aggregator.maxTokens, timeoutMs: 45_000, retries: 0 });
    const final = agg.content.trim() || texts[0] || "Committee produced no output.";
    return { text: final, info };
  } catch {
    // Aggregator failed: return the longest successful member response
    const valid = texts.filter((t) => !t.startsWith("[Reference"));
    const best = valid.length ? valid.reduce((a, b) => a.length >= b.length ? a : b) : texts[0] || "Committee produced no output.";
    return { text: best, info };
  }
}
