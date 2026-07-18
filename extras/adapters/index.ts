/** Adapter Registry — discover and manage framework adapters */

export type { AgentAdapter, LifecycleHooks, HookContext } from "./interface.js";
export { HermesAdapter } from "./hermes.js";
export { OpenClawAdapter } from "./openclaw.js";

import type { AgentAdapter } from "./interface.js";
import { HermesAdapter } from "./hermes.js";
import { OpenClawAdapter } from "./openclaw.js";

const adapters: AgentAdapter[] = [new HermesAdapter(), new OpenClawAdapter()];

export function getAdapter(framework: string): AgentAdapter | undefined {
  return adapters.find((a) => a.framework === framework);
}

export function listAdapters(): AgentAdapter[] {
  return adapters;
}

export async function detectFrameworks(): Promise<AgentAdapter[]> {
  const available: AgentAdapter[] = [];
  for (const a of adapters) {
    if (await a.validate()) available.push(a);
  }
  return available;
}
