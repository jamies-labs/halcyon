import { afterEach, describe, expect, it, vi } from "vitest";
import { CHAPTERS } from "../../src/game/chapters";
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
  readonly classList = { toggle: vi.fn() };
  readonly style = { setProperty: vi.fn() };

  append(...children: FakeElement[]): void {
    this.children.push(...children);
  }

  setAttribute(): void {}

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
    store: new Store(initialState()),
    registry: new ToolRegistry(null, vi.fn()),
    audio: { alarm: vi.fn(), chime: vi.fn() } as unknown as AudioEngine,
    speaker: { say: vi.fn() } as unknown as Speaker,
    recorder: { addHuman: vi.fn() } as unknown as Recorder,
    stage,
    complete: vi.fn(),
  };
}

describe("Chapter 5 Two-Man Rule", () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;

  afterEach(() => {
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

  it("requires a fresh full hold after every successful arm", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const windowListeners = new Map<string, Listener[]>();
    const addWindowListener = (type: string, listener: Listener): void => {
      windowListeners.set(type, [
        ...(windowListeners.get(type) ?? []),
        listener,
      ]);
    };
    const removeWindowListener = (type: string, listener: Listener): void => {
      windowListeners.set(
        type,
        (windowListeners.get(type) ?? []).filter(
          (current) => current !== listener,
        ),
      );
    };
    const dispatchWindow = (type: string, event: Event): void => {
      for (const listener of windowListeners.get(type) ?? []) listener(event);
    };

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
        addEventListener: addWindowListener,
        removeEventListener: removeWindowListener,
      },
    });

    const stage = new FakeElement();
    const context = chapterContext(stage as unknown as HTMLElement);
    const chapter = CHAPTERS[5];
    expect(
      chapter,
      "Chapter 5 must be registered in the production router",
    ).toBeDefined();
    chapter!.mount(context);
    const arm = chapter!
      .tools(context)
      .find((tool) => tool.name === "arm_purge");
    const left = stage.children[1]?.children[0];

    expect(left, "the mounted surface must expose the left vent").toBeDefined();
    expect((await arm!.execute({})).ok).toBe(true);
    left!.dispatch("pointerdown", { pointerId: 1 } as PointerEvent);
    dispatchWindow("keydown", {
      code: "Space",
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent);
    await vi.advanceTimersByTimeAsync(100);

    vi.setSystemTime(6_800);
    expect(
      (await arm!.execute({})).ok,
      "re-arming inside the safe band must succeed",
    ).toBe(true);
    await vi.advanceTimersByTimeAsync(T.holdMs - 50);
    expect(
      context.store.get().flags["drive.purged"],
      "hold time from the first window must not carry into the re-armed window",
    ).toBeUndefined();

    await vi.advanceTimersByTimeAsync(100);
    expect(context.store.get().flags["drive.purged"]).toBe(true);
    expect(
      context.complete,
      "the full new hold must complete Chapter 5",
    ).toHaveBeenCalledOnce();
    chapter!.unmount();
  });
});
