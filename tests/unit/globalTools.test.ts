import { describe, expect, it, vi } from "vitest";
import { globalTools, OBJECTIVES } from "../../src/game/globalTools";
import { seedForChapter } from "../../src/ui/chapterSelect";
import { initialState, Store } from "../../src/game/store";
import type { Speaker } from "../../src/ui/speaker";

describe("chapter seed and global tools", () => {
  it("seeds every Chapter 6 prerequisite with distinct power and flag values", () => {
    const store = new Store(initialState());

    seedForChapter(store, 6);

    expect(store.get().chapter).toBe(6);
    expect(store.get().booted).toBe(true);
    expect(store.get().chapterDone).toMatchObject({
      1: true,
      2: true,
      3: true,
      4: true,
      5: true,
      6: false,
    });
    expect(store.get().power).toEqual({
      life_support: 18,
      comms: 8,
      drive: 14,
      sensors: 6,
      lights: 4,
      heaters: 0,
    });
    expect(store.get().flags).toEqual({
      "manifest.flagged": ["s2", "s4", "s5"],
      "power.routed": true,
      "comms.online": true,
      "comms.jump_vector": { x: 0.42, y: -1.07, z: 3.14 },
      "drive.purged": true,
    });
  });

  it("publishes only the planned post-boot tools with read-only state data", async () => {
    const store = new Store(initialState());
    seedForChapter(store, 3);
    const say = vi.fn();
    const speaker = { say } as unknown as Speaker;

    const tools = globalTools(store, speaker);

    expect(tools.map((tool) => tool.name)).toEqual([
      "get_ship_state",
      "broadcast",
      "read_boot_briefing",
    ]);
    const stateTool = tools[0]!;
    expect(stateTool.readOnly).toBe(true);
    expect(stateTool.inputSchema).toEqual({
      type: "object",
      additionalProperties: false,
      properties: {},
    });
    const outcome = await stateTool.execute({});
    expect(outcome).toEqual({
      ok: true,
      data: expect.objectContaining({
        chapter: 3,
        booted: true,
        objective: OBJECTIVES[3],
        manifest_flagged: ["s2", "s4", "s5"],
        power_routed: false,
        comms_online: false,
        jump_vector: null,
        drive_purged: false,
      }),
    });

    const broadcast = tools[1]!;
    const sent = await broadcast.execute({
      message: "Good morning, crew.",
      tone: "dry",
    });
    expect(sent).toEqual({ ok: true, data: { delivered: true } });
    expect(say).toHaveBeenCalledWith("Good morning, crew.", "dry");
  });
});
