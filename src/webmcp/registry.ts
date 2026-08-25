import type { InvokeRecord, ToolDef, ToolOutcome } from './types';
import { validateArgs } from './validate';
import type { HostRegistration, HostToolDescriptor, ModelContextHost } from './shim';
export type { HostRegistration, ModelContextHost } from './shim';

interface LiveTool { def: ToolDef; reg: HostRegistration | null }

export class ToolRegistry {
  private live = new Map<string, LiveTool>();
  private lastCall = new Map<string, number>();
  private seq = 0;
  constructor(
    private host: ModelContextHost | null,
    private onRecord: (r: InvokeRecord) => void,
  ) {}

  listTools(): ToolDef[] {
    return [...this.live.values()].map((t) => t.def);
  }

  setTools(defs: ToolDef[]): void {
    const wanted = new Map(defs.map((d) => [d.name, d]));
    for (const [name, tool] of [...this.live]) {
      if (!wanted.has(name)) {
        tool.reg?.abort();
        this.live.delete(name);
      }
    }
    this.addTools(defs);
  }

  addTools(defs: ToolDef[]): void {
    for (const def of defs) {
      if (this.live.has(def.name)) continue;
      const reg = this.host ? this.host.register(this.toHostDescriptor(def)) : null;
      this.live.set(def.name, { def, reg });
    }
  }

  async invoke(name: string, args: unknown, source: 'agent' | 'sim' = 'sim'): Promise<InvokeRecord> {
    const started = performance.now();
    const outcome = await this.run(name, args);
    const record: InvokeRecord = {
      seq: ++this.seq,
      t: Date.now(),
      tool: name,
      args,
      outcome,
      ms: Math.round(performance.now() - started),
      source,
    };
    this.onRecord(record);
    return record;
  }

  private async run(name: string, args: unknown): Promise<ToolOutcome> {
    const tool = this.live.get(name);
    if (!tool)
      return { ok: false, code: 'UNKNOWN_TOOL', detail: `No tool named "${name}" is registered right now.`, hint: 'Tools change as the ship state changes. Call get_ship_state to see the current situation.' };
    const { def } = tool;
    if (def.rateLimitMs) {
      const last = this.lastCall.get(name) ?? -Infinity;
      const elapsed = Date.now() - last;
      if (elapsed < def.rateLimitMs)
        return { ok: false, code: 'RATE_LIMITED', detail: `${name} was called ${elapsed}ms ago.`, hint: 'Slow down and wait for the ship to respond.', retry_after_ms: def.rateLimitMs - elapsed };
    }
    const valid = validateArgs(def.inputSchema, args ?? {});
    if (!valid.ok)
      return { ok: false, code: 'INVALID_ARGS', detail: valid.detail, hint: 'Check the tool inputSchema and correct the arguments.' };
    this.lastCall.set(name, Date.now());
    try {
      return await def.execute((args ?? {}) as Record<string, unknown>);
    } catch (err) {
      return { ok: false, code: 'TOOL_CRASH', detail: String(err), hint: 'That subsystem glitched. Try once more; report it if it repeats.' };
    }
  }

  private toHostDescriptor(def: ToolDef): HostToolDescriptor {
    return {
      name: def.name,
      description: def.description,
      inputSchema: def.inputSchema,
      annotations: def.readOnly ? { readOnlyHint: true } : undefined,
      execute: async (args) => {
        const record = await this.invoke(def.name, args, 'agent');
        return {
          content: [{ type: 'text', text: JSON.stringify(record.outcome) }],
          isError: record.outcome.ok ? undefined : true,
        };
      },
    };
  }
}
