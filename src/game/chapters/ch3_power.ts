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
  ["drive", 14],
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

const SUBSYSTEM_LABELS: Record<Subsystem, string> = {
  life_support: "Life support",
  comms: "Comms",
  drive: "Drive",
  sensors: "Sensors",
  lights: "Lights",
  heaters: "Heaters",
};

let seated = new Set<Subsystem>();
let pending: Partial<Record<Subsystem, number>> | null = null;
let routeVersion = 0;
let stableTimer: number | null = null;
let stableTick: number | null = null;
let fuseTray: HTMLElement | null = null;
let stabilizationStatus: HTMLElement | null = null;
let cleanup: Array<() => void> = [];
let holdTimers = new Set<number>();
let activeFuse: Subsystem | null = null;

function clearStableTimer(): void {
  if (stableTimer !== null) {
    window.clearTimeout(stableTimer);
    stableTimer = null;
  }
  if (stableTick !== null) {
    window.clearInterval(stableTick);
    stableTick = null;
  }
}

function clearFuseInteractions(): void {
  for (const dispose of cleanup) dispose();
  cleanup = [];
  for (const timer of holdTimers) window.clearTimeout(timer);
  holdTimers = new Set();
  activeFuse = null;
}

function clearPendingRoute(): void {
  routeVersion += 1;
  clearStableTimer();
  clearFuseInteractions();
  seated = new Set();
}

function startStability(ctx: ChapterCtx, version: number): void {
  if (stableTimer !== null || version !== routeVersion) return;

  const endsAt = Date.now() + T.powerStableMs;
  const updateStatus = (): void => {
    if (!stabilizationStatus || version !== routeVersion) return;
    const remainingSeconds = Math.max(0, (endsAt - Date.now()) / 1_000);
    stabilizationStatus.textContent = `Bus stabilizing — ${remainingSeconds.toFixed(1)} seconds remaining. Keep hands clear.`;
  };
  updateStatus();
  stableTick = window.setInterval(updateStatus, 100);
  ctx.speaker.say(
    `Crew seated every fuse. Keep hands clear while the bus stabilizes for ${Math.round(T.powerStableMs / 1_000)} seconds.`,
    "dry",
  );
  stableTimer = window.setTimeout(() => {
    stableTimer = null;
    if (stableTick !== null) window.clearInterval(stableTick);
    stableTick = null;
    if (version !== routeVersion || pending === null) return;
    const routedPower = pending;

    ctx.store.update((state) => {
      for (const subsystem of SUBSYSTEMS) {
        state.power[subsystem] = routedPower[subsystem] ?? 0;
      }
      state.flags[FLAGS.powerRouted] = true;
    });
    if (stabilizationStatus)
      stabilizationStatus.textContent = "Bus stable. Chapter complete.";
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
    const displayName = SUBSYSTEM_LABELS[subsystem];
    const state = el(
      "span",
      { class: "fuse-state", "data-testid": `fuse-state-${subsystem}` },
      "× POPPED",
    );
    const progress = el("progress", {
      class: "fuse-progress",
      "data-testid": `fuse-progress-${subsystem}`,
      max: "100",
      value: "0",
      "aria-label": `${displayName} fuse hold progress`,
    });
    const fuse = el(
      "button",
      {
        type: "button",
        class: "fuse",
        "data-fuse": subsystem,
        "aria-label": `Hold ${displayName} fuse until × changes to ● — physical control, crew hands only; HALCYON must ask the crew, not operate it`,
      },
      el("span", { class: "fuse-name" }, displayName),
      state,
      progress,
    );
    let holdTimer: number | null = null;
    let holdStartedAt = 0;
    let pointerId: number | null = null;
    const setProgress = (value: number): void => {
      const percentage = Math.round(Math.max(0, Math.min(1, value)) * 100);
      progress.setAttribute("value", String(percentage));
      progress.textContent = `${percentage}%`;
    };
    const stopHolding = (): void => {
      if (holdTimer === null) return;
      window.clearInterval(holdTimer);
      holdTimers.delete(holdTimer);
      holdTimer = null;
      holdStartedAt = 0;
      if (activeFuse === subsystem) activeFuse = null;
      if (!seated.has(subsystem)) {
        state.textContent = "× POPPED";
        setProgress(0);
      }
    };
    const startHolding = (): void => {
      if (
        holdTimer !== null ||
        seated.has(subsystem) ||
        version !== routeVersion ||
        (activeFuse !== null && activeFuse !== subsystem)
      )
        return;
      activeFuse = subsystem;
      holdStartedAt = Date.now();
      state.textContent = "× HOLDING";
      holdTimer = window.setInterval(() => {
        if (version !== routeVersion) {
          stopHolding();
          return;
        }
        const ratio = (Date.now() - holdStartedAt) / T.fuseSeatMs;
        setProgress(ratio);
        if (ratio < 1) return;

        stopHolding();
        seated.add(subsystem);
        state.textContent = "● SEATED";
        setProgress(1);
        fuse.classList.add("fuse-seated");
        ctx.audio.click();
        ctx.recorder.addHuman(`fuse re-seated: ${displayName}`);
        if (powered.every((id) => seated.has(id))) startStability(ctx, version);
      }, 25);
      holdTimers.add(holdTimer);
    };
    const pointerDown = (event: PointerEvent): void => {
      if (pointerId !== null) return;
      pointerId = event.pointerId;
      fuse.setPointerCapture?.(event.pointerId);
      startHolding();
    };
    const pointerRelease = (event: PointerEvent): void => {
      if (pointerId !== event.pointerId) return;
      pointerId = null;
      stopHolding();
    };
    const keyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      if (!event.repeat) startHolding();
    };
    const keyUp = (event: KeyboardEvent): void => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      stopHolding();
    };

    fuse.addEventListener("pointerdown", pointerDown);
    fuse.addEventListener("pointerup", pointerRelease);
    fuse.addEventListener("pointercancel", pointerRelease);
    fuse.addEventListener("lostpointercapture", pointerRelease);
    fuse.addEventListener("keydown", keyDown);
    fuse.addEventListener("keyup", keyUp);
    cleanup.push(() => {
      fuse.removeEventListener("pointerdown", pointerDown);
      fuse.removeEventListener("pointerup", pointerRelease);
      fuse.removeEventListener("pointercancel", pointerRelease);
      fuse.removeEventListener("lostpointercapture", pointerRelease);
      fuse.removeEventListener("keydown", keyDown);
      fuse.removeEventListener("keyup", keyUp);
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
          "HALCYON reads the current draw and 60A total budget. Next, HALCYON alone calls route_power with an allocations array of subsystem/amps objects; the crew never routes power and physically seats every fuse shown only after a route is accepted. Required subsystem minimums are taught one at a time by structured BROWNOUT results.",
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
          "HALCYON alone allocates power within the 60A budget. Submit allocations as an array of unique objects with subsystem (life_support, comms, drive, sensors, lights, or heaters) and integer amps from 0 to 40. Omitted subsystems receive 0A. Follow each BROWNOUT minimum in order; after acceptance, ask the crew to seat every physical fuse shown, one at a time. Re-routing pops and resets the full fuse set.",
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
                state_consequence:
                  "No route was accepted and the physical fuse state did not change.",
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
              state_consequence:
                "No route was accepted and the physical fuse state did not change.",
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
                state_consequence:
                  "No route was accepted and the physical fuse state did not change.",
              };
            }
          }

          const rerouted = pending !== null;
          clearPendingRoute();
          pending = Object.fromEntries(
            allocations.map((allocation) => [
              allocation.subsystem,
              allocation.amps,
            ]),
          ) as Partial<Record<Subsystem, number>>;
          renderFuses(ctx, routeVersion);
          ctx.audio.alarm();
          const poppedFuseCount = SUBSYSTEMS.filter(
            (subsystem) => (pending![subsystem] ?? 0) > 0,
          ).length;
          const routeMessage = rerouted
            ? "Allocation changed — every fuse popped. Seat the new set again."
            : `Route accepted — ${poppedFuseCount} ${poppedFuseCount === 1 ? "fuse" : "fuses"} popped. Seat ${poppedFuseCount === 1 ? "it" : "them"} one at a time.`;
          if (stabilizationStatus) stabilizationStatus.textContent = routeMessage;
          ctx.speaker.say(routeMessage, rerouted ? "urgent" : "calm");
          ctx.recorder.addHuman(routeMessage);
          return {
            ok: true,
            human_action:
              "Ask the crew to physically seat every popped powered fuse, holding each until it clicks home.",
            wait_for:
              "Wait until every powered fuse is seated and the bus has held stable before continuing.",
            state_consequence:
              `The accepted allocation popped ${poppedFuseCount} physical ${poppedFuseCount === 1 ? "fuse" : "fuses"}; power remains unchanged until the crew seats ${poppedFuseCount === 1 ? "it" : "them"} and stabilization completes.`,
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
    stabilizationStatus = el(
      "p",
      {
        class: "power-stabilization-status",
        "data-testid": "power-stabilization-status",
        "aria-live": "polite",
      },
      "Waiting for HALCYON to route power.",
    );
    fuseTray = el("div", {
      class: "fuse-tray",
      "data-testid": "fuse-tray",
      "aria-label": "Popped power fuses",
    });
    ctx.stage.append(
      el(
        "section",
        {
          class: "crew-action power-crew-guidance",
          "data-testid": "power-crew-guidance",
        },
        el("h2", {}, "CREW ACTION"),
        el(
          "p",
          {},
          "After HALCYON routes power, hold each popped fuse until × changes to ●. Seat them one at a time, then keep hands clear while the bus stabilizes.",
        ),
      ),
      fuseTray,
      stabilizationStatus,
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
    stabilizationStatus = null;
  },
};
