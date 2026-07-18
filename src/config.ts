import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import * as yaml from "js-yaml";

export interface ModelConfig {
  name: string; baseUrl: string; apiKey: string; model: string;
  supportsCache: boolean; maxTokens: number;
}

export interface CommitteeConfig {
  members: string[]; aggregator: string; triggerThreshold: number;
  referenceMaxTokens: number; fanoutMode: "per_iteration" | "user_turn";
}

export interface AppConfig {
  models: Record<string, ModelConfig>;
  tiers: Record<string, string>;
  committee: CommitteeConfig;
  judgeModel: string;
  judgeConfidenceThreshold: number;
  compressor: { enabled: boolean; toolResultBudget: number; compressThreshold: number };
  experienceDbPath: string;
  memoryDbPath: string;
  dailyBudget: number;
  moaMaxPerDay: number;
  host: string;
  port: number;
}

function defaults(): Partial<AppConfig> {
  return {
    tiers: { C0: "cheap", C1: "cheap", C2: "mid", C3: "strong" },
    committee: { members: ["cheap", "mid", "strong"], aggregator: "strong", triggerThreshold: 0.7, referenceMaxTokens: 2048, fanoutMode: "per_iteration" },
    judgeModel: "cheap", judgeConfidenceThreshold: 0.6,
    compressor: { enabled: true, toolResultBudget: 4000, compressThreshold: 20000 },
    experienceDbPath: "~/.opti-moa/experience.db",
    host: "127.0.0.1", port: 8080, dailyBudget: 5.0, moaMaxPerDay: 20,
  };
}

function resolveEnv(obj: any): any {
  if (typeof obj === "string") return obj.replace(/\$\{(\w+)\}/g, (_, n) => process.env[n] ?? `\${${n}}`);
  if (Array.isArray(obj)) return obj.map(resolveEnv);
  if (obj && typeof obj === "object") { const o: any = {}; for (const [k, v] of Object.entries(obj)) o[k] = resolveEnv(v); return o; }
  return obj;
}

export function loadConfig(path: string): AppConfig {
  const raw = resolveEnv(yaml.load(readFileSync(path, "utf-8")));
  const d = defaults();
  const models: Record<string, ModelConfig> = {};
  if (raw.models) {
    for (const [name, s] of Object.entries(raw.models)) {
      const m = s as any;
      models[name] = { name, baseUrl: m.base_url || m.baseUrl || "", apiKey: m.api_key || m.apiKey || "", model: m.model || "", supportsCache: m.supports_cache ?? m.supportsCache ?? false, maxTokens: m.max_tokens ?? m.maxTokens ?? 8192 };
    }
  }
  return {
    ...d, models,
    tiers: raw.tiers || d.tiers!,
    committee: {
      members: raw.committee?.members || d.committee!.members,
      aggregator: raw.committee?.aggregator || d.committee!.aggregator,
      triggerThreshold: raw.committee?.trigger_threshold ?? raw.committee?.triggerThreshold ?? d.committee!.triggerThreshold,
      referenceMaxTokens: raw.committee?.reference_max_tokens ?? raw.committee?.referenceMaxTokens ?? d.committee!.referenceMaxTokens,
      fanoutMode: raw.committee?.fanout_mode ?? raw.committee?.fanoutMode ?? d.committee!.fanoutMode,
    },
    judgeModel: raw.judge?.model ?? raw.judgeModel ?? d.judgeModel!,
    judgeConfidenceThreshold: raw.judge?.confidence_threshold ?? raw.judge?.confidenceThreshold ?? d.judgeConfidenceThreshold!,
    compressor: {
      enabled: raw.compressor?.enabled ?? d.compressor!.enabled,
      toolResultBudget: raw.compressor?.tool_result_budget ?? raw.compressor?.toolResultBudget ?? d.compressor!.toolResultBudget,
      compressThreshold: raw.compressor?.compress_threshold ?? raw.compressor?.compressThreshold ?? d.compressor!.compressThreshold,
    },
    experienceDbPath: raw.experience?.db_path ?? raw.experienceDbPath ?? d.experienceDbPath!,
    dailyBudget: raw.cost?.daily_budget ?? raw.cost?.dailyBudget ?? d.dailyBudget!,
    moaMaxPerDay: raw.cost?.moa_max_per_day ?? raw.cost?.moaMaxPerDay ?? d.moaMaxPerDay!,
    host: raw.server?.host ?? d.host!,
    port: raw.server?.port ?? d.port!,
  } as AppConfig;
}

export function findConfig(): string | null {
  const home = homedir();
  for (const p of [join(process.cwd(), "config.yaml"), join(process.cwd(), "config.yml"), join(home, ".opti-moa", "config.yaml"), join(home, ".opti-moa", "config.yml")]) {
    if (existsSync(p)) return p;
  }
  return null;
}
