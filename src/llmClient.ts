import type { ModelConfig } from "./config.js";

export interface LLMResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  model: string;
}

const DEFAULT_TIMEOUT = 30_000;
const STREAM_TIMEOUT = 60_000;
const MAX_RETRIES = 1;

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
  retries = MAX_RETRIES
): Promise<Response> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const resp = await fetch(url, { ...options, signal: ctrl.signal });
      clearTimeout(timer);
      // Retry on 5xx or 429
      if (resp.status >= 500 || resp.status === 429) {
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
          continue;
        }
      }
      return resp;
    } catch (e: any) {
      lastErr = e;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
    }
  }
  throw lastErr || new Error("fetch failed");
}

export async function chat(
  model: ModelConfig,
  messages: any[],
  opts: { temperature?: number; maxTokens?: number; extra?: Record<string, any>; timeoutMs?: number; retries?: number } = {}
): Promise<LLMResponse> {
  const start = performance.now();
  const body: any = { model: model.model, messages };
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  if (opts.maxTokens !== undefined) body.max_tokens = opts.maxTokens;
  if (opts.extra) Object.assign(body, opts.extra);

  const resp = await fetchWithTimeout(
    `${model.baseUrl}/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${model.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    opts.timeoutMs ?? DEFAULT_TIMEOUT,
    opts.retries ?? MAX_RETRIES
  );
  if (!resp.ok) throw new Error(`LLM error ${resp.status}: ${await resp.text()}`);
  const data: any = await resp.json();
  const latency = performance.now() - start;

  let content = "";
  const choices = data.choices || [];
  if (choices.length) {
    const msg = choices[0].message || {};
    content = msg.content || "";
    // Reasoning models (e.g. mimo, deepseek-reasoner) may put output in reasoning_content
    if (!content && msg.reasoning_content) content = msg.reasoning_content;
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
  const resp = await fetchWithTimeout(
    `${model.baseUrl}/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${model.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...body, model: model.model }),
    },
    DEFAULT_TIMEOUT
  );
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

  const resp = await fetchWithTimeout(
    `${model.baseUrl}/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${model.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    STREAM_TIMEOUT
  );
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
        else if (delta?.reasoning_content) parts.push(delta.reasoning_content);
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
    const resp = await fetchWithTimeout(
      `${baseUrl}/embeddings`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model, input: text.slice(0, 8000) }),
      },
      DEFAULT_TIMEOUT
    );
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
