import Database from "better-sqlite3";
import { createHash } from "crypto";
import { homedir } from "os";
import { join } from "path";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { getEmbeddings } from "./llmClient.js";

export interface MemoryItem {
  id: number;
  layer: string;
  content: string;
  score: number;
  metadata: any;
}

export class SemanticMemory {
  private db: Database.Database;
  private embBaseUrl?: string;
  private embApiKey?: string;

  constructor(dbPath = "~/.opti-moa/memory.db", embBaseUrl?: string, embApiKey?: string) {
    const expanded = dbPath.replace("~", homedir());
    mkdirSync(join(expanded, ".."), { recursive: true });
    this.db = new Database(expanded);
    this.embBaseUrl = embBaseUrl;
    this.embApiKey = embApiKey;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        layer TEXT NOT NULL,
        content TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        embedding TEXT,
        metadata TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_layer ON memories(layer);
    `);
  }

  async store(content: string, layer = "L0", metadata: any = {}): Promise<number> {
    const hash = createHash("sha256").update(content.slice(0, 1000)).digest("hex").slice(0, 16);
    let embedding: string | null = null;
    if (this.embBaseUrl) {
      const emb = await getEmbeddings(this.embBaseUrl, this.embApiKey || "", "text-embedding-3-small", content);
      if (emb) embedding = JSON.stringify(emb);
    }
    const result = this.db.prepare(
      `INSERT INTO memories (layer, content, content_hash, embedding, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(layer, content, hash, embedding, JSON.stringify(metadata), new Date().toISOString());
    return Number(result.lastInsertRowid);
  }

  async recall(query: string, layer?: string, limit = 5): Promise<MemoryItem[]> {
    const queryEmb = this.embBaseUrl ? await getEmbeddings(this.embBaseUrl, this.embApiKey || "", "text-embedding-3-small", query) : null;

    if (queryEmb) {
      const rows = this.db.prepare(
        `SELECT id, layer, content, metadata, embedding FROM memories WHERE embedding IS NOT NULL ${layer ? "AND layer = ?" : ""} ORDER BY created_at DESC LIMIT 200`
      ).all(layer ? [layer] : []) as any[];
      const scored = rows.map((r) => {
        const emb = JSON.parse(r.embedding);
        return { sim: cosineSim(queryEmb, emb), row: r };
      }).sort((a, b) => b.sim - a.sim).slice(0, limit);
      return scored.map((s) => ({ id: s.row.id, layer: s.row.layer, content: s.row.content, score: s.sim, metadata: JSON.parse(s.row.metadata || "{}") }));
    }

    // Fallback: keyword matching
    const rows = this.db.prepare(
      `SELECT id, layer, content, metadata FROM memories ${layer ? "WHERE layer = ?" : ""} ORDER BY created_at DESC LIMIT ?`
    ).all(layer ? [layer, limit * 3] : [limit * 3]) as any[];
    const lower = query.toLowerCase();
    return rows.map((r) => ({
      id: r.id, layer: r.layer, content: r.content, metadata: JSON.parse(r.metadata || "{}"),
      score: lower.split(" ").filter((w) => r.content.toLowerCase().includes(w)).length / Math.max(query.split(" ").length, 1),
    })).filter((r) => r.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
  }

  async storeConversation(userInput: string, output: string, taskType = "general"): Promise<void> {
    await this.store(`User: ${userInput}\nAssistant: ${output}`, "L0", { taskType, type: "conversation" });
    const summary = output.slice(0, 200).trim();
    if (summary) await this.store(`[${taskType}] ${summary}`, "L1", { taskType, type: "fact" });
  }

  getStats(): any {
    const total = (this.db.prepare("SELECT COUNT(*) as c FROM memories").get() as any).c;
    const byLayer = this.db.prepare("SELECT layer, COUNT(*) as c FROM memories GROUP BY layer").all() as any[];
    return { totalMemories: total, byLayer: Object.fromEntries(byLayer.map((r) => [r.layer, r.c])) };
  }
}

function cosineSim(a: number[], b: number[]): number {
  if (a.length !== b.length || !a.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] ** 2; nb += b[i] ** 2; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
