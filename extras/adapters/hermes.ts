/** Hermes Agent Framework Adapter
 *
 * Hermes uses custom_providers in ~/.hermes/config.yaml.
 * This adapter generates the config snippet and provides
 * lifecycle hooks that route through opti-moa.
 */

import type { AgentAdapter, HookContext } from "./interface.js";

export class HermesAdapter implements AgentAdapter {
  name = "opti-moa-hermes";
  framework = "hermes";
  version = "0.1.0";

  hooks = {
    async before_llm(messages: any[], ctx: HookContext): Promise<any[]> {
      // Inject relevant memories from opti-moa
      try {
        const resp = await fetch(`${ctx.optiMoaUrl}/memory`, { signal: AbortSignal.timeout(2000) });
        if (resp.ok) {
          const stats = await resp.json() as any;
          if (stats.totalMemories > 0) {
            // Memory recall happens server-side in opti-moa proxy
            // No need to modify messages here — opti-moa handles it
          }
        }
      } catch {}
      return messages;
    },

    async after_llm(response: any, ctx: HookContext): Promise<any> {
      // Experience recording happens server-side in opti-moa proxy
      return response;
    },

    async memory_retrieve(query: string, ctx: HookContext): Promise<string[]> {
      try {
        const resp = await fetch(`${ctx.optiMoaUrl}/v1/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [{ role: "user", content: query }],
            max_tokens: 100,
          }),
          signal: AbortSignal.timeout(5000),
        });
        if (resp.ok) {
          const data = await resp.json() as any;
          return [data.choices?.[0]?.message?.content || ""];
        }
      } catch {}
      return [];
    },
  };

  generateConfig(optiMoaUrl: string): Record<string, any> {
    return {
      // Add to ~/.hermes/config.yaml
      model: {
        default: "auto",
        provider: "custom",
      },
      custom_providers: [
        {
          name: "opti-moa",
          base_url: `${optiMoaUrl}/v1`,
          api_key: "none",
          model: "auto",
        },
      ],
    };
  }

  async validate(): Promise<boolean> {
    try {
      const { existsSync } = await import("fs");
      const { join } = await import("path");
      const { homedir } = await import("os");
      return existsSync(join(homedir(), ".hermes", "config.yaml"));
    } catch {
      return false;
    }
  }
}
