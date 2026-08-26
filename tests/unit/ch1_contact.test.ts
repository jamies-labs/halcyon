import { describe, expect, it, vi } from "vitest";
import { CHAPTERS } from "../../src/game/chapters";
import type { ChapterCtx } from "../../src/game/chapters/types";
import { ToolRegistry } from "../../src/webmcp/registry";
import { initialState, Store } from "../../src/game/store";
import type { AudioEngine } from "../../src/audio/engine";
import type { Recorder } from "../../src/ui/recorder";
import type { Speaker } from "../../src/ui/speaker";

function chapterContext(): ChapterCtx {
  return {
    store: new Store(initialState()),
    registry: new ToolRegistry(null, vi.fn()),
    audio: { alarm: vi.fn(), chime: vi.fn() } as unknown as AudioEngine,
    speaker: { say: vi.fn() } as unknown as Speaker,
    recorder: { addHuman: vi.fn() } as unknown as Recorder,
    stage: {} as HTMLElement,
    complete: vi.fn(),
  };
}

describe("Chapter 1 Contact", () => {
  it("publishes only the pre-boot briefing and rejects a handshake without mains power", async () => {
    const chapter = CHAPTERS[1];

    expect(
      chapter,
      "Chapter 1 must be registered in the production router",
    ).toBeDefined();
    const context = chapterContext();
    const tools = chapter!.tools(context);
    expect(tools.map((tool) => tool.name)).toEqual([
      "read_boot_briefing",
      "boot_handshake",
    ]);

    const handshake = tools.find((tool) => tool.name === "boot_handshake");
    const outcome = await handshake!.execute({});
    expect(outcome).toMatchObject({ ok: false, code: "NO_MAINS_POWER" });
    expect(context.store.get().booted).toBe(false);
  });
});
