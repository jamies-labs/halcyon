import type { InvokeRecord, ToolDef, ToolOutcome } from "./types";
import { validateArgs } from "./validate";
import type {
  HostRegistration,
  HostToolDescriptor,
  ModelContextHost,
} from "./shim";

export type { HostRegistration, ModelContextHost } from "./shim";

interface LiveTool {
  def: ToolDef;
  registration: HostRegistration | null;
}

export class ToolRegistry {
  private readonly live = new Map<string, LiveTool>();
  private readonly lastCall = new Map<string, number>();
  private readonly listeners = new Set<(tools: ToolDef[]) => void>();
  private seq = 0;

  constructor(
    private readonly host: ModelContextHost | null,
    private readonly onRecord: (record: InvokeRecord) => void,
  ) {}

  listTools(): ToolDef[] {
    return [...this.live.values()].map(({ def }) => def);
  }

  subscribe(listener: (tools: ToolDef[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setTools(definitions: ToolDef[]): void {
    const desired = new Set(definitions.map(({ name }) => name));
    let changed = false;
    for (const [name, tool] of this.live) {
      if (!desired.has(name)) {
        tool.registration?.abort();
        this.live.delete(name);
        this.lastCall.delete(name);
        changed = true;
      }
    }
    if (this.add(definitions)) changed = true;
    if (changed) this.publish();
  }

  addTools(definitions: ToolDef[]): void {
    if (this.add(definitions)) this.publish();
  }

  initialRegistrationReady(): Promise<boolean> {
    const registrations = [...this.live.values()].map(
      ({ registration }) => registration,
    );
    if (
      !this.host ||
      registrations.length === 0 ||
      registrations.includes(null)
    ) {
      return Promise.resolve(false);
    }
    return Promise.all(registrations.map((registration) => registration!.ready))
      .then(() => true)
      .catch(() => false);
  }

  private add(definitions: ToolDef[]): boolean {
    let changed = false;
    for (const definition of definitions) {
      if (this.live.has(definition.name)) continue;
      const registration =
        this.host?.register(this.toHostDescriptor(definition)) ?? null;
      this.live.set(definition.name, { def: definition, registration });
      changed = true;
    }
    return changed;
  }

  private publish(): void {
    const tools = this.listTools();
    for (const listener of this.listeners) listener(tools);
  }

  async invoke(
    name: string,
    args: unknown,
    source: "agent" | "sim" = "sim",
  ): Promise<InvokeRecord> {
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
    if (!tool) {
      return {
        ok: false,
        code: "UNKNOWN_TOOL",
        detail: `No tool named "${name}" is registered right now.`,
        hint: "Tools change as the ship state changes. Call get_ship_state to see the current situation.",
      };
    }

    const normalizedArgs = args ?? {};
    const validated = validateArgs(tool.def.inputSchema, normalizedArgs);
    if (!validated.ok) {
      return {
        ok: false,
        code: "INVALID_ARGS",
        detail: validated.detail,
        hint: "Check the tool inputSchema and correct the arguments.",
      };
    }

    const limit = tool.def.rateLimitMs;
    if (limit !== undefined && limit > 0) {
      const previous = this.lastCall.get(name);
      const elapsed = previous === undefined ? Infinity : Date.now() - previous;
      if (elapsed < limit) {
        return {
          ok: false,
          code: "RATE_LIMITED",
          detail: `${name} was called ${elapsed}ms ago.`,
          hint: "Slow down and wait for the ship to respond.",
          retry_after_ms: limit - elapsed,
        };
      }
    }

    this.lastCall.set(name, Date.now());
    try {
      return await tool.def.execute(normalizedArgs as Record<string, unknown>);
    } catch (error) {
      return {
        ok: false,
        code: "TOOL_CRASH",
        detail: String(error),
        hint: "That subsystem glitched. Try once more; report it if it repeats.",
      };
    }
  }

  private toHostDescriptor(definition: ToolDef): HostToolDescriptor {
    return {
      name: definition.name,
      description: definition.description,
      inputSchema: definition.inputSchema,
      annotations: definition.readOnly ? { readOnlyHint: true } : undefined,
      execute: async (args) => {
        const record = await this.invoke(definition.name, args, "agent");
        return {
          content: [{ type: "text", text: JSON.stringify(record.outcome) }],
          isError: record.outcome.ok ? undefined : true,
        };
      },
    };
  }
}
