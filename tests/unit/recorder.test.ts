import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountRecorderPanel, Recorder } from "../../src/ui/recorder";
import { Speaker } from "../../src/ui/speaker";
import { ToolRegistry } from "../../src/webmcp/registry";
import type { InvokeRecord } from "../../src/webmcp/types";

type Child = FakeElement | string;
type Listener = (event: Event) => void;

class FakeElement {
  readonly children: Child[] = [];
  readonly attributes = new Map<string, string>();
  readonly classList = { toggle: vi.fn() };
  readonly listeners = new Map<string, Listener[]>();
  hidden = false;
  id = "";
  scrollHeight = 0;
  scrollTop = 0;
  value = "";
  private ownText = "";

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
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    if (name === "hidden") this.hidden = true;
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  insertBefore(node: FakeElement, before: FakeElement | null): void {
    const index = before ? this.children.indexOf(before) : -1;
    if (index === -1) this.children.push(node);
    else this.children.splice(index, 0, node);
  }

  querySelector(selector: string): FakeElement | null {
    if (selector === ".stage")
      return find(this, (node) => node.className === "stage");
    return null;
  }

  get className(): string {
    return this.attributes.get("class") ?? "";
  }

  click(): void {
    for (const listener of this.listeners.get("click") ?? []) {
      listener(new Event("click"));
    }
  }

  remove(): void {}
}

function textOf(node: Child): string {
  return typeof node === "string"
    ? node
    : `${node.textContent}${node.children.map(textOf).join("")}`;
}

function find(
  node: FakeElement,
  predicate: (candidate: FakeElement) => boolean,
): FakeElement | null {
  if (predicate(node)) return node;
  for (const child of node.children) {
    if (typeof child !== "string") {
      const found = find(child, predicate);
      if (found) return found;
    }
  }
  return null;
}

function byTestId(root: FakeElement, testId: string): FakeElement | null {
  return find(root, (node) => node.attributes.get("data-testid") === testId);
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
        createElement: () => new FakeElement(),
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

  it("mounts optional mission history separately from the optional test console", () => {
    const recorder = new Recorder();
    const registry = new ToolRegistry(null, (record) =>
      recorder.record(record),
    );
    registry.setTools([
      {
        name: "get_ship_state",
        description: "Read the ship state.",
        inputSchema: { type: "object", properties: {} },
        execute: async () => ({ ok: true, data: {} }),
      },
    ]);
    const root = new FakeElement();
    root.append(
      Object.assign(new FakeElement(), {
        attributes: new Map([["class", "stage"]]),
      }),
    );

    mountRecorderPanel(recorder, registry, root as unknown as HTMLElement);

    const recorderToggle = byTestId(root, "recorder-toggle");
    const recorderPanel = byTestId(root, "recorder-panel");
    const consoleToggle = byTestId(root, "test-console-toggle");
    const consolePanel = byTestId(root, "test-console-panel");

    expect(
      recorderToggle,
      "normal play must expose the optional history control",
    ).not.toBeNull();
    expect(
      textOf(recorderToggle!),
      "history control must name its view-only purpose",
    ).toBe("Flight recorder — mission history (optional)");
    expect(
      consoleToggle,
      "the simulator must use its own optional control",
    ).not.toBeNull();
    expect(
      textOf(consoleToggle!),
      "console control must not resemble a crew objective",
    ).toBe("Test console (optional — not part of normal play)");

    recorderToggle!.click();
    expect(recorderPanel?.hidden, "history opens from its own control").toBe(
      false,
    );
    expect(
      byTestId(recorderPanel!, "recorder-log"),
      "history retains its timeline",
    ).not.toBeNull();
    expect(
      byTestId(recorderPanel!, "sim-tool-select"),
      "history must not contain a tool selector",
    ).toBeNull();
    expect(
      byTestId(recorderPanel!, "sim-args"),
      "history must not contain JSON arguments",
    ).toBeNull();
    expect(
      byTestId(recorderPanel!, "sim-invoke"),
      "history must not contain an invoke action",
    ).toBeNull();

    consoleToggle!.click();
    expect(
      consolePanel?.hidden,
      "test console opens only when explicitly invoked",
    ).toBe(false);
    expect(
      byTestId(consolePanel!, "sim-tool-select"),
      "console keeps the registered-tool selector",
    ).not.toBeNull();
    expect(
      byTestId(consolePanel!, "sim-args"),
      "console keeps the JSON argument field",
    ).not.toBeNull();
    expect(
      byTestId(consolePanel!, "sim-invoke"),
      "console keeps the invoke action",
    ).not.toBeNull();
    expect(
      recorderPanel?.hidden,
      "opening the console must not hide visible mission history",
    ).toBe(false);
  });
});
