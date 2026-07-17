import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { createHash } from "crypto";

interface CanvasNode {
  nodeId: string;
  tool: string;
  preview: string;
  status: string;
  refFile: string | null;
}

export class MermaidCanvas {
  private nodes: CanvasNode[] = [];
  private refsDir: string;

  constructor(refsDir = "~/.lazy-moa/refs") {
    this.refsDir = refsDir.replace("~", homedir());
    mkdirSync(this.refsDir, { recursive: true });
  }

  addToolCall(toolName: string, result: string, status = "done"): string {
    const nodeId = `${toolName}_${String(this.nodes.length).padStart(3, "0")}`;
    const refPath = join(this.refsDir, `${nodeId}.md`);
    writeFileSync(refPath, result, "utf-8");
    this.nodes.push({ nodeId, tool: toolName, preview: this.preview(result, 200), status, refFile: refPath });
    return nodeId;
  }

  addMessage(role: string, content: string, status = "info"): string {
    const nodeId = `${role}_${String(this.nodes.length).padStart(3, "0")}`;
    let refFile: string | null = null;
    if (content.length > 500) {
      refFile = join(this.refsDir, `${nodeId}.md`);
      writeFileSync(refFile, content, "utf-8");
    }
    this.nodes.push({ nodeId, tool: role, preview: this.preview(content, 200), status, refFile });
    return nodeId;
  }

  render(): string {
    if (!this.nodes.length) return "";
    const lines = ["```mermaid", "graph TD"];
    for (const n of this.nodes) {
      const label = `${n.tool}: ${n.preview}`.replace(/\|/g, "/").replace(/\n/g, " ");
      lines.push(`    ${n.nodeId}["${label}"]`);
    }
    for (let i = 0; i < this.nodes.length - 1; i++) {
      lines.push(`    ${this.nodes[i].nodeId} --> ${this.nodes[i + 1].nodeId}`);
    }
    lines.push("```");
    return lines.join("\n");
  }

  getRef(nodeId: string): string | null {
    const { readFileSync, existsSync } = require("fs");
    const p = join(this.refsDir, `${nodeId}.md`);
    return existsSync(p) ? readFileSync(p, "utf-8") : null;
  }

  clear(): void { this.nodes = []; }
  get nodeCount(): number { return this.nodes.length; }

  private preview(text: string, max: number): string {
    const t = text.trim().replace(/\n/g, " ");
    return t.length <= max ? t : t.slice(0, max) + "...";
  }
}

export function buildCanvas(messages: any[]): MermaidCanvas {
  const canvas = new MermaidCanvas();
  for (const msg of messages) {
    const role = msg.role || "unknown";
    const content = msg.content;
    if (role === "tool" && typeof content === "string") {
      canvas.addToolCall(msg.name || "tool", content, "done");
    } else if (role === "assistant" && Array.isArray(content)) {
      for (const block of content) {
        if (block?.type === "tool_use") canvas.addToolCall(block.name || "tool", "[pending]", "pending");
        else if (block?.type === "text" && block.text) canvas.addMessage("assistant", block.text);
      }
    } else if (typeof content === "string" && content) {
      canvas.addMessage(role, content);
    }
  }
  return canvas;
}
