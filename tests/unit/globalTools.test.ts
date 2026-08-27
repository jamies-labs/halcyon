import { describe, expect, it, vi } from "vitest";
import { globalTools, OBJECTIVES } from "../../src/game/globalTools";
import { ch1 } from "../../src/game/chapters/ch1_contact";
import type { ChapterCtx } from "../../src/game/chapters/types";
import { seedForChapter, selectChapter } from "../../src/ui/chapterSelect";
import { initialState, Store } from "../../src/game/store";
import type { Speaker } from "../../src/ui/speaker";

describe("chapter seed and global tools", () => {
  it("keeps saved campaign progress unlocked while revisiting an older chapter", () => {
    const store = new Store(initialState());
    store.update((state) => {
      state.chapter = 3;
      state.campaignChapter = 3;
      state.chapterDone = {
        1: true,
        2: true,
        3: false,
        4: false,
        5: false,
        6: false,
      };
    });

    selectChapter(store, 1, false);
    expect(store.get().chapter).toBe(1);
    selectChapter(store, 3, false);
    expect(store.get().chapter).toBe(3);
    selectChapter(store, 4, false);
    expect(store.get().chapter).toBe(3);
    expect(store.get().campaignChapter).toBe(3);
  });

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

  it("publishes the crew protocol in every global tool description and boot briefing", async () => {
    const store = new Store(initialState());
    const speaker = { say: vi.fn() } as unknown as Speaker;
    const tools = globalTools(store, speaker);
    const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));

    for (const name of ["get_ship_state", "broadcast", "read_boot_briefing"]) {
      const description = toolsByName.get(name)?.description;
      expect(
        description,
        `${name} must identify HALCYON's tool role`,
      ).toContain("HALCYON");
      expect(
        description,
        `${name} must identify the crew's physical role`,
      ).toContain("crew");
    }

    const handshake = ch1
      .tools({} as ChapterCtx)
      .find((tool) => tool.name === "boot_handshake");
    expect(
      handshake,
      "boot_handshake must be available in Chapter 1",
    ).toBeDefined();
    expect(
      handshake?.description,
      "boot_handshake must identify HALCYON's tool role",
    ).toContain("HALCYON");
    expect(
      handshake?.description,
      "boot_handshake must identify the crew's physical role",
    ).toContain("crew");

    const briefing = toolsByName.get("read_boot_briefing");
    expect(briefing, "read_boot_briefing must be available").toBeDefined();
    const outcome = await briefing!.execute({});
    expect(outcome).toMatchObject({
      ok: true,
      data: {
        crew_protocol: {
          halcyon_has_no_hands: expect.stringContaining("no hands"),
          physical_controls: expect.stringContaining("crew"),
          announce_needed_action: expect.stringContaining("announce"),
          wait_for_observable_state: expect.stringContaining("observable"),
        },
      },
    });
  });
});
