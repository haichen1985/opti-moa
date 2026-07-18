import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import * as yaml from "js-yaml";
import { loadConfig, findConfig, type AppConfig, type ModelConfig } from "./config.js";
import { score, extractUserInput, isBorderline } from "./scorer.js";
import { llmClassify, mergeScores } from "./llmScorer.js";
import { judge } from "./judge.js";
import { ExperienceEngine } from "./experience.js";
import { SemanticMemory } from "./memory.js";
import { executeCommittee } from "./moa.js";
import { compressContext } from "./compressor.js";
import { applyCacheControl } from "./cacheControl.js";
import { chat, chatRaw, chatStream } from "./llmClient.js";
import { createMcpServer } from "./mcpServer.js";
import { FlywheelCollector } from "./flywheel.js";
import { stream as honoStream } from "hono/streaming";

let config: AppConfig | null = null;
let experience: ExperienceEngine | null = null;
let memory: SemanticMemory | null = null;
let flywheel: FlywheelCollector | null = null;
let moaCountToday = 0;
let moaCountDate = new Date().toDateString();
const app = new Hono();

function init(configPath: string) {
  config = loadConfig(configPath);
  experience = new ExperienceEngine(config.experienceDbPath);
  flywheel = new FlywheelCollector(config.experienceDbPath);
  const cheap = config.models[config.tiers.C0 || "cheap"];
  if (cheap) {
    memory = new SemanticMemory(
      config.experienceDbPath.replace("experience.db", "memory.db"),
      cheap.baseUrl, cheap.apiKey
    );
  }
  // Mount MCP tool server
  app.route("/mcp", createMcpServer(config));
  console.log(`opti-moa ready: ${Object.keys(config.models).length} models, port ${config.port}`);
}

const SETUP_HTML = readFileSync(new URL("./web/setup.html", import.meta.url), "utf-8");

function needsSetup(): boolean {
  return !config || Object.keys(config.models).length === 0;
}

// ─── Setup page ───
app.get("/", (c) => {
  if (needsSetup()) return c.html(SETUP_HTML);
  return c.html(`<h1>opti-moa running</h1><p>base_url: http://${config!.host}:${config!.port}/v1</p><p><a href="/stats">stats</a> | <a href="/memory">memory</a></p>`);
});

app.post("/api/setup", async (c) => {
  const body = await c.req.json();
  const configDir = join(homedir(), ".opti-moa");
  mkdirSync(configDir, { recursive: true });
  const configPath = join(configDir, "config.yaml");
  writeFileSync(configPath, yaml.dump(body, { indent: 2 }), "utf-8");
  init(configPath);
  return c.json({ ok: true });
});

// ─── OpenAI-compatible proxy ───
app.post("/v1/chat/completions", async (c) => {
  if (!config) return c.json({ error: { message: "Not configured. Visit / to setup." } }, 500);
  const body = await c.req.json();
  let messages: any[] = body.messages || [];
  const hasTools = !!(body.tools?.length);
  const stream = body.stream || false;
  const userInput = extractUserInput(messages);
  let rs = score(userInput, hasTools);

  // LLM-enhanced scoring for borderline cases (not clearly simple, not clearly complex)
  if (!hasTools && rs.committeeScore > 0.2 && rs.committeeScore < config.committee.triggerThreshold) {
    try {
      const cheapModel = config.models[config.tiers.C0 || "cheap"];
      if (cheapModel) {
        const llmResult = await Promise.race([
          llmClassify(userInput, cheapModel),
          new Promise<null>((_, rej) => setTimeout(() => rej(new Error("llm-score-timeout")), 5000)),
        ]);
        if (llmResult) {
          rs = mergeScores(rs, llmResult);
        }
      }
    } catch { /* LLM scoring failed, use keyword score */ }
  }

  // Context compression
  if (config.compressor.enabled) {
    messages = compressContext(messages, config.compressor.compressThreshold, config.compressor.toolResultBudget);
    body.messages = messages;
  }

  // Memory recall (non-blocking, skip on failure/timeout)
  if (memory && !hasTools) {
    try {
      const recalled = await Promise.race([
        memory.recall(userInput, "L0", 3),
        new Promise<never[]>((_, rej) => setTimeout(() => rej(new Error("timeout")), 3000)),
      ]);
      const recallText = recalled.filter((r) => r.score > 0.5).map((r) => `[Relevant past context] ${r.content.slice(0, 300)}`).join("\n\n");
      if (recallText) messages.unshift({ role: "system", content: recallText });
    } catch {}
  }

  // Experience lookup
  const strategy = experience?.lookup(rs.taskType);
  let usedCommittee = false;
  let modelUsed = "";
  let requestSuccess = true;
  const trigger = rs.committeeScore >= config.committee.triggerThreshold;

  // True streaming: for simple requests that don't need committee/judge, pass through SSE directly
  const needsDecision = !hasTools && rs.committeeScore > 0.4 && rs.committeeScore < config.committee.triggerThreshold;
  const willCommittee = (strategy?.isReliable && strategy.committee) || (trigger && withinBudget() && !hasTools);
  
  if (stream && !willCommittee && !needsDecision) {
    const tierModel = config.models[config.tiers[rs.tier] || "cheap"];
    modelUsed = tierModel.name;
    messages = applyAdaptivePrompt(messages, rs.tier);
    messages = applyCacheControl(messages, tierModel);
    experience?.record(rs.taskType, userInput, modelUsed, false, true);

    c.header("Content-Type", "text/event-stream");
    return honoStream(c, async (stream) => {
      try {
        const body2: any = { model: tierModel.model, messages, stream: true };
        if (body.temperature) body2.temperature = body.temperature;
        if (body.max_tokens) body2.max_tokens = body.max_tokens;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 60_000);
        const resp = await fetch(`${tierModel.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${tierModel.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(body2),
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        if (!resp.ok || !resp.body) {
          await stream.write(`data: ${JSON.stringify({ error: { message: "Upstream error" } })}\n\n`);
          return;
        }
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          await stream.write(decoder.decode(value));
        }
        await stream.write("data: [DONE]\n\n");
      } catch (e: any) {
        await stream.write(`data: ${JSON.stringify({ error: { message: String(e.message || e) } })}\n\n`);
        await stream.write("data: [DONE]\n\n");
      }
    });
  }

  try {
    if (strategy?.isReliable && !hasTools) {
      modelUsed = strategy.model;
      if (strategy.committee && withinBudget()) {
        const { text } = await runCommittee(messages);
        usedCommittee = true;
        recordOutcome(rs.taskType, userInput, modelUsed, true, text, rs.tier, hasTools, stream);
        return c.json(makeResponse(text, modelUsed));
      } else {
        const text = await runSingle(config.models[strategy.model], messages, body, stream, rs.tier);
        recordOutcome(rs.taskType, userInput, modelUsed, false, text, rs.tier, hasTools, stream);
        return c.json(makeResponse(text, modelUsed));
      }
    }

    if (trigger && withinBudget() && !hasTools) {
      const { text } = await runCommittee(messages);
      usedCommittee = true;
      modelUsed = config.committee.aggregator;
      recordOutcome(rs.taskType, userInput, modelUsed, true, text, rs.tier, hasTools, stream);
      return c.json(makeResponse(text, modelUsed));
    }

    const tierModel = config.models[config.tiers[rs.tier] || "cheap"];
    modelUsed = tierModel.name;
    let resultText = await runSingle(tierModel, messages, body, stream, rs.tier);

    // Judge escalation for borderline cases (C1-C2), skip C3 (too slow)
    if (!hasTools && !stream && rs.tier !== "C3" && rs.committeeScore > 0.3 && rs.committeeScore < config.committee.triggerThreshold && withinBudget()) {
      const j = await judge(userInput, resultText, config.models[config.judgeModel], config.judgeConfidenceThreshold);
      if (j.shouldEscalate) {
        const { text } = await runCommittee(messages);
        resultText = text;
        usedCommittee = true;
        modelUsed = config.committee.aggregator;
      }
    }

    requestSuccess = !!(resultText && (typeof resultText === "string" ? resultText.trim() : true));
    recordOutcome(rs.taskType, userInput, modelUsed, usedCommittee, resultText, rs.tier, hasTools, stream);

    return c.json(makeResponse(resultText, modelUsed));
  } catch (e: any) {
    // Record failure
    experience?.record(rs.taskType, userInput, modelUsed || "unknown", usedCommittee, false);
    return c.json({ error: { message: String(e), type: "internal_error" } }, 500);
  }
});

// ─── Helpers ───
async function runSingle(model: ModelConfig, messages: any[], body: any, stream: boolean, tier: string): Promise<string | any> {
  messages = applyAdaptivePrompt(messages, tier);
  if (stream) {
    // Collect streaming output (used when Judge check is needed)
    return chatStream(model, messages, { temperature: body.temperature, maxTokens: body.max_tokens });
  }
  messages = applyCacheControl(messages, model);
  if (body.tools) return chatRaw(model, body);
  const extra: any = {};
  if (tier >= "C2" && !body.tools) extra.reasoning_effort = "high";
  else if (tier === "C1") extra.reasoning_effort = "low";
  const resp = await chat(model, messages, { temperature: body.temperature, maxTokens: body.max_tokens || model.maxTokens, extra: Object.keys(extra).length ? extra : undefined });
  return resp.content;
}

async function runCommittee(messages: any[]) {
  moaCountToday++;
  const members = config!.committee.members.map((n) => config!.models[n]);
  const aggregator = config!.models[config!.committee.aggregator];
  return executeCommittee(messages, members, aggregator, config!.committee.referenceMaxTokens);
}

function withinBudget(): boolean {
  const today = new Date().toDateString();
  if (today !== moaCountDate) { moaCountToday = 0; moaCountDate = today; }
  return moaCountToday < config!.moaMaxPerDay;
}

function makeResponse(content: string | any, model: string) {
  if (typeof content === "object") return content;
  return { id: `chatcmpl-${Date.now()}`, object: "chat.completion", model, choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } };
}

function applyAdaptivePrompt(messages: any[], tier: string): any[] {
  const prompts: Record<string, string> = {
    C0: "You are a helpful assistant. Answer concisely.",
    C1: "You are a helpful assistant. Provide clear, accurate answers.",
    C2: "You are an expert assistant. Provide thorough analysis with clear reasoning.",
    C3: "You are an expert assistant handling a high-stakes task. Provide comprehensive analysis with explicit risk assessment. Flag uncertainties clearly.",
  };
  const idx = messages.findIndex((m) => m.role === "system");
  const prompt = prompts[tier] || prompts.C1;
  if (idx >= 0) {
    if (typeof messages[idx].content === "string" && !messages[idx].content.includes("adaptive")) messages[idx].content = `${prompt}\n\n${messages[idx].content}`;
  } else {
    messages.unshift({ role: "system", content: prompt });
  }
  return messages;
}

// ─── Async quality scoring (fire-and-forget, does not block user response) ───
function recordOutcome(
  taskType: string, input: string, model: string, committee: boolean,
  result: string | any, tier: string, hasTools: boolean, stream: boolean
) {
  const success = !!(result && (typeof result === "string" ? result.trim() : true));
  const resultStr = typeof result === "string" ? result : "";

  // For non-trivial requests (C1-C3): run Judge in background for real quality scoring
  if (!hasTools && !stream && tier !== "C0" && success && config) {
    setImmediate(async () => {
      try {
        const j = await judge(input, resultStr, config!.models[config!.judgeModel], config!.judgeConfidenceThreshold);
        const quality = j.confidence;
        experience?.record(taskType, input, model, committee, quality >= 0.6, quality);
        if (memory && quality >= 0.5) {
          try { await memory.storeConversation(input, resultStr, taskType); } catch {}
        }
      } catch {
        // Judge failed: record with basic success
        experience?.record(taskType, input, model, committee, success, 0.5);
        if (memory && success) {
          try { await memory.storeConversation(input, resultStr, taskType); } catch {}
        }
      }
    });
  } else {
    // C0 chitchat or tool/stream: just record basic success
    experience?.record(taskType, input, model, committee, success);
    const mem = memory;
    if (mem && !hasTools && !stream && success) {
      setImmediate(async () => {
        try { await mem.storeConversation(input, resultStr, taskType); } catch {}
      });
    }
  }
}

// ─── Stats endpoints ───
app.get("/health", (c) => c.json({ status: "ok", models: config ? Object.keys(config.models) : [] }));
app.get("/stats", (c) => c.json(experience?.getStats() || { totalDecisions: 0 }));
app.get("/memory", (c) => c.json(memory?.getStats() || { totalMemories: 0 }));
app.get("/v1/models", (c) => c.json({ object: "list", data: [{ id: "auto", object: "model" }, ...(config ? Object.keys(config.models).map((n) => ({ id: n, object: "model" })) : [])] }));

// Flywheel data export
app.get("/flywheel/stats", (c) => c.json(flywheel?.getStats() || { totalSamples: 0 }));
app.get("/flywheel/export", (c) => {
  const format = c.req.query("format") || "jsonl";
  const outPath = join(homedir(), ".opti-moa", `flywheel-export.${format === "csv" ? "csv" : "jsonl"}`);
  const count = format === "csv" ? flywheel?.exportCsv(outPath) : flywheel?.exportJsonl(outPath);
  return c.json({ exported: count || 0, path: outPath });
});

// ─── Entry point ───
export async function main() {
  const configPath = findConfig();
  if (!configPath) {
    const { runSetup } = await import("./setup.js");
    const path = await runSetup();
    init(path);
  } else {
    init(configPath);
  }
  serve({ fetch: app.fetch, port: config?.port || 8080, hostname: config?.host || "127.0.0.1" });
}


