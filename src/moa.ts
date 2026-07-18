import type { ModelConfig } from "./config.js";
import { chat, LLMResponse } from "./llmClient.js";
import { trimToolResults } from "./compressor.js";
import { applyCacheControl } from "./cacheControl.js";

const ADVISORY = `You are a reference advisor in a Mixture of Agents process. You do NOT execute anything: you cannot call tools, run commands, browse, or access files. Your job is to give your most intelligent analysis of the task and advise on the best approach, risks, and anything the acting agent may have missed. Respond with your advice directly.`;

const AGGREGATOR = `You are the aggregator in a Mixture of Agents process. Synthesize the following reference responses into a single, comprehensive answer. Focus on the best insights, resolve disagreements, and provide a clear final answer.\n\nReference responses:\n{refs}\n\nProvide your synthesized answer:`;

interface MemberResult {
  name: string;
  status: "ok" | "failed";
  content?: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  error?: string;
}

/** Wait for quorum (2/3, min 2) members to respond, with a hard timeout. */
async function waitForQuorum(
  promises: Promise<LLMResponse>[],
  names: string[],
  quorum: number,
  timeoutMs: number
): Promise<MemberResult[]> {
  const results: MemberResult[] = new Array(promises.length);
  let settled = 0;
  let succeeded = 0;

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      // Timeout: fill in missing results as failed
      for (let i = 0; i < results.length; i++) {
        if (!results[i]) results[i] = { name: names[i], status: "failed", error: "timeout" };
      }
      resolve(results);
    }, timeoutMs);

    promises.forEach((p, i) => {
      p.then((r) => {
        results[i] = { name: names[i], status: "ok", content: r.content, inputTokens: r.inputTokens, outputTokens: r.outputTokens, latencyMs: r.latencyMs };
        succeeded++;
        settled++;
        if (succeeded >= quorum) {
          clearTimeout(timer);
          // Fill remaining as "not needed"
          for (let j = 0; j < results.length; j++) {
            if (!results[j]) results[j] = { name: names[j], status: "failed", error: "quorum reached, skipped" };
          }
          resolve(results);
        }
      }).catch((e) => {
        results[i] = { name: names[i], status: "failed", error: String(e?.message || e) };
        settled++;
        if (settled >= promises.length) {
          clearTimeout(timer);
          resolve(results);
        }
      });
    });
  });
}

export async function executeCommittee(
  messages: any[],
  members: ModelConfig[],
  aggregator: ModelConfig,
  refMaxTokens = 2048
): Promise<{ text: string; info: any[] }> {
  const refMsgs = [{ role: "system", content: ADVISORY }, ...trimToolResults(messages, 4000)];

  const memberPromises = members.map((m) =>
    chat(m, refMsgs, { temperature: 0.5, maxTokens: refMaxTokens, timeoutMs: 45_000, retries: 0 })
  );
  const names = members.map((m) => m.name);
  const quorum = Math.max(2, Math.ceil(members.length * 2 / 3));

  const results = await waitForQuorum(memberPromises, names, quorum, 50_000);

  const texts: string[] = [];
  const info: any[] = [];
  for (const r of results) {
    if (r.status === "ok" && r.content) {
      texts.push(`--- ${r.name} ---\n${r.content}`);
      info.push({ model: r.name, status: "ok", inputTokens: r.inputTokens, outputTokens: r.outputTokens, latencyMs: r.latencyMs });
    } else {
      texts.push(`[Reference ${r.name}: unavailable]`);
      info.push({ model: r.name, status: "failed", error: r.error });
    }
  }

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
