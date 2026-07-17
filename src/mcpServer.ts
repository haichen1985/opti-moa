/** MCP Server mode — exposes lazy-moa capabilities as MCP tools.
 *
 * Any MCP-compatible agent (Hermes, Claude Code, Cursor) can use lazy-moa
 * as a tool provider instead of (or in addition to) proxy mode.
 *
 * Usage in agent config:
 *   mcp_servers:
 *     lazy-moa:
 *       command: npx
 *       args: [lazy-moa, --mcp]
 */

import { Hono } from "hono";
import { score, extractUserInput } from "./scorer.js";
import { executeCommittee } from "./moa.js";
import { judge } from "./judge.js";
import { chat } from "./llmClient.js";
import type { AppConfig, ModelConfig } from "./config.js";

export function createMcpServer(config: AppConfig) {
  const app = new Hono();

  function getModel(name: string): ModelConfig {
    return config.models[name] || config.models[config.tiers.C0] || Object.values(config.models)[0];
  }

  // MCP-style tool: route — score input and recommend model
  app.post("/route", async (c) => {
    const { input } = await c.req.json<{ input: string }>();
    const rs = score(input, false);
    const model = config.tiers[rs.tier] || "cheap";
    return c.json({
      tier: rs.tier,
      recommended_model: model,
      committee_score: rs.committeeScore,
      task_type: rs.taskType,
      should_committee: rs.committeeScore >= config.committee.triggerThreshold,
    });
  });

  // MCP-style tool: committee — run multi-model committee
  app.post("/committee", async (c) => {
    const { input, members } = await c.req.json<{ input: string; members?: string[] }>();
    const memberModels = (members || config.committee.members).map(getModel);
    const aggregator = getModel(config.committee.aggregator);
    const { text, info } = await executeCommittee(
      [{ role: "user", content: input }], memberModels, aggregator, config.committee.referenceMaxTokens
    );
    return c.json({ answer: text, references: info });
  });

  // MCP-style tool: judge — evaluate answer quality
  app.post("/judge", async (c) => {
    const { question, answer } = await c.req.json<{ question: string; answer: string }>();
    const model = getModel(config.judgeModel);
    const result = await judge(question, answer, model, config.judgeConfidenceThreshold);
    return c.json({
      confidence: result.confidence,
      completeness: result.completeness,
      consistency: result.consistency,
      should_escalate: result.shouldEscalate,
    });
  });

  // MCP-style tool: chat — direct single-model call
  app.post("/chat", async (c) => {
    const { input, model: modelName } = await c.req.json<{ input: string; model?: string }>();
    const model = getModel(modelName || config.tiers.C1);
    const resp = await chat(model, [{ role: "user", content: input }]);
    return c.json({ answer: resp.content, model: model.name, tokens: resp.inputTokens + resp.outputTokens });
  });

  // MCP tool list (for discovery)
  app.get("/tools", (c) => c.json({
    tools: [
      { name: "route", description: "Score input and recommend the best model", input: { input: "string" } },
      { name: "committee", description: "Run multi-model committee for high-risk questions", input: { input: "string", members: "string[]?" } },
      { name: "judge", description: "Evaluate answer quality and recommend escalation", input: { question: "string", answer: "string" } },
      { name: "chat", description: "Direct single-model chat call", input: { input: "string", model: "string?" } },
    ],
  }));

  return app;
}
