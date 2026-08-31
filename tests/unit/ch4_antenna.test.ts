import { afterEach, describe, expect, it, vi } from "vitest";
import { ch4 } from "../../src/game/chapters/ch4_antenna";
import type { ChapterCtx } from "../../src/game/chapters/types";
import { initialState, Store } from "../../src/game/store";
import { T } from "../../src/game/timings";
import type { AudioEngine } from "../../src/audio/engine";
import type { Recorder } from "../../src/ui/recorder";
import type { Speaker } from "../../src/ui/speaker";
import { ToolRegistry } from "../../src/webmcp/registry";

type Listener = (event: Event) => void;

class FakeElement {
  readonly children: FakeElement[] = [];
  readonly listeners = new Map<string, Listener[]>();
  readonly attributes = new Map<string, string>();
  readonly style: Record<string, string> = {};
  textContent = "";

  append(...children: FakeElement[]): void {
    this.children.push(...children);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  setPointerCapture(): void {}

  releasePointerCapture(): void {}

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter(
        (current) => current !== listener,
      ),
    );
  }

  dispatch(type: string, event: Event): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function chapterContext(stage: HTMLElement): ChapterCtx {
  return {
    isSimulatorSession: false,
    store: new Store(initialState()),
    registry: new ToolRegistry(null, vi.fn()),
    audio: {
      chime: vi.fn(),
      click: vi.fn(),
      setStatic: vi.fn(),
      stopStatic: vi.fn(),
    } as unknown as AudioEngine,
    speaker: { say: vi.fn() } as unknown as Speaker,
    recorder: { addHuman: vi.fn() } as unknown as Recorder,
    stage,
    complete: vi.fn(),
  };
}

async function mountLockedChapter(): Promise<ChapterCtx> {
  const stage = new FakeElement();
  const context = chapterContext(stage as unknown as HTMLElement);
  ch4.mount(context);
  const knob = stage.children[1]?.children[0];
  expect(knob, "Chapter 4 must mount its crew-only dish control").toBeDefined();

  for (let index = 0; index < 58; index += 1) {
    knob!.dispatch("keydown", {
      key: "ArrowRight",
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent);
  }
  for (let index = 0; index < 14; index += 1) {
    knob!.dispatch("keydown", {
      key: "ArrowUp",
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent);
  }
  await vi.advanceTimersByTimeAsync(T.lockHoldMs + 200);
  return context;
}

describe("Chapter 4 Antenna recovery contracts", () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;

  afterEach(() => {
    ch4.unmount();
    vi.useRealTimers();
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: originalDocument,
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  });

  it("requires a reply before either decoder tool and keeps the hidden target out of registered descriptions", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        createElement: () => new FakeElement(),
        createTextNode: () => new FakeElement(),
      },
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        setInterval: globalThis.setInterval.bind(globalThis),
        clearInterval: globalThis.clearInterval.bind(globalThis),
        setTimeout: globalThis.setTimeout.bind(globalThis),
        clearTimeout: globalThis.clearTimeout.bind(globalThis),
      },
    });

    const context = await mountLockedChapter();
    const descriptions = context.registry
      .listTools()
      .filter((tool) =>
        ["send_distress", "tune_decoder", "decode_reply"].includes(tool.name),
      )
      .map((tool) => tool.description)
      .join(" ");

    expect(descriptions).toContain(
      "send_distress, wait for the reply, tune_decoder, then decode_reply",
    );
    expect(descriptions).not.toContain("-18");
    expect(descriptions).not.toContain("137");
    expect(descriptions).not.toContain("42");

    for (const name of ["tune_decoder", "decode_reply"] as const) {
      const record = await context.registry.invoke(
        name,
        name === "tune_decoder" ? { offset_khz: -50 } : {},
      );
      expect(record.outcome).toMatchObject({
        ok: false,
        code: "NO_REPLY_YET",
        hint: expect.stringContaining("wait"),
      });
    }
  });

  it("returns a result-derived tuning loop that keeps low-quality decode recoverable", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        createElement: () => new FakeElement(),
        createTextNode: () => new FakeElement(),
      },
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        setInterval: globalThis.setInterval.bind(globalThis),
        clearInterval: globalThis.clearInterval.bind(globalThis),
        setTimeout: globalThis.setTimeout.bind(globalThis),
        clearTimeout: globalThis.clearTimeout.bind(globalThis),
      },
    });

    const context = await mountLockedChapter();
    const sent = await context.registry.invoke("send_distress", {
      message: "ISV Halcyon requesting vector home.",
    });
    expect(sent.outcome).toMatchObject({
      ok: true,
      data: {
        next: "Wait for the reply, then call tune_decoder and compare checksum_quality before decode_reply.",
      },
    });

    await vi.advanceTimersByTimeAsync(T.replyDelayMs);
    const tuned = await context.registry.invoke("tune_decoder", {
      offset_khz: -50,
    });
    expect(tuned.outcome).toEqual({
      ok: true,
      data: { offset_khz: -50, checksum_quality: 0.36 },
    });

    const garbled = await context.registry.invoke("decode_reply", {});
    expect(garbled.outcome).toMatchObject({
      ok: true,
      data: {
        checksum_quality: 0.36,
        text: expect.stringMatching(/[#@%&$!?~^*]/),
        hint: expect.stringContaining("another offset_khz"),
      },
    });
    expect(context.store.get().chapterDone[4]).toBe(false);
    expect(context.store.get().flags["comms.jump_vector"]).toBeUndefined();
  });
});
