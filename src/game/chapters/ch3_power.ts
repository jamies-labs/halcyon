import { el } from "../../ui/dom";
import type { ToolDef } from "../../webmcp/types";
import type { Subsystem } from "../store";
import { T } from "../timings";
import { FLAGS, type Chapter, type ChapterCtx } from "./types";

const BUDGET_AMPS = 60;
const MINIMUMS: ReadonlyArray<readonly [Subsystem, number]> = [
  ["life_support", 18],
  ["comms", 8],
  ["sensors", 6],
  ["lights", 4],
];
const SUBSYSTEMS: readonly Subsystem[] = [
  "life_support",
  "comms",
  "drive",
  "sensors",
  "lights",
  "heaters",
];

type Allocation = { subsystem: Subsystem; amps: number };

let seated = new Set<Subsystem>();
let pending: Partial<Record<Subsystem, number>> | null = null;
let routeVersion = 0;
let stableTimer: number | null = null;
let fuseTray: HTMLElement | null = null;
let cleanup: Array<() => void> = [];
let holdTimers = new Set<number>();

function clearStableTimer(): void {
  if (stableTimer !== null) {
    window.clearTimeout(stableTimer);
    stableTimer = null;
  }
}

function clearFuseInteractions(): void {
  for (const dispose of cleanup) dispose();
  cleanup = [];
  for (const timer of holdTimers) window.clearTimeout(timer);
  holdTimers = new Set();
}

function clearPendingRoute(): void {
  routeVersion += 1;
  clearStableTimer();
  clearFuseInteractions();
  seated = new Set();
}

function startStability(ctx: ChapterCtx, version: number): void {
  if (stableTimer !== null || version !== routeVersion) return;

  ctx.speaker.say(
    "Crew seated every fuse. HALCYON is holding the bus steady now… do not sneeze.",
    "dry",
  );
  stableTimer = window.setTimeout(() => {
    stableTimer = null;
    if (version !== routeVersion || pending === null) return;
    const routedPower = pending;

    ctx.store.update((state) => {
      for (const subsystem of SUBSYSTEMS) {
        state.power[subsystem] = routedPower[subsystem] ?? 0;
      }
      state.flags[FLAGS.powerRouted] = true;
    });
    ctx.speaker.say(
      "Power grid stable. Life support at full. Breathe easy, crew.",
      "calm",
    );
    ctx.complete();
  }, T.powerStableMs);
}

function renderFuses(ctx: ChapterCtx, version: number): void {
  if (fuseTray === null || pending === null) return;

  fuseTray.replaceChildren();
  const powered = SUBSYSTEMS.filter(
    (subsystem) => (pending![subsystem] ?? 0) > 0,
  );
  for (const subsystem of powered) {
    const fuse = el(
      "button",
      {
        type: "button",
        class: "fuse",
        "data-fuse": subsystem,
        "aria-label": `Hold ${subsystem.replace("_", " ")} fuse until it seats — physical control, crew hands only; HALCYON must ask the crew, not operate it`,
      },
      `${subsystem} ×`,
    );
    let holdTimer: number | null = null;
    const stopHolding = (): void => {
      if (holdTimer === null) return;
      window.clearTimeout(holdTimer);
      holdTimers.delete(holdTimer);
      holdTimer = null;
    };
    const startHolding = (): void => {
      if (
        holdTimer !== null ||
        seated.has(subsystem) ||
        version !== routeVersion
      )
        return;
      holdTimer = window.setTimeout(() => {
        if (holdTimer !== null) holdTimers.delete(holdTimer);
        holdTimer = null;
        if (version !== routeVersion) return;

        seated.add(subsystem);
        fuse.textContent = `${subsystem} ●`;
        fuse.classList.add("fuse-seated");
        ctx.audio.click();
        ctx.recorder.addHuman(`fuse re-seated: ${subsystem}`);
        if (powered.every((id) => seated.has(id))) startStability(ctx, version);
      }, T.fuseSeatMs);
      holdTimers.add(holdTimer);
    };

    fuse.addEventListener("pointerdown", startHolding);
    fuse.addEventListener("pointerup", stopHolding);
    fuse.addEventListener("pointerleave", stopHolding);
    fuse.addEventListener("pointercancel", stopHolding);
    cleanup.push(() => {
      fuse.removeEventListener("pointerdown", startHolding);
      fuse.removeEventListener("pointerup", stopHolding);
      fuse.removeEventListener("pointerleave", stopHolding);
      fuse.removeEventListener("pointercancel", stopHolding);
      stopHolding();
    });
    fuseTray.append(fuse);
  }
}

function allocationFor(
  allocations: Allocation[],
  subsystem: Subsystem,
): number {
  return (
    allocations.find((allocation) => allocation.subsystem === subsystem)
      ?.amps ?? 0
  );
}

export const ch3: Chapter = {
  id: 3,
  title: "Power",
  tools(ctx: ChapterCtx): ToolDef[] {
    return [
      {
        name: "read_power_telemetry",
        description:
          "HALCYON reads the power bus: total budget in amps and current draw per subsystem. HALCYON allocates the route; the crew physically seats popped fuses and holds the bus stable. Minimum requirements per subsystem are not documented — the bus reports a brownout when a route leaves one short.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {},
        },
        readOnly: true,
        execute: () => ({
          ok: true,
          data: {
            budget_amps: BUDGET_AMPS,
            draw: ctx.store.get().power,
            routed: ctx.store.get().flags[FLAGS.powerRouted] === true,
          },
        }),
      },
      {
        name: "route_power",
        description:
          "HALCYON allocates amps to subsystems within the 60A budget; omitted subsystems get 0A. A valid route pops physical fuses that only the crew can seat and hold stable. HALCYON must ask the crew to re-seat every powered fuse; re-routing mid-hold pops them again.",
        inputSchema: {
          type: "object",
          required: ["allocations"],
          additionalProperties: false,
          properties: {
            allocations: {
              type: "array",
              minItems: 1,
              maxItems: 6,
              items: {
                type: "object",
                required: ["subsystem", "amps"],
                additionalProperties: false,
                properties: {
                  subsystem: { type: "string", enum: SUBSYSTEMS },
                  amps: { type: "integer", minimum: 0, maximum: 40 },
                },
              },
            },
          },
        },
        execute: (args) => {
          const allocations = args.allocations as Allocation[];
          const seen = new Set<Subsystem>();
          for (const allocation of allocations) {
            if (seen.has(allocation.subsystem)) {
              return {
                ok: false,
                code: "DUPLICATE_SUBSYSTEM",
                detail: `${allocation.subsystem} appears twice.`,
                hint: "List each subsystem at most once.",
                human_action:
                  "Ask the crew to keep hands clear of the physical fuses until HALCYON has a valid route.",
                wait_for:
                  "Wait for HALCYON to submit a valid non-duplicated allocation before the crew seats any fuse.",
              };
            }
            seen.add(allocation.subsystem);
          }

          const total = allocations.reduce(
            (sum, allocation) => sum + allocation.amps,
            0,
          );
          if (total > BUDGET_AMPS) {
            return {
              ok: false,
              code: "OVER_BUDGET",
              detail: `Requested ${total}A of a ${BUDGET_AMPS}A budget.`,
              hint: "Reduce the total to 60A or less.",
              human_action:
                "Ask the crew to keep hands clear of the physical fuses until HALCYON has a valid route.",
              wait_for:
                "Wait for HALCYON to submit an allocation within the 60A budget before the crew seats any fuse.",
            };
          }

          for (const [subsystem, minimum] of MINIMUMS) {
            const supplied = allocationFor(allocations, subsystem);
            if (supplied < minimum) {
              return {
                ok: false,
                code: "BROWNOUT",
                detail: `${subsystem} browns out below ${minimum}A (got ${supplied}A).`,
                hint: `Give ${subsystem} at least ${minimum}A and route again. Other subsystems may have minimums too.`,
                human_action:
                  "Ask the crew to keep hands clear of the physical fuses until HALCYON has a stable route.",
                wait_for:
                  "Wait for HALCYON to correct the brownout and submit a valid route before the crew seats any fuse.",
              };
            }
          }

          clearPendingRoute();
          pending = Object.fromEntries(
            allocations.map((allocation) => [
              allocation.subsystem,
              allocation.amps,
            ]),
          ) as Partial<Record<Subsystem, number>>;
          renderFuses(ctx, routeVersion);
          ctx.audio.alarm();
          ctx.recorder.addHuman("fuses popped — awaiting re-seat");
          return {
            ok: true,
            human_action:
              "Ask the crew to physically seat every popped powered fuse, holding each until it clicks home.",
            wait_for:
              "Wait until every powered fuse is seated and the bus has held stable before continuing.",
            data: {
              accepted: pending,
              next: "Crew must hold each popped fuse until it clicks, then the bus holds stable.",
            },
          };
        },
      },
    ];
  },
  mount(ctx: ChapterCtx): void {
    clearPendingRoute();
    pending = null;
    fuseTray = el("div", {
      class: "fuse-tray",
      "data-testid": "fuse-tray",
      "aria-label": "Popped power fuses",
    });
    ctx.stage.append(
      el(
        "p",
        { class: "chapter-brief" },
        "The bus tripped everything. HALCYON routes the amps; you hold each popped fuse until it clicks home. If it re-routes, they pop again.",
      ),
      fuseTray,
    );
    ctx.speaker.say(
      "HALCYON routes power; crew physically seats each popped fuse and holds the bus stable. Life support first.",
      "calm",
    );
  },
  unmount(): void {
    clearPendingRoute();
    pending = null;
    fuseTray = null;
  },
};
