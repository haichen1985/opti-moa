import Database from "better-sqlite3";
import { createHash } from "crypto";
import { homedir } from "os";
import { join } from "path";
import { mkdirSync } from "fs";

export interface BestStrategy {
  model: string;
  committee: boolean;
  successRate: number;
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
      `SELECT model, committee, AVG(success) as sr, AVG(token_cost) as ac, COUNT(*) as sc
       FROM decisions WHERE task_type = ? GROUP BY model, committee
       ORDER BY sr DESC, ac ASC LIMIT 1`
    ).get(taskType) as any;
    if (!row) return null;
    const confidence = (row.sr || 0) * Math.min(row.sc / 10, 1);
    return {
      model: row.model,
      committee: Boolean(row.committee),
      successRate: row.sr || 0,
      avgCost: row.ac || 0,
      sampleCount: row.sc,
      confidence,
      get isReliable() { return this.sampleCount >= 3 && this.successRate >= 0.85; },
    };
  }

  getStats(): any {
    const total = (this.db.prepare("SELECT COUNT(*) as c FROM decisions").get() as any).c;
    const moa = (this.db.prepare("SELECT COUNT(*) as c FROM decisions WHERE committee = 1").get() as any).c;
    const byTask = this.db.prepare(
      "SELECT task_type as t, COUNT(*) as c, AVG(success) as sr FROM decisions GROUP BY task_type ORDER BY c DESC"
    ).all() as any[];
    return {
      totalDecisions: total,
      moaInvocations: moa,
      byTask: byTask.map((r) => ({ task: r.t, count: r.c, successRate: r.sr })),
    };
  }
}
