import { describe, expect, it, vi } from "vitest";
import { CHAPTERS } from "../../src/game/chapters";
import type { ChapterCtx } from "../../src/game/chapters/types";
import { initialState, Store } from "../../src/game/store";
import { T } from "../../src/game/timings";
import { ToolRegistry } from "../../src/webmcp/registry";
import type { AudioEngine } from "../../src/audio/engine";
import type { Recorder } from "../../src/ui/recorder";
import type { Speaker } from "../../src/ui/speaker";

function chapterContext(): ChapterCtx {
  return {
    isSimulatorSession: false,
    store: new Store(initialState()),
    registry: new ToolRegistry(null, vi.fn()),
    audio: { alarm: vi.fn(), click: vi.fn() } as unknown as AudioEngine,
    speaker: { say: vi.fn() } as unknown as Speaker,
    recorder: { addHuman: vi.fn() } as unknown as Recorder,
    stage: {} as HTMLElement,
    complete: vi.fn(),
  };
}

describe("Chapter 3 Power", () => {
  it("registers schema-routed power tools with staged brownout coaching", async () => {
    const chapter = CHAPTERS[3];
    expect(
      chapter,
      "Chapter 3 must be registered in the production router",
    ).toBeDefined();

    const context = chapterContext();
    const tools = chapter!.tools(context);
    const telemetry = tools.find(
      (tool) => tool.name === "read_power_telemetry",
    );
    const route = tools.find((tool) => tool.name === "route_power");
    expect(telemetry?.readOnly).toBe(true);
    expect(telemetry?.description).toBe(
      "HALCYON reads the current draw and 60A total budget. Next, HALCYON alone calls route_power with an allocations array of subsystem/amps objects; the crew never routes power and physically seats every fuse shown only after a route is accepted. Required subsystem minimums are taught one at a time by structured BROWNOUT results.",
    );
    expect(route?.description).toBe(
      "HALCYON alone allocates power within the 60A budget. Submit allocations as an array of unique objects with subsystem (life_support, comms, drive, sensors, lights, or heaters) and integer amps from 0 to 40. Omitted subsystems receive 0A. Follow each BROWNOUT minimum in order; after acceptance, ask the crew to seat every physical fuse shown, one at a time. Re-routing pops and resets the full fuse set.",
    );
    expect(await telemetry!.execute({})).toEqual({
      ok: true,
      data: {
        budget_amps: 60,
        draw: {
          life_support: 0,
          comms: 0,
          drive: 0,
          sensors: 0,
          lights: 0,
          heaters: 0,
        },
        routed: false,
      },
    });

    const duplicate = await route!.execute({
      allocations: [
        { subsystem: "lights", amps: 4 },
        { subsystem: "lights", amps: 5 },
      ],
    });
    expect(duplicate).toMatchObject({ ok: false, code: "DUPLICATE_SUBSYSTEM" });

    const overBudget = await route!.execute({
      allocations: [
        { subsystem: "life_support", amps: 40 },
        { subsystem: "drive", amps: 40 },
      ],
    });
    expect(overBudget).toMatchObject({
      ok: false,
      code: "OVER_BUDGET",
      detail: "Requested 80A of a 60A budget.",
    });

    for (const [allocations, subsystem, amps] of [
      [[{ subsystem: "drive", amps: 10 }], "life_support", 18],
      [
        [
          { subsystem: "life_support", amps: 18 },
          { subsystem: "drive", amps: 10 },
        ],
        "comms",
        8,
      ],
      [
        [
          { subsystem: "life_support", amps: 18 },
          { subsystem: "comms", amps: 8 },
          { subsystem: "drive", amps: 10 },
        ],
        "sensors",
        6,
      ],
      [
        [
          { subsystem: "life_support", amps: 18 },
          { subsystem: "comms", amps: 8 },
          { subsystem: "sensors", amps: 6 },
          { subsystem: "drive", amps: 10 },
        ],
        "lights",
        4,
      ],
      [
        [
          { subsystem: "life_support", amps: 18 },
          { subsystem: "comms", amps: 8 },
          { subsystem: "sensors", amps: 6 },
          { subsystem: "lights", amps: 4 },
        ],
        "drive",
        14,
      ],
    ] as const) {
      const brownout = await route!.execute({ allocations });
      expect(
        brownout,
        `${subsystem} must be the only next minimum exposed by the route`,
      ).toMatchObject({
        ok: false,
        code: "BROWNOUT",
        detail: expect.stringContaining(
          `${subsystem} browns out below ${amps}A`,
        ),
      });
    }

    expect((T as Record<string, unknown>).fuseSeatMs).toBe(1_000);
  });
});
