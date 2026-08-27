import { afterEach, describe, expect, it, vi } from "vitest";
import type { AudioEngine } from "../../src/audio/engine";
import { FLAGS, type ChapterCtx } from "../../src/game/chapters/types";
import { initialState, Store } from "../../src/game/store";
import type { Speaker } from "../../src/ui/speaker";
import { Recorder } from "../../src/ui/recorder";
import { ToolRegistry } from "../../src/webmcp/registry";

type Listener = (event: Event) => void;

class FakeElement {
  readonly children: Array<FakeElement | string> = [];
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, Listener[]>();
  readonly classList = {
    add: vi.fn(),
    remove: vi.fn(),
    toggle: vi.fn(),
  };
  readonly style = { setProperty: vi.fn() };
  textContent = "";

  append(...children: Array<FakeElement | string>): void {
    this.children.push(...children);
  }

  replaceChildren(...children: Array<FakeElement | string>): void {
    this.children.splice(0, this.children.length, ...children);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

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

  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? [])
      listener({} as Event);
  }
}

function textOf(node: FakeElement | string): string {
  if (typeof node === "string") return node;
  return `${node.textContent}${node.children.map(textOf).join("")}`;
}

function findByTestId(
  node: FakeElement,
  testId: string,
): FakeElement | undefined {
  if (node.attributes.get("data-testid") === testId) return node;
  for (const child of node.children) {
    if (typeof child === "string") continue;
    const found = findByTestId(child, testId);
    if (found) return found;
  }
  return undefined;
}

function contextFor(
  isSimulatorSession: boolean,
  stage: HTMLElement,
): ChapterCtx {
  const recorder = new Recorder();
  const registry = new ToolRegistry(null, (record) => recorder.record(record));
  const store = new Store(initialState());
  store.update((state) => {
    state.flags[FLAGS.jumpVector] = { x: 0.42, y: -1.07, z: 3.14 };
    state.flags[FLAGS.drivePurged] = true;
    state.flags[FLAGS.powerRouted] = true;
  });
  return {
    isSimulatorSession,
    store,
    registry,
    audio: {
      alarm: vi.fn(),
      chime: vi.fn(),
      click: vi.fn(),
      startMetronome: vi.fn(() => vi.fn()),
    } as unknown as AudioEngine,
    speaker: { say: vi.fn() } as unknown as Speaker,
    recorder,
    stage,
    complete: vi.fn(),
  };
}

describe("Chapter 6 training victory", () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;

  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: originalDocument,
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  });

  it("renders a simulator-only marker in the real victory and replay after execute_jump", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    vi.stubGlobal("location", { search: "?fast=1&sim=1" });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        createElement: () => new FakeElement(),
        createTextNode: (text: string) => text,
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

    const { ch6 } = await import("../../src/game/chapters/ch6_burn");
    const stage = new FakeElement();
    const context = contextFor(true, stage as unknown as HTMLElement);
    ch6.mount(context);
    context.registry.setTools(ch6.tools(context));

    const row = stage.children[2] as FakeElement;
    const tap = row.children[0] as FakeElement;
    const leftShutter = row.children[1] as FakeElement;
    const rightShutter = row.children[2] as FakeElement;
    const throttle = row.children[3] as FakeElement;

    await context.registry.invoke("set_jump_vector", {
      x: 0.42,
      y: -1.07,
      z: 3.14,
    });
    await context.registry.invoke("pressurize_injectors", {});
    for (let tapCount = 0; tapCount < 4; tapCount += 1) tap.dispatch("click");
    leftShutter.dispatch("pointerdown");
    rightShutter.dispatch("pointerdown");
    await vi.advanceTimersByTimeAsync(150);
    await context.registry.invoke("ignite_precheck", {});
    throttle.dispatch("pointerdown");
    await vi.advanceTimersByTimeAsync(1_000);
    const jump = await context.registry.invoke("execute_jump", {});
    await vi.advanceTimersByTimeAsync(0);

    const victory = findByTestId(stage, "victory-card");
    const replay = findByTestId(stage, "replay-timeline");
    expect(jump.outcome.ok, "the real final tool must complete the jump").toBe(
      true,
    );
    expect(
      victory,
      "execute_jump must replace Chapter 6 with the victory card",
    ).toBeDefined();
    expect(
      textOf(victory!),
      "a simulator victory must be visibly labelled",
    ).toContain("TRAINING SIMULATION");
    expect(
      findByTestId(stage, "training-simulation-marker"),
      "the visible simulator label must provide the review-capture selector",
    ).toBeDefined();
    expect(
      textOf(replay!),
      "a simulator replay must retain its training label",
    ).toContain("TRAINING SIMULATION");
    expect(
      textOf(replay!),
      "the real registry record must include the final tool",
    ).toContain("execute_jump");
    ch6.unmount();
  });

  it("does not mark an unseeded campaign victory as a training simulation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    vi.stubGlobal("location", { search: "?fast=1" });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        createElement: () => new FakeElement(),
        createTextNode: (text: string) => text,
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

    const { ch6 } = await import("../../src/game/chapters/ch6_burn");
    const stage = new FakeElement();
    const context = contextFor(false, stage as unknown as HTMLElement);
    ch6.mount(context);
    context.registry.setTools(ch6.tools(context));
    const row = stage.children[2] as FakeElement;

    await context.registry.invoke("set_jump_vector", {
      x: 0.42,
      y: -1.07,
      z: 3.14,
    });
    await context.registry.invoke("pressurize_injectors", {});
    for (let tapCount = 0; tapCount < 4; tapCount += 1)
      (row.children[0] as FakeElement).dispatch("click");
    (row.children[1] as FakeElement).dispatch("pointerdown");
    (row.children[2] as FakeElement).dispatch("pointerdown");
    await vi.advanceTimersByTimeAsync(150);
    await context.registry.invoke("ignite_precheck", {});
    (row.children[3] as FakeElement).dispatch("pointerdown");
    await vi.advanceTimersByTimeAsync(1_000);
    await context.registry.invoke("execute_jump", {});
    await vi.advanceTimersByTimeAsync(0);

    const victory = findByTestId(stage, "victory-card");
    expect(
      textOf(victory!),
      "campaign completion must retain its real outcome",
    ).toContain("JUMP COMPLETE");
    expect(
      textOf(victory!),
      "campaign completion must not borrow the training label",
    ).not.toContain("TRAINING SIMULATION");
    ch6.unmount();
  });
});
