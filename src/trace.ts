import { appendFileSync, mkdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

function sanitize(id: string | null): string {
  if (!id) return "unknown-session";
  return id.replace(/[^a-zA-Z0-9\-_.]/g, "_");
}

export class TraceLogger {
  private dir: string;
  enabled: boolean;

  constructor(dir = "~/.opti-moa/traces", enabled = false) {
    this.dir = dir.replace("~", homedir());
    this.enabled = enabled;
    if (enabled) mkdirSync(this.dir, { recursive: true });
  }

  logMoaTurn(sessionId: string | null, userPrompt: string, refs: any[], aggModel: string, aggOutput: string, score: number, reason: string): void {
    if (!this.enabled) return;
    const record = JSON.stringify({
      timestamp: new Date().toISOString(),
      session_id: sessionId || "unknown",
      user_prompt: userPrompt.slice(0, 2000),
      committee_score: score,
      decision_reason: reason,
      references: refs,
      aggregator: { model: aggModel, output: aggOutput.slice(0, 5000) },
      total_input_tokens: refs.reduce((s, r) => s + (r.inputTokens || 0), 0),
      total_output_tokens: refs.reduce((s, r) => s + (r.outputTokens || 0), 0),
    }) + "\n";
    try { appendFileSync(join(this.dir, `${sanitize(sessionId)}.jsonl`), record); } catch {}
  }

  logRouting(sessionId: string | null, userPrompt: string, riskScore: any, decision: string, model: string, expHit: boolean): void {
    if (!this.enabled) return;
    const record = JSON.stringify({
      timestamp: new Date().toISOString(),
      session_id: sessionId || "unknown",
      user_prompt: userPrompt.slice(0, 500),
      risk_score: riskScore,
      decision,
      model_used: model,
      experience_hit: expHit,
    }) + "\n";
    try { appendFileSync(join(this.dir, `${sanitize(sessionId)}.jsonl`), record); } catch {}
  }

  getTraces(sessionId?: string): any[] {
    if (!this.enabled || !existsSync(this.dir)) return [];
    const file = join(this.dir, `${sanitize(sessionId || "")}.jsonl`);
    const files = sessionId ? [file] : Array.from(this.listJsonl());
    const traces: any[] = [];
    for (const f of files) {
      if (!existsSync(f)) continue;
      try {
        for (const line of readFileSync(f, "utf-8").split("\n")) {
          if (line.trim()) traces.push(JSON.parse(line));
        }
      } catch {}
    }
    return traces;
  }

  private *listJsonl(): Generator<string> {
    if (!existsSync(this.dir)) return;
    const { readdirSync } = require("fs");
    for (const f of readdirSync(this.dir) as string[]) {
      if (f.endsWith(".jsonl")) yield join(this.dir, f);
    }
  }
}
