import type { ModelConfig } from "./config.js";
import { chat } from "./llmClient.js";

export interface JudgeResult {
  completeness: number;
  consistency: number;
  confidence: number;
  escalate: boolean;
  get shouldEscalate(): boolean;
}

const PROMPT = `Analyze this Q&A pair and respond with ONLY JSON (no markdown):
{"completeness": 0-1, "consistency": 0-1, "confidence": 0-1, "escalate": bool}

Question: {question}
Answer: {answer}`;

export async function judge(
  question: string,
  answer: string,
  model: ModelConfig,
  threshold = 0.6
): Promise<JudgeResult> {
  try {
    const prompt = PROMPT.replace("{question}", question.slice(0, 2000)).replace("{answer}", answer.slice(0, 4000));
    const resp = await chat(model, [{ role: "user", content: prompt }], { temperature: 0, maxTokens: 200 });
    return parse(resp.content, threshold);
  } catch {
    return { completeness: 0.8, consistency: 0.8, confidence: 0.7, escalate: false,
      get shouldEscalate() { return false; } };
  }
}

function parse(text: string, threshold: number): JudgeResult {
  const m = text.match(/\{[^}]+\}/s);
  if (!m) return fallback();
  try {
    const d = JSON.parse(m[0]);
    let confidence = Number(d.confidence ?? 0.7);
    let escalate = Boolean(d.escalate ?? false);
    if (confidence < threshold) escalate = true;
    return {
      completeness: Number(d.completeness ?? 0.8),
      consistency: Number(d.consistency ?? 0.8),
      confidence,
      escalate,
      get shouldEscalate() { return this.escalate || this.confidence < 0.6; },
    };
  } catch {
    return fallback();
  }
}

function fallback(): JudgeResult {
  return { completeness: 0.8, consistency: 0.8, confidence: 0.7, escalate: false,
    get shouldEscalate() { return false; } };
}
