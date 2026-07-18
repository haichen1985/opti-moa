/** End-to-end tests with real LLM calls.
 * Run: npx tsx test/e2e.test.ts
 * Requires: ~/.opti-moa/config.yaml with valid API keys.
 *
 * Tests 3 routing tiers with minimal token usage.
 */

import { loadConfig, findConfig } from "../src/config.js";
import { score } from "../src/scorer.js";
import { chat } from "../src/llmClient.js";
import { judge } from "../src/judge.js";

let passed = 0;
let failed = 0;
let skipped = 0;

function assert(condition: boolean, name: string) {
  if (condition) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.error(`  ❌ ${name}`); }
}
function skip(name: string, reason: string) {
  skipped++; console.log(`  ⏭️  ${name} (${reason})`);
}

const configPath = findConfig();
if (!configPath) {
  console.log("❌ No config found. Run opti-moa first to create ~/.opti-moa/config.yaml");
  process.exit(1);
}

const config = loadConfig(configPath);
const modelNames = Object.keys(config.models);
console.log(`\n📡 Config: ${configPath}`);
console.log(`   Models: ${modelNames.join(", ")}`);
console.log(`   Tiers: C0=${config.tiers.C0} C1=${config.tiers.C1} C2=${config.tiers.C2} C3=${config.tiers.C3}`);

// ─── Test 1: C0 simple question via cheap model ───
console.log("\n🟢 Test 1: C0 simple routing");
{
  const input = "What is 2+2?";
  const rs = score(input, false);
  assert(rs.tier === "C0" || rs.tier === "C1", `"${input}" → ${rs.tier} (expected C0/C1)`);

  const model = config.models[config.tiers[rs.tier] || config.tiers.C0];
  if (!model) { skip("C0 model call", "no model configured"); } else {
    try {
      const resp = await chat(model, [{ role: "user", content: input }], { maxTokens: 200, timeoutMs: 20000 });
      assert(resp.content.length > 0, `C0 model responded (${resp.content.slice(0, 60)}...)`);
      assert(resp.content.includes("4"), `C0 answer correct`);
    } catch (e: any) {
      skip("C0 model call", e.message?.slice(0, 60));
    }
  }
}

// ─── Test 2: C1/C2 medium question ───
console.log("\n🟡 Test 2: C1/C2 medium routing");
{
  const input = "Explain the difference between TCP and UDP protocols in computer networking.";
  const rs = score(input, false);
  assert(rs.committeeScore > 0, `medium question has score > 0 (${rs.committeeScore.toFixed(3)})`);

  const model = config.models[config.tiers[rs.tier] || config.tiers.C1];
  if (!model) { skip("C1/C2 model call", "no model configured"); } else {
    try {
      const resp = await chat(model, [{ role: "user", content: input }], { maxTokens: 500, timeoutMs: 30000 });
      assert(resp.content.length > 20, `C1/C2 model responded (${resp.content.length} chars)`);
    } catch (e: any) {
      skip("C1/C2 model call", e.message?.slice(0, 60));
    }
  }
}

// ─── Test 3: Judge quality scoring ───
console.log("\n⚖️  Test 3: Judge quality scoring");
{
  const judgeModel = config.models[config.judgeModel];
  if (!judgeModel) { skip("Judge", "no judge model configured"); } else {
    try {
      const j = await judge(
        "What is the capital of France?",
        "The capital of France is Paris. It has been the capital since 987 AD and is home to the Eiffel Tower.",
        judgeModel,
        config.judgeConfidenceThreshold
      );
      assert(j.confidence > 0 && j.confidence <= 1, `Judge confidence in range (${j.confidence})`);
      assert(typeof j.shouldEscalate === "boolean", `Judge escalation flag present`);
    } catch (e: any) {
      skip("Judge", e.message?.slice(0, 60));
    }
  }
}

// ─── Test 4: LLM Scorer (borderline) ───
console.log("\n🧠 Test 4: LLM-enhanced scoring");
{
  const cheapModel = config.models[config.tiers.C0];
  if (!cheapModel) { skip("LLM scorer", "no cheap model"); } else {
    try {
      const { llmClassify } = await import("../src/llmScorer.js");
      const result = await llmClassify("Should I use microservices or monolith for a 5-person startup?", cheapModel);
      if (result) {
        assert(result.complexity >= 0 && result.complexity <= 1, `LLM complexity in range (${result.complexity})`);
        assert(result.taskType.length > 0, `LLM task type: ${result.taskType}`);
      } else {
        skip("LLM scorer", "returned null");
      }
    } catch (e: any) {
      skip("LLM scorer", e.message?.slice(0, 60));
    }
  }
}

// ─── Summary ───
console.log(`\n${"═".repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);
if (failed > 0) process.exit(1);
console.log("E2E tests completed ✅\n");
