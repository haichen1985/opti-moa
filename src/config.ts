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
  const defaults = defaultConfig();

  // Build models manually — don't let snakeToCamel touch model name keys
  const models: Record<string, ModelConfig> = {};
  if (resolved.models) {
    for (const [name, spec] of Object.entries(resolved.models)) {
      const m = spec as any;
      models[name] = {
        name,
        baseUrl: m.base_url || m.baseUrl || "",
        apiKey: m.api_key || m.apiKey || "",
        model: m.model || "",
        supportsCache: m.supports_cache ?? m.supportsCache ?? false,
        maxTokens: m.max_tokens ?? m.maxTokens ?? 8192,
      };
    }
  }

  // Build config with explicit field mapping
  const cfg: AppConfig = {
    ...defaults,
    models,
    tiers: resolved.tiers || defaults.tiers!,
    committee: {
      members: resolved.committee?.members || defaults.committee!.members,
      aggregator: resolved.committee?.aggregator || defaults.committee!.aggregator,
      triggerThreshold: resolved.committee?.trigger_threshold ?? resolved.committee?.triggerThreshold ?? defaults.committee!.triggerThreshold,
      referenceMaxTokens: resolved.committee?.reference_max_tokens ?? resolved.committee?.referenceMaxTokens ?? defaults.committee!.referenceMaxTokens,
      fanoutMode: resolved.committee?.fanout_mode ?? resolved.committee?.fanoutMode ?? defaults.committee!.fanoutMode,
    },
    judgeModel: resolved.judge?.model ?? resolved.judgeModel ?? defaults.judgeModel!,
    judgeConfidenceThreshold: resolved.judge?.confidence_threshold ?? resolved.judge?.confidenceThreshold ?? defaults.judgeConfidenceThreshold!,
    compressor: {
      enabled: resolved.compressor?.enabled ?? defaults.compressor!.enabled,
      toolResultBudget: resolved.compressor?.tool_result_budget ?? resolved.compressor?.toolResultBudget ?? defaults.compressor!.toolResultBudget,
      compressThreshold: resolved.compressor?.compress_threshold ?? resolved.compressor?.compressThreshold ?? defaults.compressor!.compressThreshold,
    },
    experienceDbPath: resolved.experience?.db_path ?? resolved.experienceDbPath ?? defaults.experienceDbPath!,
    dailyBudget: resolved.cost?.daily_budget ?? resolved.cost?.dailyBudget ?? defaults.dailyBudget!,
    moaMaxPerDay: resolved.cost?.moa_max_per_day ?? resolved.cost?.moaMaxPerDay ?? defaults.moaMaxPerDay!,
    host: resolved.server?.host ?? defaults.host!,
    port: resolved.server?.port ?? defaults.port!,
  } as AppConfig;

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
