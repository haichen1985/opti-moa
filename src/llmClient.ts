import type { ModelConfig } from "./config.js";

export interface LLMResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  model: string;
}

export async function chat(
  model: ModelConfig,
  messages: any[],
  opts: { temperature?: number; maxTokens?: number; extra?: Record<string, any> } = {}
): Promise<LLMResponse> {
  const start = performance.now();
  const body: any = { model: model.model, messages };
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  if (opts.maxTokens !== undefined) body.max_tokens = opts.maxTokens;
  if (opts.extra) Object.assign(body, opts.extra);

  const resp = await fetch(`${model.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${model.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`LLM error ${resp.status}: ${await resp.text()}`);
  const data: any = await resp.json();
  const latency = performance.now() - start;

  let content = "";
  const choices = data.choices || [];
  if (choices.length) {
    const msg = choices[0].message || {};
    content = msg.content || "";
  }
  const usage = data.usage || {};
  return {
    content,
    inputTokens: usage.prompt_tokens || 0,
    outputTokens: usage.completion_tokens || 0,
    latencyMs: latency,
    model: model.model,
  };
}

export async function chatRaw(model: ModelConfig, body: any): Promise<any> {
  const resp = await fetch(`${model.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${model.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...body, model: model.model }),
  });
  if (!resp.ok) throw new Error(`LLM error ${resp.status}`);
  return resp.json();
}

export async function chatStream(
  model: ModelConfig,
  messages: any[],
  opts: { temperature?: number; maxTokens?: number } = {}
): Promise<string> {
  const body: any = { model: model.model, messages, stream: true };
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  if (opts.maxTokens !== undefined) body.max_tokens = opts.maxTokens;

  const resp = await fetch(`${model.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${model.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok || !resp.body) throw new Error(`Stream error ${resp.status}`);

  const text = await resp.text();
  const lines = text.split("\n");
  const parts: string[] = [];
  for (const line of lines) {
    if (line.startsWith("data: ") && line !== "data: [DONE]") {
      try {
        const data = JSON.parse(line.slice(6));
        const delta = data.choices?.[0]?.delta;
        if (delta?.content) parts.push(delta.content);
      } catch {}
    }
  }
  return parts.join("");
}

export async function getEmbeddings(
  baseUrl: string,
  apiKey: string,
  model: string,
  text: string
): Promise<number[] | null> {
  try {
    const resp = await fetch(`${baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, input: text.slice(0, 8000) }),
    });
    if (!resp.ok) return null;
    const data: any = await resp.json();
    return data.data?.[0]?.embedding || null;
  } catch {
    return null;
  }
}

export async function callWithFallback(
  models: ModelConfig[],
  messages: any[],
  opts: { temperature?: number; maxTokens?: number } = {}
): Promise<LLMResponse> {
  let lastError: Error | null = null;
  for (const model of models) {
    try {
      return await chat(model, messages, opts);
    } catch (e) {
      lastError = e as Error;
    }
  }
  throw lastError || new Error("No models configured");
}
