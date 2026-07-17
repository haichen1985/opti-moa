import { score, extractUserInput, isBorderline } from "../src/scorer.js";
import { compressContext, trimToolResults } from "../src/compressor.js";
import { applyCacheControl } from "../src/cacheControl.js";
import type { ModelConfig } from "../src/config.js";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

export function runTests() {
  console.log("Running lazy-moa tests...\n");

  // ── Scorer tests ──
  console.log("Scorer:");
  const simple = score("你好", false);
  assert(simple.tier === "C0", "simple greeting → C0");
  assert(simple.committeeScore < 0.3, "simple greeting → low committee score");

  const code = score("帮我写一个 Python 的 hello world 函数，def hello():", false);
  assert(code.taskType === "coding", "code request → coding task type");
  assert(code.complexity > 0, "code request → non-zero complexity");

  const risky = score("这个架构设计是否合规？投资方案的法律风险分析", false);
  assert(risky.risk > 0, "legal/finance keywords → risk > 0");
  assert(risky.tier === "C3" || risky.committeeScore > 0.3, "high-risk keywords → C3 or high score");

  const multiView = score("React 还是 Vue？比较优缺点，帮我选择最佳方案", false);
  assert(multiView.multiView > 0, "comparison keywords → multiView > 0");

  const withTools = score("复杂问题需要架构设计", true);
  assert(withTools.committeeScore === 0, "has_tools → committeeScore = 0");

  const borderline = score("帮我分析一下这个方案", false);
  assert(typeof isBorderline(borderline) === "boolean", "isBorderline returns boolean");

  // ── extractUserInput tests ──
  console.log("\nextractUserInput:");
  const msgs = [
    { role: "system", content: "system prompt" },
    { role: "user", content: "hello world" },
    { role: "assistant", content: "hi" },
    { role: "user", content: "second question" },
  ];
  assert(extractUserInput(msgs) === "second question", "extracts latest user message");

  const multiModal = [{ role: "user", content: [{ type: "text", text: "image question" }] }];
  assert(extractUserInput(multiModal) === "image question", "extracts text from multi-modal");

  // ── Compressor tests ──
  console.log("\nCompressor:");
  const shortMsgs = [{ role: "user", content: "hi" }];
  assert(compressContext(shortMsgs).length === shortMsgs.length, "short context → unchanged");

  const longToolResult = { role: "tool", content: "x".repeat(10000) };
  const trimmed = trimToolResults([longToolResult], 4000);
  assert(trimmed[0].content.length < 10000, "long tool result → trimmed");
  assert(trimmed[0].content.includes("chars omitted"), "trimmed → has omission note");

  const manyMsgs = Array.from({ length: 20 }, (_, i) => ({ role: "user", content: `Message ${i} `.repeat(200) }));
  const compressed = compressContext(manyMsgs, 1000, 4000);
  assert(compressed.length < manyMsgs.length, "long conversation → compressed");

  // ── CacheControl tests ──
  console.log("\nCacheControl:");
  const model: ModelConfig = { name: "test", baseUrl: "", apiKey: "", model: "claude", supportsCache: true, maxTokens: 8192 };
  const cached = applyCacheControl([{ role: "system", content: "hello" }], model);
  assert(Array.isArray(cached[0].content), "cache model → content converted to blocks");
  assert(cached[0].content[0].cache_control?.type === "ephemeral", "cache model → cache_control injected");

  const noCache: ModelConfig = { ...model, supportsCache: false };
  const notCached = applyCacheControl([{ role: "system", content: "hello" }], noCache);
  assert(typeof notCached[0].content === "string", "non-cache model → content unchanged");

  console.log("\n✅ All tests passed!");
}

runTests();
