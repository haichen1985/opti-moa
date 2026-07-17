import type { ModelConfig } from "./config.js";
import type { RiskScore } from "./scorer.js";
import { chat } from "./llmClient.js";

export interface LLMScore {
  complexity: number;
  risk: number;
  uncertainty: number;
  multiView: number;
  taskType: string;
  reasoning: string;
}

const PROMPT = `Analyze this input and classify for model routing. Respond with ONLY JSON (no markdown):
{"complexity": 0-1, "risk": 0-1, "uncertainty": 0-1, "multi_view": 0-1, "task_type": "coding|translation|summarization|architecture|research|writing|math|legal|medical|general", "reasoning": "one sentence"}

Input: {input}`;

export async function llmClassify(input: string, model: ModelConfig, timeout = 15): Promise<LLMScore | null> {
  try {
    const resp = await chat(model, [{ role: "user", content: PROMPT.replace("{input}", input.slice(0, 3000)) }], { temperature: 0, maxTokens: 200 });
    const m = resp.content.match(/\{[^}]+\}/s);
    if (!m) return null;
    const d = JSON.parse(m[0]);
    return {
      complexity: Number(d.complexity ?? 0.5),
      risk: Number(d.risk ?? 0.5),
      uncertainty: Number(d.uncertainty ?? 0.5),
      multiView: Number(d.multi_view ?? 0.5),
      taskType: String(d.task_type ?? "general"),
      reasoning: String(d.reasoning ?? ""),
    };
  } catch {
    return null;
  }
}

export function mergeScores(keyword: RiskScore, llm: LLMScore): RiskScore {
  const complexity = keyword.complexity * 0.3 + llm.complexity * 0.7;
  const risk = keyword.risk * 0.3 + llm.risk * 0.7;
  const uncertainty = keyword.uncertainty * 0.3 + llm.uncertainty * 0.7;
  const multiView = keyword.multiView * 0.3 + llm.multiView * 0.7;
  let committeeScore = complexity * 0.2 + risk * 0.35 + uncertainty * 0.25 + multiView * 0.2;
  if (keyword.hasTools) committeeScore = 0;
  // Consistent with scorer.ts classifyTier thresholds
  const tier = risk > 0.3 ? "C3" : complexity > 0.5 ? (risk < 0.2 ? "C2" : "C3") : complexity > 0.2 ? "C1" : "C0";
  return { complexity, risk, uncertainty, multiView, committeeScore, tier: tier as RiskScore["tier"], taskType: llm.taskType !== "general" ? llm.taskType : keyword.taskType, hasTools: keyword.hasTools };
}
