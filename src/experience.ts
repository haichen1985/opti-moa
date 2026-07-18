import Database from "better-sqlite3";
import { createHash } from "crypto";
import { homedir } from "os";
import { join } from "path";
import { mkdirSync } from "fs";

export interface BestStrategy {
  model: string;
  committee: boolean;
  successRate: number;
  avgQuality: number;
  avgCost: number;
  sampleCount: number;
  confidence: number;
  get isReliable(): boolean;
}

export class ExperienceEngine {
  private db: Database.Database;

  constructor(dbPath = "~/.opti-moa/experience.db") {
    const expanded = dbPath.replace("~", homedir());
    mkdirSync(join(expanded, ".."), { recursive: true });
    this.db = new Database(expanded);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS decisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_type TEXT NOT NULL,
        task_hash TEXT NOT NULL,
        model TEXT NOT NULL,
        committee INTEGER NOT NULL,
        success INTEGER NOT NULL,
        quality_score REAL,
        token_cost INTEGER,
        latency_ms INTEGER,
        timestamp TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_task ON decisions(task_type);
      CREATE INDEX IF NOT EXISTS idx_task_model ON decisions(task_type, model, committee);
    `);
  }

  record(
    taskType: string, taskText: string, model: string, committee: boolean,
    success: boolean, qualityScore = 0.8, tokenCost = 0, latencyMs = 0
  ): void {
    const hash = createHash("sha256").update(taskText.slice(0, 1000)).digest("hex").slice(0, 16);
    this.db.prepare(
      `INSERT INTO decisions (task_type, task_hash, model, committee, success, quality_score, token_cost, latency_ms, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(taskType, hash, model, committee ? 1 : 0, success ? 1 : 0, qualityScore, tokenCost, latencyMs, new Date().toISOString());
  }

  lookup(taskType: string): BestStrategy | null {
    const row = this.db.prepare(
      `SELECT model, committee, AVG(success) as sr, AVG(quality_score) as qs, AVG(token_cost) as ac, COUNT(*) as sc
       FROM decisions WHERE task_type = ? GROUP BY model, committee
       ORDER BY qs DESC, sr DESC, ac ASC LIMIT 1`
    ).get(taskType) as any;
    if (!row) return null;
    const confidence = (row.sr || 0) * Math.min(row.sc / 10, 1);
    return {
      model: row.model,
      committee: Boolean(row.committee),
      successRate: row.sr || 0,
      avgQuality: row.qs || 0,
      avgCost: row.ac || 0,
      sampleCount: row.sc,
      confidence,
      get isReliable() { return this.sampleCount >= 3 && this.successRate >= 0.85 && this.avgQuality >= 0.7; },
    };
  }

  getStats(): any {
    const total = (this.db.prepare("SELECT COUNT(*) as c FROM decisions").get() as any).c;
    const moa = (this.db.prepare("SELECT COUNT(*) as c FROM decisions WHERE committee = 1").get() as any).c;
    const avgQ = (this.db.prepare("SELECT AVG(quality_score) as q FROM decisions WHERE quality_score IS NOT NULL").get() as any).q;
    const byTask = this.db.prepare(
      "SELECT task_type as t, COUNT(*) as c, AVG(success) as sr, AVG(quality_score) as qs FROM decisions GROUP BY task_type ORDER BY c DESC"
    ).all() as any[];
    return {
      totalDecisions: total,
      moaInvocations: moa,
      avgQuality: avgQ ? Number(avgQ.toFixed(3)) : 0,
      byTask: byTask.map((r) => ({ task: r.t, count: r.c, successRate: r.sr, avgQuality: r.qs ? Number(r.qs.toFixed(3)) : null })),
    };
  }

  /** Flywheel: export decision data for offline analysis */
  getFlywheelStats(): any {
    const total = (this.db.prepare("SELECT COUNT(*) as c FROM decisions").get() as any).c;
    const moa = (this.db.prepare("SELECT COUNT(*) as c FROM decisions WHERE committee = 1").get() as any).c;
    const byModel = this.db.prepare(
      "SELECT model as m, COUNT(*) as c, AVG(success) as sr, AVG(quality_score) as qs FROM decisions GROUP BY model ORDER BY c DESC"
    ).all() as any[];
    return {
      totalSamples: total, mlReady: total >= 100, moaInvocations: moa,
      modelDistribution: Object.fromEntries(byModel.map((r) => [r.m, { count: r.c, successRate: Number((r.sr || 0).toFixed(3)), avgQuality: r.qs ? Number(r.qs.toFixed(3)) : null }])),
      recommendedAction: total >= 500 ? "Export and train LightGBM router" : total < 100 ? `Need ${100 - total} more samples` : `Need ${500 - total} more for production`,
    };
  }

  exportJsonl(): string {
    const rows = this.db.prepare("SELECT * FROM decisions ORDER BY timestamp").all() as any[];
    return rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
  }

  /** Dynamic committee: get best model combo for a task type from experience */
  getBestMembers(taskType: string, availableModels: string[]): string[] | null {
    const rows = this.db.prepare(
      `SELECT model, AVG(quality_score) as qs, AVG(success) as sr, COUNT(*) as sc
       FROM decisions WHERE task_type = ? AND quality_score IS NOT NULL
       GROUP BY model HAVING sc >= 2 ORDER BY qs DESC, sr DESC`
    ).all(taskType) as any[];
    const good = rows.filter((r) => r.qs >= 0.6 && availableModels.includes(r.model)).map((r) => r.model);
    return good.length >= 2 ? good.slice(0, 3) : null;
  }
}
