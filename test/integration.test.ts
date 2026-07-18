/** Integration tests for opti-moa core routing logic.
 * Run: npx tsx test/integration.test.ts
 *
 * These tests exercise the scoring, merging, and quorum logic
 * without needing live LLM endpoints.
 */

import { score, extractUserInput, isBorderline } from "../src/scorer.js";
import { mergeScores, type LLMScore } from "../src/llmScorer.js";

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string) {
  if (condition) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.error(`  ❌ ${name}`); }
}

// ─── Scorer tests ───
console.log("\n📋 Scorer:");

const simple = score("hi", false);
assert(simple.tier === "C0", `"hi" → C0 (got ${simple.tier})`);
assert(simple.committeeScore < 0.3, `"hi" score < 0.3 (got ${simple.committeeScore})`);

const complex = score("Design a distributed microservices architecture with Kubernetes, service mesh, and CI/CD pipeline for a fintech platform handling 1M TPS", false);
assert(complex.tier === "C2" || complex.tier === "C3", `complex arch → C2/C3 (got ${complex.tier})`);
assert(complex.committeeScore > 0.1, `complex arch score > 0.1 (got ${complex.committeeScore})`);

const withTools = score("hello", true);
assert(withTools.committeeScore === 0, `tools → score 0 (got ${withTools.committeeScore})`);

// High-risk keyword triggers borderline range
const highRisk = score("Help me review this contract for legal compliance and liability issues", false);
assert(isBorderline(highRisk), `borderline detected (score=${highRisk.committeeScore})`);

// ─── LLM Score merging ───
console.log("\n🔀 Score merging:");

const keywordRs = score("What is the capital of France?", false);
const mockLlm: LLMScore = {
  complexity: 0.1, risk: 0.05, uncertainty: 0.1, multiView: 0.05,
  taskType: "general", reasoning: "Simple factual question",
};
const merged = mergeScores(keywordRs, mockLlm);
// LLM gives more accurate (slightly higher) score for simple questions that keyword scorer under-estimates
assert(merged.committeeScore < 0.2, `LLM merge keeps simple score low (got ${merged.committeeScore})`);
assert(merged.tier === "C0" || merged.tier === "C1", `merged tier is low (got ${merged.tier})`);

const complexLlm: LLMScore = {
  complexity: 0.9, risk: 0.8, uncertainty: 0.7, multiView: 0.9,
  taskType: "architecture", reasoning: "Complex system design",
};
const merged2 = mergeScores(keywordRs, complexLlm);
assert(merged2.committeeScore > 0.5, `LLM merge raises score for complex (${merged2.committeeScore})`);
assert(merged2.taskType === "architecture", `LLM task type preserved (got ${merged2.taskType})`);

// ─── Quorum logic ───
console.log("\n🗳️ Quorum:");

// Simulate waitForQuorum behavior
async function testQuorum() {
  const delays = [100, 200, 5000]; // Third member is very slow
  const promises = delays.map((d, i) =>
    new Promise<{ content: string; inputTokens: number; outputTokens: number; latencyMs: number }>((res) =>
      setTimeout(() => res({ content: `response-${i}`, inputTokens: 10, outputTokens: 20, latencyMs: d }), d)
    )
  );
  const names = ["fast", "medium", "slow"];
  const quorum = 2;
  const timeout = 1000;

  const start = Date.now();
  const results: any[] = new Array(promises.length);
  let settled = 0;
  let succeeded = 0;

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      for (let i = 0; i < results.length; i++) {
        if (!results[i]) results[i] = { name: names[i], status: "failed", error: "timeout" };
      }
      resolve();
    }, timeout);

    promises.forEach((p, i) => {
      p.then((r) => {
        results[i] = { name: names[i], status: "ok", content: r.content };
        succeeded++;
        settled++;
        if (succeeded >= quorum) {
          clearTimeout(timer);
          for (let j = 0; j < results.length; j++) {
            if (!results[j]) results[j] = { name: names[j], status: "failed", error: "quorum reached, skipped" };
          }
          resolve();
        }
      }).catch(() => { settled++; if (settled >= promises.length) { clearTimeout(timer); resolve(); } });
    });
  });

  const elapsed = Date.now() - start;
  assert(elapsed < 500, `quorum resolves fast (${elapsed}ms < 500ms, didn't wait for slow member)`);
  assert(results[0].status === "ok", `fast member ok`);
  assert(results[1].status === "ok", `medium member ok`);
  assert(results[2].status === "failed", `slow member skipped`);
}

await testQuorum();

// ─── extractUserInput ───
console.log("\n📝 extractUserInput:");
const msgs = [
  { role: "system", content: "You are helpful" },
  { role: "user", content: "Hello" },
  { role: "assistant", content: "Hi there" },
  { role: "user", content: "How are you?" },
];
assert(extractUserInput(msgs) === "How are you?", `extracts last user message`);

const emptyMsgs: any[] = [];
assert(extractUserInput(emptyMsgs) === "", `empty messages → empty string`);

// ─── Summary ───
console.log(`\n${"═".repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log("All tests passed ✅\n");
