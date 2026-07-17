import type { ModelConfig } from "./config.js";
import { chat } from "./llmClient.js";
import type { SemanticMemory } from "./memory.js";

const PERSONA_PROMPT = `Based on these conversation facts, generate a concise user persona (max 300 words):
Communication style, technical level, interests, preferences, recurring patterns.

Facts:
{facts}`;

export async function generatePersona(memory: SemanticMemory, model: ModelConfig, triggerEveryN = 20): Promise<string | null> {
  const rows = (memory as any).db.prepare(
    "SELECT content FROM memories WHERE layer = 'L1' ORDER BY created_at DESC LIMIT ?"
  ).all(triggerEveryN) as any[];
  if (rows.length < 5) return null;
  const facts = rows.map((r) => r.content).join("\n");
  try {
    const resp = await chat(model, [{ role: "user", content: PERSONA_PROMPT.replace("{facts}", facts.slice(0, 4000)) }], { temperature: 0.3, maxTokens: 400 });
    const persona = resp.content.trim();
    if (persona) {
      (memory as any).db.prepare("DELETE FROM memories WHERE layer = 'L3'").run();
      (memory as any).db.prepare(
        "INSERT INTO memories (layer, content, content_hash, metadata, created_at) VALUES ('L3', ?, '', '{}', ?)"
      ).run(persona, new Date().toISOString());
      return persona;
    }
  } catch {}
  return null;
}

const SCENARIO_PROMPT = `Group these facts into 1-3 scenario summaries. One per line, prefixed with [Scenario]:
{facts}`;

export async function generateScenarios(memory: SemanticMemory, model: ModelConfig, triggerEveryN = 10): Promise<void> {
  const rows = (memory as any).db.prepare(
    "SELECT content FROM memories WHERE layer = 'L1' ORDER BY created_at DESC LIMIT ?"
  ).all(triggerEveryN) as any[];
  if (rows.length < 5) return;
  const facts = rows.map((r) => `- ${r.content}`).join("\n");
  try {
    const resp = await chat(model, [{ role: "user", content: SCENARIO_PROMPT.replace("{facts}", facts) }], { temperature: 0.3, maxTokens: 500 });
    for (const line of resp.content.trim().split("\n")) {
      if (line.includes("[Scenario]:")) {
        const scenario = line.split("[Scenario]:")[1]?.trim();
        if (scenario) await memory.store(scenario, "L2", { type: "scenario" });
      }
    }
  } catch {}
}
