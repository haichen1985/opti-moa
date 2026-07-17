import { select, input, confirm, checkbox } from "@inquirer/prompts";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import * as yaml from "js-yaml";

interface DetectedProvider {
  name: string;
  baseUrl: string;
  envKey: string;
  models: { strong: string; cheap?: string };
}

const PROVIDERS: DetectedProvider[] = [
  { name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", envKey: "DEEPSEEK_API_KEY", models: { strong: "deepseek-reasoner", cheap: "deepseek-chat" } },
  { name: "OpenAI", baseUrl: "https://api.openai.com/v1", envKey: "OPENAI_API_KEY", models: { strong: "gpt-4o", cheap: "gpt-4o-mini" } },
  { name: "Anthropic", baseUrl: "https://api.anthropic.com/v1", envKey: "ANTHROPIC_API_KEY", models: { strong: "claude-sonnet-4-20250514" } },
  { name: "Groq", baseUrl: "https://api.groq.com/openai/v1", envKey: "GROQ_API_KEY", models: { strong: "llama-3.3-70b-versatile", cheap: "llama-3.1-8b-instant" } },
  { name: "SiliconFlow", baseUrl: "https://api.siliconflow.cn/v1", envKey: "SILICONFLOW_API_KEY", models: { strong: "deepseek-ai/DeepSeek-V3", cheap: "Qwen/Qwen2.5-7B-Instruct" } },
  { name: "DashScope (Qwen)", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", envKey: "DASHSCOPE_API_KEY", models: { strong: "qwen-max", cheap: "qwen-turbo" } },
];

async function checkOllama(): Promise<{ models: string[]; port: number } | null> {
  for (const port of [11434, 11435]) {
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/api/tags`);
      if (resp.ok) {
        const data: any = await resp.json();
        const models = (data.models || []).map((m: any) => m.name).filter(Boolean);
        if (models.length) return { models, port };
      }
    } catch {}
  }
  return null;
}

export async function runSetup(): Promise<string> {
  console.log("\n  lazy-moa 初始化配置\n");

  // Auto-detect Ollama
  const ollama = await checkOllama();
  const detected: DetectedProvider[] = PROVIDERS.filter((p) => process.env[p.envKey]);

  const choices: any[] = PROVIDERS.map((p) => ({
    name: `${p.name} ${process.env[p.envKey] ? "(检测到 API Key)" : ""}`,
    value: p.name,
    checked: !!process.env[p.envKey],
  }));
  if (ollama) {
    choices.push({ name: `Ollama (检测到: ${ollama.models.join(", ")})`, value: "Ollama", checked: true });
  }
  choices.push({ name: "自定义端点（其他 OpenAI 兼容 API）", value: "custom", checked: false });

  const selected = await checkbox({ message: "选择你的模型来源（空格选择，回车确认）：", choices });

  const models: Record<string, any> = {};
  const modelNames: string[] = [];
  let cheapModel = "";
  let strongModel = "";

  for (const sel of selected as string[]) {
    if (sel === "Ollama" && ollama) {
      const modelChoice = await select({
        message: "Ollama 用哪个模型作为便宜模型？",
        choices: ollama.models.map((m) => ({ name: m, value: m })),
      });
      models.local = { base_url: `http://127.0.0.1:${ollama.port}/v1`, api_key: "ollama", model: modelChoice, supports_cache: false, max_tokens: 8192 };
      modelNames.push("local");
      if (!cheapModel) cheapModel = "local";
    } else if (sel === "custom") {
      const baseUrl = await input({ message: "API Base URL:" });
      const apiKey = await input({ message: "API Key:" });
      const modelName = await input({ message: "模型名称:" });
      const name = await input({ message: "给这个模型起个名字（如 myapi）:", default: "custom" });
      models[name] = { base_url: baseUrl, api_key: apiKey, model: modelName, supports_cache: false, max_tokens: 8192 };
      modelNames.push(name);
      if (!cheapModel) cheapModel = name;
    } else {
      const provider = PROVIDERS.find((p) => p.name === sel);
      if (!provider) continue;
      const key = await input({ message: `${provider.name} API Key:`, default: process.env[provider.envKey] ? `(使用环境变量 $${provider.envKey})` : "" });
      const apiKey = key.startsWith("(使用") ? `${provider.envKey}` : key;
      const cheapName: string | null = provider.models.cheap ? `${sel.toLowerCase()}_cheap` : null;
      const strongName: string = `${sel.toLowerCase()}_strong`;
      if (provider.models.cheap && cheapName) {
        models[cheapName] = { base_url: provider.baseUrl, api_key: apiKey, model: provider.models.cheap, supports_cache: false, max_tokens: 8192 };
        modelNames.push(cheapName);
        if (!cheapModel) cheapModel = cheapName;
      }
      models[strongName] = { base_url: provider.baseUrl, api_key: apiKey, model: provider.models.strong, supports_cache: sel === "Anthropic", max_tokens: 8192 };
      modelNames.push(strongName);
      if (!strongModel) strongModel = strongName;
      if (!cheapModel && !provider.models.cheap) cheapModel = strongName;
    }
  }

  if (!modelNames.length) {
    console.log("未选择任何模型，退出。");
    process.exit(1);
  }

  // Auto-assign tiers
  const midModel = modelNames.length > 2 ? modelNames[Math.floor(modelNames.length / 2)] : (strongModel || cheapModel);

  const config: any = {
    server: { host: "127.0.0.1", port: 8080 },
    models,
    tiers: { C0: cheapModel, C1: cheapModel, C2: midModel || strongModel || cheapModel, C3: strongModel || modelNames[modelNames.length - 1] },
    committee: {
      members: modelNames,
      aggregator: strongModel || modelNames[modelNames.length - 1],
      trigger_threshold: 0.7,
      reference_max_tokens: 2048,
    },
    judge: { model: cheapModel, confidence_threshold: 0.6 },
    compressor: { enabled: true, tool_result_budget: 4000, compress_threshold: 20000 },
    experience: { db_path: "~/.lazy-moa/experience.db", confidence_threshold: 0.85 },
    cost: { daily_budget: 5.0, moa_max_per_day: 20, on_budget_exceeded: "degrade" },
  };

  const configDir = join(homedir(), ".lazy-moa");
  mkdirSync(configDir, { recursive: true });
  const configPath = join(configDir, "config.yaml");
  writeFileSync(configPath, yaml.dump(config, { indent: 2 }), "utf-8");

  console.log(`\n  ✅ 配置完成！
  便宜模型: ${cheapModel}
  强力模型: ${strongModel || modelNames[modelNames.length - 1]}
  委员会成员: ${modelNames.join(", ")}
  配置文件: ${configPath}\n`);

  const startNow = await confirm({ message: "现在启动 lazy-moa 吗？", default: true });
  if (startNow) {
    return configPath;
  }
  process.exit(0);
}
