import Database from "better-sqlite3";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export class FlywheelCollector {
  private dbPath: string;

  constructor(dbPath = "~/.opti-moa/experience.db") {
    this.dbPath = dbPath.replace("~", homedir());
  }

  exportCsv(outputPath: string): number {
    const db = new Database(this.dbPath, { readonly: true });
    const rows = db.prepare("SELECT task_type, model, committee, success, quality_score, token_cost, latency_ms, timestamp FROM decisions ORDER BY timestamp").all() as any[];
    db.close();
    if (!rows.length) return 0;
    const out = outputPath.replace("~", homedir());
    mkdirSync(join(out, ".."), { recursive: true });
    const header = "task_type,model,committee,success,quality_score,token_cost,latency_ms,timestamp\n";
    const body = rows.map((r) => `${r.task_type},${r.model},${r.committee},${r.success},${r.quality_score},${r.token_cost},${r.latency_ms},${r.timestamp}`).join("\n");
    writeFileSync(out, header + body, "utf-8");
    return rows.length;
  }

  exportJsonl(outputPath: string): number {
    const db = new Database(this.dbPath, { readonly: true });
    const rows = db.prepare("SELECT * FROM decisions ORDER BY timestamp").all() as any[];
    db.close();
    if (!rows.length) return 0;
    const out = outputPath.replace("~", homedir());
    mkdirSync(join(out, ".."), { recursive: true });
    writeFileSync(out, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf-8");
    return rows.length;
  }

  getStats(): any {
    const db = new Database(this.dbPath, { readonly: true });
    const total = (db.prepare("SELECT COUNT(*) as c FROM decisions").get() as any).c;
    const moa = (db.prepare("SELECT COUNT(*) as c FROM decisions WHERE committee = 1").get() as any).c;
    const byTask = db.prepare("SELECT task_type as t, COUNT(*) as c, AVG(success) as sr FROM decisions GROUP BY task_type ORDER BY c DESC").all() as any[];
    const byModel = db.prepare("SELECT model as m, COUNT(*) as c, AVG(success) as sr FROM decisions GROUP BY model ORDER BY c DESC").all() as any[];
    db.close();
    return {
      totalSamples: total,
      mlReady: total >= 100,
      moaInvocations: moa,
      taskDistribution: Object.fromEntries(byTask.map((r) => [r.t, r.c])),
      modelDistribution: Object.fromEntries(byModel.map((r) => [r.m, r.c])),
      recommendedAction: total >= 500 ? "Export and train LightGBM router" : total < 100 ? `Need ${100 - total} more samples` : `Need ${500 - total} more for production`,
    };
  }
}
