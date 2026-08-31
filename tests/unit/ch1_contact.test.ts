import { describe, expect, it, vi } from "vitest";
import { createServer } from "vite";
import { CHAPTERS } from "../../src/game/chapters";
import type { ChapterCtx } from "../../src/game/chapters/types";
import { ToolRegistry } from "../../src/webmcp/registry";
import { initialState, Store } from "../../src/game/store";
import type { AudioEngine } from "../../src/audio/engine";
import type { Recorder } from "../../src/ui/recorder";
import type { Speaker } from "../../src/ui/speaker";

async function loadStyles(): Promise<string> {
  const server = await createServer({
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  try {
    const result = await server.transformRequest("/src/styles.css?raw");
    expect(
      result?.code,
      "Vite must transform the production stylesheet",
    ).toBeTypeOf("string");
    return JSON.parse(
      result!.code.replace(/^export default /, "").trim(),
    ) as string;
  } finally {
    await server.close();
  }
}

function chapterContext(): ChapterCtx {
  return {
    isSimulatorSession: false,
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

  it("keeps the crew handoff beside the physical breaker when the scene has room", async () => {
    const styles = await loadStyles();

    expect(styles).toMatch(
      /@media \(min-width: 48rem\)\s*\{[\s\S]*?\.contact-scene\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/,
    );
  });
});
