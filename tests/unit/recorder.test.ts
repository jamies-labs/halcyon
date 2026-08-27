import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Recorder } from "../../src/ui/recorder";
import { Speaker } from "../../src/ui/speaker";
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
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  remove(): void {}
}

function textOf(node: Child): string {
  return typeof node === "string"
    ? node
    : `${node.textContent}${node.children.map(textOf).join("")}`;
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
});
