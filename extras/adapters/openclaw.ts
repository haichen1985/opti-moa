/** OpenClaw Agent Framework Adapter
 *
 * OpenClaw uses environment variables and provider config.
 * This adapter generates the config snippet and provides
 * lifecycle hooks that route through opti-moa.
 */

import type { AgentAdapter, HookContext } from "./interface.js";

export class OpenClawAdapter implements AgentAdapter {
  name = "opti-moa-openclaw";
  framework = "openclaw";
  version = "0.1.0";

  hooks = {
    async before_llm(messages: any[], ctx: HookContext): Promise<any[]> {
      return messages; // opti-moa proxy handles memory injection server-side
    },

    async after_llm(response: any, ctx: HookContext): Promise<any> {
      return response; // Experience recording happens server-side
    },
  };

  generateConfig(optiMoaUrl: string): Record<string, any> {
    return {
      // Environment variables for OpenClaw
      env: {
        OPENAI_BASE_URL: `${optiMoaUrl}/v1`,
        OPENAI_API_KEY: "none",
        OPENAI_MODEL: "auto",
      },
      // Or config file snippet
      providers: {
        default: {
          type: "openai",
          base_url: `${optiMoaUrl}/v1`,
          api_key: "none",
          model: "auto",
        },
      },
    };
  }

  async validate(): Promise<boolean> {
    // Check if OpenClaw is installed
    try {
      const { execSync } = await import("child_process");
      execSync("which openclaw", { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  }
}
