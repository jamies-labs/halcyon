import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountRecorderPanel, Recorder } from "../../src/ui/recorder";
import { Speaker } from "../../src/ui/speaker";
import { ToolRegistry } from "../../src/webmcp/registry";
import type { InvokeRecord, ToolDef } from "../../src/webmcp/types";
import { validateArgs } from "../../src/webmcp/validate";

type Child = FakeElement | string;
type Listener = (event: Event) => void;

class FakeElement {
  readonly children: Child[] = [];
  readonly attributes = new Map<string, string>();
  readonly classList = { toggle: vi.fn(), add: vi.fn(), remove: vi.fn() };
  readonly listeners = new Map<string, Listener[]>();
  hidden = false;
  id = "";
  scrollHeight = 0;
  scrollTop = 0;
  value = "";
  private ownText = "";

  constructor(readonly tagName = "div") {}

  get textContent(): string {
    return this.ownText;
  }

  set textContent(value: string) {
    this.ownText = value;
    this.children.splice(0, this.children.length);
  }

  append(...children: Child[]): void {
    this.children.push(...children);
  }

  replaceChildren(...children: Child[]): void {
    this.children.splice(0, this.children.length, ...children);
    if (this.tagName === "select") {
      const firstOption = children.find(
        (child): child is FakeElement =>
          typeof child !== "string" && child.tagName === "option",
      );
      if (firstOption) this.value = firstOption.attributes.get("value") ?? "";
    }
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    if (name === "hidden") this.hidden = true;
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((item) => item !== listener),
    );
  }

  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(new Event(type));
    }
  }

  querySelector(selector: string): FakeElement | null {
    const testId = selector.match(/^\[data-testid=([^\]]+)\]$/)?.[1];
    const className = selector.match(/^\.([\w-]+)$/)?.[1];
    for (const child of this.children) {
      if (typeof child === "string") continue;
      if (
        (testId && child.attributes.get("data-testid") === testId) ||
        (className &&
          child.attributes.get("class")?.split(" ").includes(className))
      ) {
        return child;
      }
      const nested = child.querySelector(selector);
      if (nested) return nested;
    }
    return null;
  }

  insertBefore(node: FakeElement, before: FakeElement | null): void {
    const index = before ? this.children.indexOf(before) : -1;
    if (index < 0) this.children.push(node);
    else this.children.splice(index, 0, node);
  }

  focus(): void {}

  remove(): void {}
}

function textOf(node: Child): string {
  return typeof node === "string"
    ? node
    : `${node.textContent}${node.children.map(textOf).join("")}`;
}

async function settleSimulatorResult(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function openTestConsole(root: FakeElement): void {
  const toggle = root.querySelector("[data-testid=test-console-toggle]");
  expect(toggle, "the optional test console needs an explicit control").not.toBeNull();
  toggle?.dispatch("click");
}

function record(
  outcome: InvokeRecord["outcome"],
  tool = "get_ship_state",
): InvokeRecord {
  return {
    seq: 1,
    t: 1_700_000_000_000,
    tool,
    args: { agent_only: "never render arguments" },
    outcome,
    ms: 12,
    source: "sim",
  };
}

describe("Recorder outcomes", () => {
  const originalDocument = globalThis.document;

  beforeEach(() => {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        createElement: (tag: string) => new FakeElement(tag),
        createTextNode: (text: string) => text,
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: originalDocument,
    });
  });

  it("separates view-only history from lazily rendered test controls", () => {
    const recorder = new Recorder();
    const registry = new ToolRegistry(null, (entry) => recorder.record(entry));
    registry.setTools([
      {
        name: "get_ship_state",
        description: "Read state.",
        inputSchema: { type: "object", properties: {} },
        execute: () => ({ ok: true, data: {} }),
      },
    ]);
    const stage = new FakeElement();
    stage.setAttribute("class", "stage");
    const root = new FakeElement();
    root.append(stage);

    mountRecorderPanel(recorder, registry, root as unknown as HTMLElement);

    const recorderToggle = root.querySelector("[data-testid=recorder-toggle]");
    const recorderPanel = root.querySelector("[data-testid=recorder-panel]");
    const consoleToggle = root.querySelector("[data-testid=test-console-toggle]");
    expect(textOf(recorderToggle!)).toBe(
      "Flight recorder — mission history (optional)",
    );
    expect(textOf(consoleToggle!)).toBe(
      "Test console (optional — not part of normal play)",
    );
    expect(root.querySelector("[data-testid=sim-tool-select]")).toBeNull();
    expect(root.querySelector("[data-testid=sim-args]")).toBeNull();
    expect(root.querySelector("[data-testid=sim-invoke]")).toBeNull();

    recorderToggle?.dispatch("click");
    expect(recorderPanel?.hidden).toBe(false);
    expect(recorderPanel?.querySelector("[data-testid=recorder-log]")).not.toBeNull();
    expect(recorderPanel?.querySelector("[data-testid=sim-tool-select]")).toBeNull();

    consoleToggle?.dispatch("click");
    const select = root.querySelector("[data-testid=sim-tool-select]");
    expect(select).not.toBeNull();
    expect(select?.children).toHaveLength(1);
    registry.addTools([
      {
        name: "dynamic_tool",
        description: "Registered later.",
        inputSchema: { type: "object", properties: {} },
        execute: () => ({ ok: true, data: {} }),
      },
    ]);
    expect(select?.children).toHaveLength(2);
    expect(recorderPanel?.hidden).toBe(false);
  });

  it("renders live flag_section details with a schema-valid example", () => {
    const recorder = new Recorder();
    const registry = new ToolRegistry(null, (entry) => recorder.record(entry));
    const flagSection: ToolDef = {
      name: "flag_section",
      description: "Flag a damaged hull section for crew triage.",
      inputSchema: {
        type: "object",
        required: ["section_id", "priority"],
        additionalProperties: false,
        properties: {
          section_id: { type: "string", enum: ["s1", "s2", "s3"] },
          priority: { type: "integer", minimum: 1, maximum: 3 },
        },
      },
      execute: () => ({ ok: true, data: { section_id: "s2", flagged: true } }),
    };
    registry.setTools([flagSection]);
    const stage = new FakeElement();
    stage.setAttribute("class", "stage");
    const root = new FakeElement();
    root.append(stage);

    mountRecorderPanel(recorder, registry, root as unknown as HTMLElement);
    openTestConsole(root);

    const details = root.querySelector("[data-testid=sim-tool-details]");
    const args = root.querySelector("[data-testid=sim-args]");
    expect(
      details,
      "selected tools need a visible detail panel",
    ).not.toBeNull();
    expect(
      args,
      "the live schema needs an editable JSON example",
    ).not.toBeNull();
    if (!details || !args) return;

    expect(
      textOf(details),
      "details must use the live ToolDef description",
    ).toContain("Flag a damaged hull section for crew triage.");
    expect(
      textOf(details),
      "details must pretty-print the live schema",
    ).toContain('"section_id"');
    expect(
      textOf(details),
      "details must explain the priority contract",
    ).toContain('"priority"');
    expect(
      args.value,
      "flag_section needs its exact valid starter payload",
    ).toBe('{"section_id":"s2","priority":1}');
    for (const historical of [
      '{"section":"S3"}',
      '{"section":"S6"}',
      '{"section":3}',
      '{"section":6}',
    ]) {
      expect(
        textOf(details),
        `the old ${historical} payload needs a visible warning`,
      ).toContain(historical);
    }
  });

  it("generates a validator-accepted example for a required bounded string", () => {
    const recorder = new Recorder();
    const registry = new ToolRegistry(null, (entry) => recorder.record(entry));
    const broadcast: ToolDef = {
      name: "broadcast",
      description: "Send a short crew-facing message.",
      inputSchema: {
        type: "object",
        required: ["message"],
        additionalProperties: false,
        properties: { message: { type: "string", minLength: 1, maxLength: 8 } },
      },
      execute: () => ({ ok: true, data: { delivered: true } }),
    };
    registry.setTools([broadcast]);
    const stage = new FakeElement();
    stage.setAttribute("class", "stage");
    const root = new FakeElement();
    root.append(stage);

    mountRecorderPanel(recorder, registry, root as unknown as HTMLElement);
    openTestConsole(root);

    const args = root.querySelector("[data-testid=sim-args]");
    expect(
      args,
      "a bounded string tool needs a generated example",
    ).not.toBeNull();
    if (!args) return;
    const validated = validateArgs(
      broadcast.inputSchema,
      JSON.parse(args.value),
    );
    expect(
      validated,
      "the displayed example must pass the production validator",
    ).toEqual({
      ok: true,
    });
  });

  it("renders local JSON parsing and registry validation failures as structured results", async () => {
    const recorder = new Recorder();
    const registry = new ToolRegistry(null, (entry) => recorder.record(entry));
    registry.setTools([
      {
        name: "strict_tool",
        description: "Requires a numeric priority.",
        inputSchema: {
          type: "object",
          required: ["priority"],
          additionalProperties: false,
          properties: { priority: { type: "integer", minimum: 1, maximum: 3 } },
        },
        execute: () => ({ ok: true, data: { accepted: true } }),
      },
    ]);
    const stage = new FakeElement();
    stage.setAttribute("class", "stage");
    const root = new FakeElement();
    root.append(stage);
    mountRecorderPanel(recorder, registry, root as unknown as HTMLElement);
    openTestConsole(root);

    const args = root.querySelector("[data-testid=sim-args]");
    const invoke = root.querySelector("[data-testid=sim-invoke]");
    expect(
      args,
      "the simulator needs an editable argument field",
    ).not.toBeNull();
    expect(invoke, "the simulator needs an invoke action").not.toBeNull();
    if (!args || !invoke) return;

    args.value = '{"priority":';
    invoke.dispatch("click");
    let result = root.querySelector("[data-testid=sim-result]");
    expect(
      result,
      "invalid local JSON must render a structured result",
    ).not.toBeNull();
    if (!result) return;
    expect(textOf(result), "invalid JSON must name its result code").toContain(
      "INVALID_JSON",
    );
    expect(
      textOf(result),
      "invalid JSON must state ok=false exactly",
    ).toContain("ok=false");
    expect(textOf(result), "invalid JSON must explain what failed").toContain(
      "detail",
    );
    expect(
      textOf(result),
      "invalid JSON must offer recovery guidance",
    ).toContain("hint");

    args.value = "{}";
    invoke.dispatch("click");
    await settleSimulatorResult();
    result = root.querySelector("[data-testid=sim-result]");
    expect(
      textOf(result!),
      "schema failures must name the registry result",
    ).toContain("INVALID_ARGS");
    expect(
      textOf(result!),
      "schema failures must include validation detail",
    ).toContain("args.priority is required");
    expect(
      textOf(result!),
      "schema failures must retain their recovery hint",
    ).toContain("Check the tool inputSchema and correct the arguments.");
  });

  it("renders outcome guidance, returned data, and live tool replacements without leaking agent-only data", async () => {
    const recorder = new Recorder();
    const registry = new ToolRegistry(null, (entry) => recorder.record(entry));
    registry.setTools([
      {
        name: "boot_handshake",
        description: "Boot only after the crew raises mains.",
        inputSchema: { type: "object", properties: {} },
        execute: () =>
          ({
            ok: false,
            code: "NO_MAINS_POWER",
            detail: "The mains bus is dark.",
            hint: "Ask the crew to throw the breaker.",
            human_action: "Crew raises the physical master breaker.",
            wait_for: "Wait for the breaker to energize mains.",
            state_consequence: "Boot state remains false.",
          }) as unknown as InvokeRecord["outcome"],
      },
    ]);
    const stage = new FakeElement();
    stage.setAttribute("class", "stage");
    const root = new FakeElement();
    root.append(stage);
    mountRecorderPanel(recorder, registry, root as unknown as HTMLElement);
    openTestConsole(root);

    const invoke = root.querySelector("[data-testid=sim-invoke]");
    expect(
      invoke,
      "the mounted simulator needs an invoke action",
    ).not.toBeNull();
    if (!invoke) return;
    invoke.dispatch("click");
    await settleSimulatorResult();
    let result = root.querySelector("[data-testid=sim-result]");
    expect(
      result,
      "a tool response needs a visible latest-outcome panel",
    ).not.toBeNull();
    if (!result) return;
    expect(textOf(result), "failure code must remain inspectable").toContain(
      "NO_MAINS_POWER",
    );
    expect(
      textOf(result),
      "human handoff guidance must remain inspectable",
    ).toContain("Crew raises the physical master breaker.");
    expect(textOf(result), "wait guidance must remain inspectable").toContain(
      "Wait for the breaker to energize mains.",
    );
    expect(textOf(result), "unchanged boot state must be explicit").toContain(
      "Boot state remains false.",
    );

    registry.setTools([
      {
        name: "flag_section",
        description: "Flag the damaged section.",
        inputSchema: {
          type: "object",
          required: ["section_id", "priority"],
          properties: {
            section_id: { type: "string", enum: ["s1", "s2"] },
            priority: { type: "integer", minimum: 1, maximum: 3 },
          },
        },
        execute: () =>
          ({
            ok: true,
            data: {
              section_id: "s2",
              flagged: true,
              agent_only: { jump_vector: "SECRET_VECTOR" },
              jump_vector: { x: 0.42, y: -1.07, z: 3.14 },
            },
            state_consequence: "Awaiting crew acknowledgement on the deck map.",
          }) as unknown as InvokeRecord["outcome"],
      },
    ]);
    invoke.dispatch("click");
    await settleSimulatorResult();
    result = root.querySelector("[data-testid=sim-result]");
    expect(
      textOf(result!),
      "live registry changes must render the new result",
    ).toContain('"section_id": "s2"');
    expect(
      textOf(result!),
      "successful flags must expose their returned boolean",
    ).toContain('"flagged": true');
    expect(
      textOf(result!),
      "successful flags must state ok=true exactly",
    ).toContain("ok=true");
    expect(textOf(result!), "crew-next state must remain explicit").toContain(
      "Awaiting crew acknowledgement on the deck map.",
    );
    expect(
      textOf(result!),
      "agent-only values must never enter the console",
    ).not.toContain("SECRET_VECTOR");
    expect(
      textOf(result!),
      "tool-only jump vectors must never enter the console",
    ).not.toContain("0.42");
  });

  it("renders complete DOM-safe success and failure outcomes", () => {
    const recorder = new Recorder();
    const log = new FakeElement();
    recorder.attachLog(log as unknown as HTMLElement);

    recorder.record(
      record({
        ok: true,
        data: {
          chapter: 4,
          booted: true,
          agent_only: { jump_vector: "SECRET_VECTOR" },
          notes: ["SECRET_NOTE"],
        },
      }),
    );
    recorder.record(
      record(
        {
          ok: false,
          code: "INVALID_ARGS",
          detail: "args.message is required",
          hint: "Supply a short distress message.",
        },
        "send_distress",
      ),
    );

    const output = textOf(log);
    expect(output, "success must disclose its explicit outcome").toContain(
      "ok=true",
    );
    expect(output, "safe data summary must retain scalar state").toContain(
      "chapter=4",
    );
    expect(output, "failure must disclose its explicit outcome").toContain(
      "ok=false",
    );
    expect(output, "failure must name its recovery code").toContain(
      "INVALID_ARGS",
    );
    expect(output, "failure must retain diagnostic detail").toContain(
      "args.message is required",
    );
    expect(output, "failure must retain its human recovery hint").toContain(
      "Supply a short distress message.",
    );
    expect(
      output,
      "agent-only nested data must not be serialized",
    ).not.toContain("SECRET_VECTOR");
    expect(
      output,
      "agent-only array data must not be serialized",
    ).not.toContain("SECRET_NOTE");
  });

  it("collapses adjacent identical failures in recorder and speaker output", () => {
    const recorder = new Recorder();
    const log = new FakeElement();
    const speakerRoot = new FakeElement();
    const speaker = new Speaker(speakerRoot as unknown as HTMLElement);
    recorder.attachLog(log as unknown as HTMLElement);
    const report = (
      speaker as unknown as { record?: (entry: InvokeRecord) => void }
    ).record;

    expect(
      typeof report,
      "the production speaker must receive invocation failures from the registry",
    ).toBe("function");
    if (!report) return;

    const noReply = record(
      {
        ok: false,
        code: "NO_REPLY_YET",
        detail: "The receiver holds no transmission.",
        hint: "Call send_distress first.",
      },
      "decode_reply",
    );
    const invalid = record(
      {
        ok: false,
        code: "INVALID_ARGS",
        detail: "args.offset_khz must be an integer",
        hint: "Use a whole kHz value.",
      },
      "decode_reply",
    );

    for (const entry of [noReply, noReply, invalid]) {
      recorder.record(entry);
      report.call(speaker, entry);
    }

    const recorderOutput = textOf(log);
    const speakerOutput = textOf(speakerRoot);
    expect(
      recorder.getTimeline().filter((entry) => entry.ok === false).length,
      "two matching failures must occupy one recorder row and a different code another",
    ).toBe(2);
    expect(recorderOutput, "recorder must label the collapsed retry").toContain(
      "retry ×2",
    );
    expect(speakerOutput, "speaker must label the collapsed retry").toContain(
      "retry ×2",
    );
    expect(
      speakerOutput.split("NO_REPLY_YET").length - 1,
      "speaker must show the matching failure once",
    ).toBe(1);
    expect(
      speakerOutput,
      "different failures must start another speaker line",
    ).toContain("INVALID_ARGS");
  });
});
