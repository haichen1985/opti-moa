/** Agent Runtime Protocol (ARP) — Unified Lifecycle Hooks
 *
 * opti-moa acts as a Glue Layer between agent frameworks.
 * Each framework adapter implements these hooks to inject
 * opti-moa's capabilities (routing, memory, compression, experience)
 * without modifying the framework's core code.
 */

export interface LifecycleHooks {
  /** Called before LLM request. Can modify messages (inject memory, compress). */
  before_llm?(messages: any[], context: HookContext): Promise<any[]>;
  /** Called after LLM response. Can record experience, store memory. */
  after_llm?(response: any, context: HookContext): Promise<any>;
  /** Called before tool execution. */
  before_tool?(tool: string, args: any, context: HookContext): Promise<any>;
  /** Called after tool execution. */
  after_tool?(tool: string, result: any, context: HookContext): Promise<any>;
  /** Retrieve relevant memories for a query. */
  memory_retrieve?(query: string, context: HookContext): Promise<string[]>;
  /** Store a conversation turn in memory. */
  memory_store?(input: string, output: string, context: HookContext): Promise<void>;
}

export interface HookContext {
  sessionId?: string;
  taskType?: string;
  tier?: string;
  model?: string;
  optiMoaUrl: string;  // e.g. "http://127.0.0.1:8080"
}

export interface AgentAdapter {
  name: string;
  framework: string;  // "hermes" | "openclaw" | "langgraph" | "crewai"
  version: string;
  hooks: LifecycleHooks;
  /** Generate framework-specific config snippet to connect to opti-moa. */
  generateConfig(optiMoaUrl: string): Record<string, any>;
  /** Validate that the framework is available and compatible. */
  validate(): Promise<boolean>;
}
