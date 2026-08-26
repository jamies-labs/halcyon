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

  it("starts the Chapter Five drive state as explicitly not purged", () => {
    expect(
      initialState().flags["drive.purged"],
      "a lone handle must leave the observable purge state false, not unset",
    ).toBe(false);
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
    ).toBe(false);

    await vi.advanceTimersByTimeAsync(100);
    expect(context.store.get().flags["drive.purged"]).toBe(true);
    expect(
      context.complete,
      "the full new hold must complete Chapter 5",
    ).toHaveBeenCalledOnce();
    chapter!.unmount();
  });

  it("keeps a later arming window live if an earlier expiry callback is already queued", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    let nextTimerId = 0;
    const queuedExpiry = new Map<number, () => void>();
    const windowListeners = new Map<string, Listener[]>();
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
        setTimeout: (callback: () => void) => {
          const id = ++nextTimerId;
          queuedExpiry.set(id, callback);
          return id;
        },
        // An expiry task that has already reached the event queue cannot be
        // unscheduled. Keep it callable to model that browser boundary.
        clearTimeout: vi.fn(),
        addEventListener: (type: string, listener: Listener) => {
          windowListeners.set(type, [
            ...(windowListeners.get(type) ?? []),
            listener,
          ]);
        },
        removeEventListener: (type: string, listener: Listener) => {
          windowListeners.set(
            type,
            (windowListeners.get(type) ?? []).filter(
              (current) => current !== listener,
            ),
          );
        },
      },
    });

    const stage = new FakeElement();
    const context = chapterContext(stage as unknown as HTMLElement);
    const chapter = CHAPTERS[5]!;
    chapter.mount(context);
    const tools = chapter.tools(context);
    const arm = tools.find((tool) => tool.name === "arm_purge")!;
    const read = tools.find((tool) => tool.name === "read_gauge")!;

    expect((await arm.execute({})).ok).toBe(true);
    const firstExpiry = queuedExpiry.get(1);
    expect(
      firstExpiry,
      "the first arm must schedule an expiry callback",
    ).toBeDefined();

    vi.setSystemTime(6_800);
    expect((await arm.execute({})).ok).toBe(true);
    firstExpiry!();

    const reading = await read.execute({});
    if (!reading.ok) {
      throw new Error(
        "read_gauge must succeed after the stale expiry callback",
      );
    }
    expect(
      reading.data,
      "an obsolete expiry callback must not disarm the latest window",
    ).toMatchObject({ armed: true });
    chapter.unmount();
  });

  it("silences an already-queued expiry callback after Chapter Five unmounts", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    let nextTimerId = 0;
    const queuedExpiry = new Map<number, () => void>();
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
        setTimeout: (callback: () => void) => {
          const id = ++nextTimerId;
          queuedExpiry.set(id, callback);
          return id;
        },
        clearTimeout: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });

    const firstContext = chapterContext(
      new FakeElement() as unknown as HTMLElement,
    );
    const chapter = CHAPTERS[5]!;
    chapter.mount(firstContext);
    const arm = chapter
      .tools(firstContext)
      .find((tool) => tool.name === "arm_purge")!;

    expect((await arm.execute({})).ok).toBe(true);
    const firstExpiry = queuedExpiry.get(1);
    expect(
      firstExpiry,
      "arming must schedule an expiry callback",
    ).toBeDefined();

    chapter.unmount();
    chapter.mount(chapterContext(new FakeElement() as unknown as HTMLElement));
    firstExpiry!();

    expect(
      firstContext.speaker.say,
      "an expiry queued before unmount must not broadcast into an abandoned chapter",
    ).toHaveBeenCalledTimes(2);
    expect(
      firstContext.recorder.addHuman,
      "an expiry queued before unmount must not append a stale recorder entry",
    ).toHaveBeenCalledTimes(1);
    chapter.unmount();
  });
});
