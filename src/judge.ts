import type { ModelConfig } from "./config.js";
import { chat } from "./llmClient.js";

export interface JudgeResult {
  completeness: number;
  consistency: number;
  confidence: number;
  escalate: boolean;
  shouldEscalate: boolean;
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
    return fallback(threshold);
  }
}

function parse(text: string, threshold: number): JudgeResult {
  const m = text.match(/\{[^}]+\}/s);
  if (!m) return fallback(threshold);
  try {
    const d = JSON.parse(m[0]);
    const confidence = Number(d.confidence ?? 0.7);
    const shouldEscalate = confidence < threshold || Boolean(d.escalate ?? false);
    return {
      completeness: Number(d.completeness ?? 0.8),
      consistency: Number(d.consistency ?? 0.8),
      confidence,
      escalate: shouldEscalate,
      shouldEscalate,
    };
  } catch {
    return fallback(threshold);
  }
}

function fallback(threshold: number = 0.6): JudgeResult {
  const confidence = 0.7;
  return {
    completeness: 0.8,
    consistency: 0.8,
    confidence,
    escalate: false,
    shouldEscalate: confidence < threshold,
  };
}
