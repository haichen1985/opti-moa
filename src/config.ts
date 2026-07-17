import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import * as yaml from "js-yaml";

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
    experienceDbPath: "~/.opti-moa/experience.db",
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

// snake_case → camelCase bridge for YAML config
function snakeToCamel(obj: any): any {
  if (Array.isArray(obj)) return obj.map(snakeToCamel);
  if (obj && typeof obj === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(obj)) {
      const key = k.replace(/_./g, (m) => m[1].toUpperCase());
      out[key] = snakeToCamel(v);
    }
    return out;
  }
  return obj;
}

export function loadConfig(path: string): AppConfig {
  const raw = yaml.load(readFileSync(path, "utf-8")) as any;
  const resolved = resolveEnvVars(raw);
  const camel = snakeToCamel(resolved);
  const defaults = defaultConfig();
  const cfg = { ...defaults, ...camel } as AppConfig;
  // Set model name from YAML key + populate missing fields
  if (cfg.models) {
    for (const [name, m] of Object.entries(cfg.models)) {
      m.name = name;
      if (m.supportsCache === undefined) m.supportsCache = false;
      if (m.maxTokens === undefined) m.maxTokens = 8192;
    }
  }
  // Map tier names to model names if not already
  if (cfg.tiers) {
    for (const [tier, modelName] of Object.entries(cfg.tiers)) {
      if (cfg.models && !cfg.models[modelName] && cfg.models[modelName as string]) {
        // already correct
      }
    }
  }
  return cfg;
}

export function findConfig(): string | null {
  const home = homedir();
  const candidates = [
    join(process.cwd(), "config.yaml"),
    join(process.cwd(), "config.yml"),
    join(home, ".opti-moa", "config.yaml"),
    join(home, ".opti-moa", "config.yml"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}
