export interface ModelConfig {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  supportsCache: boolean;
  maxTokens: number;
}

export interface CommitteeConfig {
  members: string[];
  aggregator: string;
  triggerThreshold: number;
  referenceMaxTokens: number;
  fanoutMode: "per_iteration" | "user_turn";
}

export interface CompressorConfig {
  enabled: boolean;
  toolResultBudget: number;
  compressThreshold: number;
}

export interface AppConfig {
  models: Record<string, ModelConfig>;
  tiers: Record<string, string>;
  committee: CommitteeConfig;
  judgeModel: string;
  judgeConfidenceThreshold: number;
  compressor: CompressorConfig;
  experienceDbPath: string;
  memoryDbPath: string;
  dailyBudget: number;
  moaMaxPerDay: number;
  host: string;
  port: number;
}

export function defaultConfig(): Partial<AppConfig> {
  return {
    models: {},
    tiers: { C0: "cheap", C1: "cheap", C2: "mid", C3: "strong" },
    committee: {
      members: ["cheap", "mid", "strong"],
      aggregator: "strong",
      triggerThreshold: 0.7,
      referenceMaxTokens: 2048,
      fanoutMode: "per_iteration",
    },
    judgeModel: "cheap",
    judgeConfidenceThreshold: 0.6,
    compressor: { enabled: true, toolResultBudget: 4000, compressThreshold: 20000 },
    experienceDbPath: "~/.lazy-moa/experience.db",
    host: "127.0.0.1",
    port: 8080,
    dailyBudget: 5.0,
    moaMaxPerDay: 20,
  };
}

export function resolveEnvVars(obj: any): any {
  if (typeof obj === "string") {
    return obj.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] ?? `\${${name}}`);
  }
  if (Array.isArray(obj)) return obj.map(resolveEnvVars);
  if (obj && typeof obj === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(obj)) out[k] = resolveEnvVars(v);
    return out;
  }
  return obj;
}

export function loadConfig(path: string): AppConfig {
  const fs = require("fs") as typeof import("fs");
  const yaml = require("js-yaml");
  const raw = yaml.load(fs.readFileSync(path, "utf-8"));
  const resolved = resolveEnvVars(raw);
  const defaults = defaultConfig();
  return { ...defaults, ...resolved } as AppConfig;
}

export function findConfig(): string | null {
  const fs = require("fs") as typeof import("fs");
  const path = require("path") as typeof import("path");
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const candidates = [
    path.join(process.cwd(), "config.yaml"),
    path.join(process.cwd(), "config.yml"),
    path.join(home, ".lazy-moa", "config.yaml"),
    path.join(home, ".lazy-moa", "config.yml"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}
