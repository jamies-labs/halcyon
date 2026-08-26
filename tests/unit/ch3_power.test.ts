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
      "HALCYON reads power telemetry and allocates the route; the crew physically seats popped fuses and holds the bus stable. The report includes the total budget in amps and current draw per subsystem. Minimum requirements per subsystem are not documented — the bus reports a brownout when a route leaves one short.",
    );
    expect(route?.description).toBe(
      "HALCYON allocates amps to subsystems within the 60A budget; the crew physically seats every popped fuse and holds the bus stable. Omitted subsystems get 0A, and re-routing while the crew holds a fuse pops the set again.",
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

    expect((T as Record<string, unknown>).fuseSeatMs).toBe(600);
  });
});
