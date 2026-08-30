import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ToolRegistry,
  type HostRegistration,
  type ModelContextHost,
} from "../../src/webmcp/registry";
import {
  detectModelContext,
  type HostToolDescriptor,
} from "../../src/webmcp/shim";
import type { InvokeRecord, ToolDef } from "../../src/webmcp/types";

function makeFakeHost() {
  const registered = new Map<
    string,
    { tool: HostToolDescriptor; aborted: boolean }
  >();
  const host: ModelContextHost = {
    register(tool) {
      const entry = { tool, aborted: false };
      registered.set(tool.name, entry);
      const registration: HostRegistration = {
        abort: () => {
          entry.aborted = true;
          registered.delete(tool.name);
        },
        ready: Promise.resolve(),
      };
      return registration;
    },
  };
  return { host, registered };
}

function okTool(name: string, extra: Partial<ToolDef> = {}): ToolDef {
  return {
    name,
    description: `${name} description`,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
    execute: () => ({ ok: true, data: { name } }),
    ...extra,
  };
}

describe("detectModelContext", () => {
  let documentWithModelContext: { modelContext?: unknown };
  let navigatorWithModelContext: { modelContext?: unknown };

  beforeEach(() => {
    documentWithModelContext = {};
    navigatorWithModelContext = {};
    vi.stubGlobal("document", documentWithModelContext);
    vi.stubGlobal("navigator", navigatorWithModelContext);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("adapts document.modelContext registration and abort cancels it", () => {
    const unregister = vi.fn();
    const registerTool = vi.fn<
      (
        tool: HostToolDescriptor,
        options?: { signal: AbortSignal },
      ) => { unregister: () => void }
    >(() => ({ unregister }));
    documentWithModelContext.modelContext = { registerTool };

    const host = detectModelContext();
    expect(host).not.toBeNull();
    const descriptor = okTool("document-tool");
    host!
      .register({
        ...descriptor,
        execute: async () => ({ content: [{ type: "text", text: "{}" }] }),
      })
      .abort();

    expect(registerTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: "document-tool" }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(registerTool.mock.calls[0]![1]!.signal.aborted).toBe(true);
    expect(unregister).toHaveBeenCalledTimes(1);
  });

  it("rejects legacy navigator.modelContext without a document host", () => {
    const registerTool =
      vi.fn<
        (tool: HostToolDescriptor, options?: { signal: AbortSignal }) => void
      >();
    navigatorWithModelContext.modelContext = { registerTool };

    const host = detectModelContext();
    expect(host).toBeNull();
    expect(registerTool).not.toHaveBeenCalled();
  });

  it("rejects invalid document.modelContext hosts", () => {
    documentWithModelContext.modelContext = { registerTool: true };

    expect(detectModelContext()).toBeNull();
  });
});

describe("ToolRegistry", () => {
  let records: InvokeRecord[];

  beforeEach(() => {
    records = [];
  });

  it("registers new tools, unregisters removed tools, and preserves unchanged registrations", () => {
    const { host, registered } = makeFakeHost();
    const registry = new ToolRegistry(host, (record) => records.push(record));
    registry.setTools([okTool("a"), okTool("b")]);
    const originalA = registered.get("a");
    expect([...registered.keys()].sort()).toEqual(["a", "b"]);

    registry.setTools([okTool("a"), okTool("c")]);

    expect([...registered.keys()].sort()).toEqual(["a", "c"]);
    expect(registered.get("a")).toBe(originalA);
  });

  it("adds a new tool without dropping an existing registration", () => {
    const { host, registered } = makeFakeHost();
    const registry = new ToolRegistry(host, () => {});
    registry.setTools([okTool("a")]);
    registry.addTools([okTool("b")]);

    expect([...registered.keys()].sort()).toEqual(["a", "b"]);
  });

  it("reports initial crew-link readiness only after every initial host registration settles", async () => {
    const registeredNames: string[] = [];
    const register = (ready: Promise<void>) =>
      ({
        abort: () => {},
        ready,
      }) as HostRegistration & { ready: Promise<void> };
    const connected = new ToolRegistry(
      {
        register: (tool) => {
          registeredNames.push(tool.name);
          return register(Promise.resolve());
        },
      },
      () => {},
    );
    connected.setTools([
      okTool("read_boot_briefing"),
      okTool("boot_handshake"),
    ]);

    const readiness = connected as ToolRegistry & {
      initialRegistrationReady(): Promise<boolean>;
    };
    expect(
      typeof readiness.initialRegistrationReady,
      "the gate must wait for the production registry, not merely detect an API object",
    ).toBe("function");
    await expect(readiness.initialRegistrationReady()).resolves.toBe(true);
    expect(registeredNames).toEqual(["read_boot_briefing", "boot_handshake"]);

    const declined = new ToolRegistry(
      {
        register: () =>
          register(Promise.reject(new Error("host declined tool"))),
      },
      () => {},
    );
    declined.setTools([okTool("read_boot_briefing"), okTool("boot_handshake")]);
    const declinedReadiness = declined as ToolRegistry & {
      initialRegistrationReady(): Promise<boolean>;
    };
    await expect(declinedReadiness.initialRegistrationReady()).resolves.toBe(
      false,
    );

    const absent = new ToolRegistry(null, () => {});
    absent.setTools([okTool("read_boot_briefing"), okTool("boot_handshake")]);
    const absentReadiness = absent as ToolRegistry & {
      initialRegistrationReady(): Promise<boolean>;
    };
    await expect(absentReadiness.initialRegistrationReady()).resolves.toBe(
      false,
    );

    const thrown = new ToolRegistry(
      {
        register: () => {
          throw new Error("host registration threw");
        },
      },
      () => {},
    );
    thrown.setTools([okTool("read_boot_briefing"), okTool("boot_handshake")]);
    const thrownReadiness = thrown as ToolRegistry & {
      initialRegistrationReady(): Promise<boolean>;
    };
    await expect(thrownReadiness.initialRegistrationReady()).resolves.toBe(
      false,
    );
  });

  it("publishes complete tool lists for set, add, and removal changes", () => {
    const registry = new ToolRegistry(null, () => {});
    const subscribe = (
      registry as unknown as {
        subscribe?: (listener: (tools: ToolDef[]) => void) => () => void;
      }
    ).subscribe;

    expect(
      typeof subscribe,
      "the mounted simulator needs a registry change subscription",
    ).toBe("function");
    if (!subscribe) return;

    const lists: string[][] = [];
    const unsubscribe = subscribe.call(registry, (tools) =>
      lists.push(tools.map((tool) => tool.name)),
    );
    registry.setTools([okTool("meter")]);
    registry.addTools([okTool("send_distress")]);
    registry.setTools([okTool("send_distress")]);
    unsubscribe();
    registry.addTools([okTool("decode_reply")]);

    expect(lists).toEqual([
      ["meter"],
      ["meter", "send_distress"],
      ["send_distress"],
    ]);
  });

  it("rejects invalid arguments before rate limiting and never executes the tool", async () => {
    const execute = vi.fn(() => ({ ok: true as const, data: "executed" }));
    const registry = new ToolRegistry(null, (record) => records.push(record));
    registry.setTools([
      okTool("strict", {
        inputSchema: {
          type: "object",
          required: ["count"],
          additionalProperties: false,
          properties: { count: { type: "integer" } },
        },
        rateLimitMs: 1_000,
        execute,
      }),
    ]);

    const valid = await registry.invoke("strict", { count: 1 });
    const invalid = await registry.invoke("strict", { wrong: 1 });

    expect(valid.outcome.ok).toBe(true);
    expect(invalid.outcome).toMatchObject({ ok: false, code: "INVALID_ARGS" });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("returns UNKNOWN_TOOL for names that are not live", async () => {
    const registry = new ToolRegistry(null, () => {});
    const record = await registry.invoke("ghost", {});

    expect(record.outcome).toMatchObject({ ok: false, code: "UNKNOWN_TOOL" });
  });

  it("rate-limits repeat calls with a positive retry time", async () => {
    vi.useFakeTimers();
    try {
      const registry = new ToolRegistry(null, () => {});
      registry.setTools([okTool("slow", { rateLimitMs: 1_000 })]);
      const first = await registry.invoke("slow", {});
      const second = await registry.invoke("slow", {});

      expect(first.outcome.ok).toBe(true);
      expect(second.outcome).toMatchObject({ ok: false, code: "RATE_LIMITED" });
      if (!second.outcome.ok)
        expect(second.outcome.retry_after_ms).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("converts execution exceptions to TOOL_CRASH and records monotonic sequence/source values", async () => {
    const registry = new ToolRegistry(null, (record) => records.push(record));
    registry.setTools([
      okTool("safe"),
      okTool("boom", {
        execute: () => {
          throw new Error("kaput");
        },
      }),
    ]);

    const first = await registry.invoke("safe", {}, "sim");
    const second = await registry.invoke("boom", {}, "agent");

    expect(second.outcome).toMatchObject({ ok: false, code: "TOOL_CRASH" });
    expect([first.seq, second.seq]).toEqual([1, 2]);
    expect(records.map((record) => record.source)).toEqual(["sim", "agent"]);
  });

  it("exposes registry results as JSON MCP text and marks errors", async () => {
    const { host, registered } = makeFakeHost();
    const registry = new ToolRegistry(host, () => {});
    registry.setTools([
      okTool("good"),
      okTool("bad", {
        execute: () => ({ ok: false, code: "DENIED", detail: "d", hint: "h" }),
      }),
    ]);

    const success = await registered.get("good")!.tool.execute({});
    const failure = await registered.get("bad")!.tool.execute({});

    expect(JSON.parse(success.content[0]!.text)).toMatchObject({
      ok: true,
      data: { name: "good" },
    });
    expect(success.isError).toBeUndefined();
    expect(JSON.parse(failure.content[0]!.text)).toMatchObject({
      ok: false,
      code: "DENIED",
    });
    expect(failure.isError).toBe(true);
  });

  it("maps read-only tools to the host annotation", () => {
    const { host, registered } = makeFakeHost();
    const registry = new ToolRegistry(host, () => {});
    registry.setTools([okTool("read", { readOnly: true })]);

    expect(registered.get("read")!.tool.annotations).toEqual({
      readOnlyHint: true,
    });
  });
});
