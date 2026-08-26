import { el } from "../../ui/dom";
import type { TimelineEntry } from "../../ui/recorder";
import type { ToolDef } from "../../webmcp/types";
import { FAST, T } from "../timings";
import { FLAGS, type Chapter, type ChapterCtx } from "./types";

const TAPS_NEEDED = FAST ? 4 : 8;
const TAP_TOL_MS = FAST ? 10_000 : 180;
const BPM = 90;
const PERIOD_MS = 60_000 / BPM;
const VECTOR_TOLERANCE = 0.011;

type JumpVector = { x: number; y: number; z: number };

interface BurnState {
  vectorSet: boolean;
  pressurized: boolean;
  taps: number;
  shuttersLeft: boolean;
  shuttersRight: boolean;
  precheckGo: boolean;
  throttleDone: boolean;
}

function initialBurnState(): BurnState {
  return {
    vectorSet: false,
    pressurized: false,
    taps: 0,
    shuttersLeft: false,
    shuttersRight: false,
    precheckGo: false,
    throttleDone: false,
  };
}

let burn = initialBurnState();
let countdownUntil = 0;
let countdownTimer: number | null = null;
let metronomeStop: (() => void) | null = null;
let metronomeStartedAt = 0;
let cleanup: Array<() => void> = [];
let resetSurface: (() => void) | null = null;

function resetChapterState(): void {
  metronomeStop?.();
  metronomeStop = null;
  if (countdownTimer !== null) window.clearInterval(countdownTimer);
  countdownTimer = null;
  for (const dispose of cleanup) dispose();
  cleanup = [];
  burn = initialBurnState();
  countdownUntil = 0;
  metronomeStartedAt = 0;
  resetSurface = null;
}

function missing(ctx: ChapterCtx): string[] {
  const missingItems: string[] = [];
  if (!burn.vectorSet) {
    missingItems.push("jump_vector (set_jump_vector with the decoded vector)");
  }
  if (!burn.pressurized) {
    missingItems.push("injectors_pressurized (pressurize_injectors)");
  }
  if (burn.taps < TAPS_NEEDED) {
    missingItems.push(
      `injectors_primed (crew: ${burn.taps}/${TAPS_NEEDED} on-beat taps)`,
    );
  }
  if (!burn.shuttersLeft || !burn.shuttersRight) {
    missingItems.push(
      "blast_shutters (crew: hold each shutter until it latches)",
    );
  }
  if (ctx.store.get().flags[FLAGS.drivePurged] !== true) {
    missingItems.push("drive_purge (chapter 5)");
  }
  if (ctx.store.get().flags[FLAGS.powerRouted] !== true) {
    missingItems.push("power_routing (chapter 3)");
  }
  return missingItems;
}

function startCountdownOnce(ctx: ChapterCtx, bar: HTMLElement): void {
  if (countdownUntil !== 0) return;
  countdownUntil = Date.now() + T.burnCountdownMs;
  countdownTimer = window.setInterval(() => {
    const remaining = countdownUntil - Date.now();
    bar.style.setProperty(
      "--burn-progress",
      String(Math.max(0, remaining / T.burnCountdownMs)),
    );
    if (remaining > 0) return;

    if (countdownTimer !== null) window.clearInterval(countdownTimer);
    countdownTimer = null;
    metronomeStop?.();
    metronomeStop = null;
    burn = initialBurnState();
    countdownUntil = 0;
    metronomeStartedAt = 0;
    resetSurface?.();
    ctx.audio.alarm();
    ctx.recorder.addHuman("burn window expired — checklist reset");
    ctx.speaker.say(
      "Window closed. Deep breath. Same dance, from the top — we have fuel for as many tries as we need.",
      "calm",
    );
  }, 200);
}

function matchesVector(candidate: JumpVector, expected: JumpVector): boolean {
  return (
    Math.abs(candidate.x - expected.x) <= VECTOR_TOLERANCE &&
    Math.abs(candidate.y - expected.y) <= VECTOR_TOLERANCE &&
    Math.abs(candidate.z - expected.z) <= VECTOR_TOLERANCE
  );
}

function showVictory(ctx: ChapterCtx): void {
  const timeline = el("ol", {
    class: "replay",
    "data-testid": "replay-timeline",
    "aria-label": "Flight recorder replay",
  });
  for (const entry of ctx.recorder.getTimeline() as TimelineEntry[]) {
    timeline.append(
      el(
        "li",
        { class: entry.kind === "human" ? "rec-human" : "rec-tool" },
        `${entry.kind === "human" ? "CREW" : "HALCYON"} — ${entry.label}`,
      ),
    );
  }
  ctx.stage.replaceChildren(
    el(
      "section",
      {
        class: "victory",
        "data-testid": "victory-card",
        "aria-live": "polite",
      },
      el("h1", {}, "JUMP COMPLETE"),
      el(
        "p",
        {},
        "Neither of you could have done that alone. That was the point.",
      ),
      el("p", { class: "victory-sign" }, "Signed, your crew: you & HALCYON"),
      el("h2", {}, "Flight recorder — how you did it together"),
      timeline,
    ),
  );
}

export const ch6: Chapter = {
  id: 6,
  title: "Burn",
  tools(ctx: ChapterCtx): ToolDef[] {
    const coordinateSchema = { type: "number", minimum: -10, maximum: 10 };
    return [
      {
        name: "set_jump_vector",
        description:
          "Load the jump vector into the nav computer. It must match the vector decoded from the rescue buoy.",
        inputSchema: {
          type: "object",
          required: ["x", "y", "z"],
          additionalProperties: false,
          properties: {
            x: coordinateSchema,
            y: coordinateSchema,
            z: coordinateSchema,
          },
        },
        execute: (args) => {
          const expected = ctx.store.get().flags[FLAGS.jumpVector] as
            JumpVector | undefined;
          if (!expected) {
            return {
              ok: false,
              code: "NO_VECTOR_KNOWN",
              detail: "No decoded vector is on file.",
              hint: "Complete Chapter 4, then use the decoded jump_vector.",
            };
          }
          const candidate = args as JumpVector;
          if (!matchesVector(candidate, expected)) {
            return {
              ok: false,
              code: "VECTOR_MISMATCH",
              detail: "That vector does not match the buoy reply.",
              hint: "Use the exact jump_vector from decode_reply.",
            };
          }
          burn.vectorSet = true;
          return {
            ok: true,
            data: { vector_locked: true, next: "pressurize_injectors" },
          };
        },
      },
      {
        name: "pressurize_injectors",
        description:
          "Pressurize the drive injectors after the nav computer has locked the jump vector.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {},
        },
        execute: () => {
          if (!burn.vectorSet) {
            return {
              ok: false,
              code: "SEQUENCE_ORDER",
              detail: "The nav computer has no locked vector.",
              hint: "Call set_jump_vector first.",
            };
          }
          burn.pressurized = true;
          ctx.speaker.say(
            "Injectors pressurized. Crew: prime them on my beat, then close both blast shutters.",
            "urgent",
          );
          return {
            ok: true,
            data: {
              pressurized: true,
              next: "Crew primes injectors on the metronome and closes both shutters; then call ignite_precheck.",
            },
          };
        },
      },
      {
        name: "ignite_precheck",
        description:
          "Run the pre-ignition checklist. It returns GO or the exact remaining items.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {},
        },
        execute: () => {
          const missingItems = missing(ctx);
          if (missingItems.length > 0) {
            return {
              ok: false,
              code: "NOT_READY",
              detail: `Missing: ${missingItems.join("; ")}`,
              hint: "Clear every item, then call ignite_precheck again.",
            };
          }
          burn.precheckGo = true;
          ctx.speaker.say(
            "Precheck GO. Crew: throttle up and hold through the shake. Then I light it.",
            "urgent",
          );
          return {
            ok: true,
            data: {
              go: true,
              next: "Crew holds the throttle through the wobble; then call execute_jump.",
            },
          };
        },
      },
      {
        name: "execute_jump",
        description:
          "Light the drive and jump home after a GO precheck and completed human throttle hold.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {},
        },
        execute: () => {
          if (!burn.precheckGo || !burn.throttleDone) {
            const waitingOn = burn.precheckGo
              ? ["crew throttle hold"]
              : missing(ctx).length > 0
                ? missing(ctx)
                : ["ignite_precheck GO"];
            return {
              ok: false,
              code: "NOT_READY",
              detail: `Waiting on: ${waitingOn.join("; ")}.`,
              hint: "Finish the checklist in order, then jump.",
            };
          }
          ctx.audio.chime();
          ctx.recorder.addHuman("JUMP — ISV Halcyon away");
          ctx.complete();
          // ToolRegistry records the tool outcome after execute returns. Defer
          // the DOM replay one task so it contains this real execute_jump call.
          window.setTimeout(() => showVictory(ctx), 0);
          return {
            ok: true,
            data: { jumped: true, message: "See you on the other side, crew." },
          };
        },
      },
    ];
  },
  mount(ctx: ChapterCtx): void {
    resetChapterState();
    const bar = el("div", {
      class: "burn-bar",
      "data-testid": "burn-bar",
      role: "status",
      "aria-label": "Burn checklist window",
    });
    const tap = el(
      "button",
      {
        type: "button",
        class: "inject-tap",
        "data-testid": "inject-tap",
        "aria-label": "Prime injectors on the metronome beat",
      },
      `PRIME 0/${TAPS_NEEDED}`,
    );
    const onTap = (): void => {
      startCountdownOnce(ctx, bar);
      if (!burn.pressurized || burn.taps >= TAPS_NEEDED) return;
      if (metronomeStartedAt === 0) {
        metronomeStartedAt = Date.now();
        metronomeStop = ctx.audio.startMetronome(BPM, () => {
          tap.classList.add("beat");
          window.setTimeout(() => tap.classList.remove("beat"), 120);
        });
      }
      const phase = (Date.now() - metronomeStartedAt) % PERIOD_MS;
      if (phase > TAP_TOL_MS && phase < PERIOD_MS - TAP_TOL_MS) return;
      burn.taps += 1;
      ctx.audio.click();
      tap.textContent = `PRIME ${burn.taps}/${TAPS_NEEDED}`;
      if (burn.taps < TAPS_NEEDED) return;
      metronomeStop?.();
      metronomeStop = null;
      ctx.recorder.addHuman("injectors primed on the beat");
    };
    tap.addEventListener("click", onTap);
    cleanup.push(() => tap.removeEventListener("click", onTap));

    const makeShutter = (side: "left" | "right"): HTMLButtonElement => {
      const shutter = el(
        "button",
        {
          type: "button",
          class: "vent-handle",
          "data-testid": `shutter-${side}`,
          "aria-label": `Hold ${side} blast shutter until it latches`,
        },
        `SHUTTER ${side.toUpperCase()} — hold`,
      );
      let holdTimer: number | null = null;
      const stopHolding = (): void => {
        if (holdTimer === null) return;
        window.clearTimeout(holdTimer);
        holdTimer = null;
      };
      const startHolding = (): void => {
        startCountdownOnce(ctx, bar);
        if (holdTimer !== null) return;
        holdTimer = window.setTimeout(() => {
          holdTimer = null;
          if (side === "left") burn.shuttersLeft = true;
          else burn.shuttersRight = true;
          shutter.classList.add("fuse-seated");
          ctx.audio.click();
          ctx.recorder.addHuman(`blast shutter ${side} latched`);
        }, T.fuseSeatMs);
      };
      shutter.addEventListener("pointerdown", startHolding);
      shutter.addEventListener("pointerup", stopHolding);
      shutter.addEventListener("pointerleave", stopHolding);
      shutter.addEventListener("pointercancel", stopHolding);
      cleanup.push(() => {
        shutter.removeEventListener("pointerdown", startHolding);
        shutter.removeEventListener("pointerup", stopHolding);
        shutter.removeEventListener("pointerleave", stopHolding);
        shutter.removeEventListener("pointercancel", stopHolding);
        stopHolding();
      });
      return shutter;
    };

    const throttle = el(
      "button",
      {
        type: "button",
        class: "vent-handle throttle",
        "data-testid": "throttle",
        "aria-label": "Hold throttle through the shake",
      },
      "THROTTLE — hold through the shake",
    );
    let throttleTimer: number | null = null;
    const leftShutter = makeShutter("left");
    const rightShutter = makeShutter("right");
    resetSurface = () => {
      bar.style.setProperty("--burn-progress", "1");
      tap.textContent = `PRIME 0/${TAPS_NEEDED}`;
      tap.classList.remove("beat");
      leftShutter.classList.remove("fuse-seated");
      rightShutter.classList.remove("fuse-seated");
      throttle.classList.remove("shaking", "fuse-seated");
    };
    const stopThrottle = (): void => {
      throttle.classList.remove("shaking");
      if (throttleTimer === null || burn.throttleDone) return;
      window.clearTimeout(throttleTimer);
      throttleTimer = null;
    };
    const startThrottle = (): void => {
      startCountdownOnce(ctx, bar);
      if (throttleTimer !== null || burn.throttleDone) return;
      throttle.classList.add("shaking");
      throttleTimer = window.setTimeout(() => {
        throttleTimer = null;
        burn.throttleDone = true;
        throttle.classList.remove("shaking");
        throttle.classList.add("fuse-seated");
        ctx.audio.chime();
        ctx.recorder.addHuman("throttle held through the wobble");
      }, T.throttleHoldMs);
    };
    throttle.addEventListener("pointerdown", startThrottle);
    throttle.addEventListener("pointerup", stopThrottle);
    throttle.addEventListener("pointerleave", stopThrottle);
    throttle.addEventListener("pointercancel", stopThrottle);
    cleanup.push(() => {
      throttle.removeEventListener("pointerdown", startThrottle);
      throttle.removeEventListener("pointerup", stopThrottle);
      throttle.removeEventListener("pointerleave", stopThrottle);
      throttle.removeEventListener("pointercancel", stopThrottle);
      stopThrottle();
    });

    ctx.stage.append(
      el(
        "p",
        { class: "chapter-brief" },
        "The last dance is interleaved: HALCYON loads the vector and pressurizes; you prime on the beat and latch both shutters; it prechecks; you hold the throttle; it lights the drive.",
      ),
      bar,
      el(
        "div",
        { class: "vent-row" },
        tap,
        leftShutter,
        rightShutter,
        throttle,
      ),
    );
    ctx.speaker.say(
      "Final checklist, crew. I call my steps, you call yours. Nobody rushes; the window is generous and so am I.",
      "calm",
    );
  },
  unmount(): void {
    resetChapterState();
  },
};
