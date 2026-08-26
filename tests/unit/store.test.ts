import { afterEach, describe, expect, it, vi } from "vitest";
import { Store, initialState } from "../../src/game/store";
import { bindAutosave, loadSave } from "../../src/game/save";

const chapterDone = {
  1: true,
  2: false,
  3: true,
  4: false,
  5: true,
  6: false,
} as const;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("Store", () => {
  it("starts at chapter 1, unbooted, all chapters undone", () => {
    const state = initialState();

    expect(state.chapter).toBe(1);
    expect(state.booted).toBe(false);
    expect(state.chapterDone).toEqual({
      1: false,
      2: false,
      3: false,
      4: false,
      5: false,
      6: false,
    });
    expect(state.power).toEqual({
      life_support: 0,
      comms: 0,
      drive: 0,
      sensors: 0,
      lights: 0,
      heaters: 0,
    });
    expect(state.flags).toEqual({ "drive.purged": false });
  });

  it("update mutates and notifies subscribers once per update", () => {
    const store = new Store(initialState());
    const subscriber = vi.fn();
    store.subscribe(subscriber);

    store.update((state) => {
      state.booted = true;
      state.power.drive = 14;
    });

    expect(store.get().booted).toBe(true);
    expect(store.get().power.drive).toBe(14);
    expect(subscriber).toHaveBeenCalledTimes(1);
    expect(subscriber).toHaveBeenLastCalledWith(store.get());
  });

  it("unsubscribe stops notifications", () => {
    const store = new Store(initialState());
    const subscriber = vi.fn();
    const unsubscribe = store.subscribe(subscriber);
    unsubscribe();

    store.update((state) => {
      state.booted = true;
    });

    expect(subscriber).toHaveBeenCalledTimes(0);
  });
});

describe("timings", () => {
  it("selects the complete shorter duration contract when fast mode is enabled", async () => {
    vi.stubGlobal("location", { search: "?fast=1" });
    const { FAST, T } = await import("../../src/game/timings");

    expect(FAST).toBe(true);
    expect(T).toEqual({
      mainsWindowMs: 2_000,
      fuseSeatMs: 150,
      powerStableMs: 800,
      lockHoldMs: 500,
      replyDelayMs: 500,
      armWindowMs: 4_000,
      holdMs: 600,
      burnCountdownMs: 20_000,
      advanceDelayMs: 200,
    });
  });

  it("selects normal durations without the fast query parameter", async () => {
    vi.stubGlobal("location", { search: "" });
    const { FAST, T } = await import("../../src/game/timings");

    expect(FAST).toBe(false);
    expect(T.mainsWindowMs).toBe(5_000);
    expect(T.burnCountdownMs).toBe(90_000);
  });
});

describe("save", () => {
  it("loads a valid save and autosaves only chapter progress", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    const store = new Store(initialState());
    bindAutosave(store);

    store.update((state) => {
      state.chapter = 4;
      state.chapterDone = { ...chapterDone };
      state.booted = true;
      state.power.drive = 14;
      state.flags.signal = "received";
    });

    expect(JSON.parse(values.get("halcyon.save.v1") ?? "")).toEqual({
      chapter: 4,
      chapterDone,
    });
    expect(loadSave()).toEqual({ chapter: 4, chapterDone });
  });

  it("returns null and does not throw for unavailable or malformed save storage", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => undefined,
    });
    expect(loadSave()).toBeNull();

    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("storage unavailable");
      },
      setItem: () => {
        throw new Error("storage unavailable");
      },
    });
    expect(loadSave()).toBeNull();

    vi.stubGlobal("localStorage", {
      getItem: () => "{not json",
      setItem: () => undefined,
    });
    expect(loadSave()).toBeNull();

    vi.stubGlobal("localStorage", {
      getItem: () => JSON.stringify({ chapter: 7, chapterDone: {} }),
      setItem: () => undefined,
    });
    expect(loadSave()).toBeNull();

    const store = new Store(initialState());
    bindAutosave(store);
    expect(() =>
      store.update((state) => {
        state.chapter = 2;
      }),
    ).not.toThrow();
  });
});
