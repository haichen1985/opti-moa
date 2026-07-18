import { select, input, confirm } from "@inquirer/prompts";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import * as yaml from "js-yaml";

const PROVIDERS = [
  { name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", envKey: "DEEPSEEK_API_KEY", strong: "deepseek-reasoner", cheap: "deepseek-chat" },
  { name: "OpenAI", baseUrl: "https://api.openai.com/v1", envKey: "OPENAI_API_KEY", strong: "gpt-4o", cheap: "gpt-4o-mini" },
  { name: "Groq", baseUrl: "https://api.groq.com/openai/v1", envKey: "GROQ_API_KEY", strong: "llama-3.3-70b-versatile", cheap: "llama-3.1-8b-instant" },
  { name: "SiliconFlow", baseUrl: "https://api.siliconflow.cn/v1", envKey: "SILICONFLOW_API_KEY", strong: "deepseek-ai/DeepSeek-V3", cheap: "Qwen/Qwen2.5-7B-Instruct" },
  { name: "自定义端点", baseUrl: "", envKey: "", strong: "", cheap: "" },
];

export async function runSetup(): Promise<string> {
  console.log("\n  opti-moa 初始化配置\n");

  const choices = PROVIDERS.map((p) => ({
    name: `${p.name}${p.envKey && process.env[p.envKey] ? " (检测到 Key)" : ""}`,
    value: p.name,
  }));
  const provider = await select({ message: "选择模型提供商：", choices });
  const p = PROVIDERS.find((x) => x.name === provider)!;

  let baseUrl = p.baseUrl, apiKey = "", strong = p.strong, cheap = p.cheap;
  if (provider === "自定义端点") {
    baseUrl = await input({ message: "API Base URL:" });
    strong = await input({ message: "强力模型名:" });
    cheap = await input({ message: "便宜模型名 (回车=同上):" }) || strong;
  }
  apiKey = await input({ message: "API Key:", default: p.envKey ? process.env[p.envKey] : "" });

  const models: Record<string, any> = {
    strong: { base_url: baseUrl, api_key: apiKey, model: strong, max_tokens: 8192 },
  };
  if (cheap !== strong) models.cheap = { base_url: baseUrl, api_key: apiKey, model: cheap, max_tokens: 8192 };

  const config = {
    server: { host: "127.0.0.1", port: 8080 },
    models,
    tiers: { C0: "cheap", C1: "cheap", C2: "strong", C3: "strong" },
    committee: { members: Object.keys(models), aggregator: "strong", trigger_threshold: 0.7, reference_max_tokens: 2048 },
    judge: { model: "cheap", confidence_threshold: 0.6 },
    compressor: { enabled: true, tool_result_budget: 4000, compress_threshold: 20000 },
    experience: { db_path: "~/.opti-moa/experience.db" },
    cost: { daily_budget: 5.0, moa_max_per_day: 20 },
  };

  const dir = join(homedir(), ".opti-moa");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "config.yaml");
  writeFileSync(path, yaml.dump(config, { indent: 2 }), "utf-8");
  console.log(`\n  ✅ 配置完成: ${path}\n`);

  if (await confirm({ message: "现在启动？", default: true })) return path;
  process.exit(0);
}
