export type ChapterId = 1 | 2 | 3 | 4 | 5 | 6;

export type ToolOutcome =
  | {
      ok: true;
      data: unknown;
      human_action?: string;
      wait_for?: string;
    }
  | {
      ok: false;
      code: string;
      detail: string;
      hint: string;
      retry_after_ms?: number;
      human_action?: string;
      wait_for?: string;
    };

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnly?: boolean;
  rateLimitMs?: number;
  execute(args: Record<string, unknown>): ToolOutcome | Promise<ToolOutcome>;
}

export interface InvokeRecord {
  seq: number;
  t: number;
  tool: string;
  args: unknown;
  outcome: ToolOutcome;
  ms: number;
  source: "agent" | "sim";
}
