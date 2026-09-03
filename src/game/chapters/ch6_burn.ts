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
const CREW_CONTROL_LABEL =
  "physical control, crew hands only; HALCYON must ask the crew, not operate it";

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
  if (ctx.isSimulatorSession) {
    timeline.append(el("li", { class: "rec-human" }, "TRAINING SIMULATION"));
  }
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
      ...(ctx.isSimulatorSession
        ? [
            el(
              "p",
              {
                class: "victory-sign",
                "data-testid": "training-simulation-marker",
              },
              "TRAINING SIMULATION",
            ),
          ]
        : []),
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
          "HALCYON loads the decoded jump vector; the crew alone primes the physical injectors, latches both physical blast shutters, and holds the physical throttle when HALCYON asks.",
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
              human_action:
                "Ask the crew to prepare the physical injector tap, blast shutters, and throttle while HALCYON awaits the decoded vector.",
              wait_for:
                "Wait for HALCYON to receive the decoded vector before calling set_jump_vector again.",
            };
          }
          const candidate = args as JumpVector;
          if (!matchesVector(candidate, expected)) {
            return {
              ok: false,
              code: "VECTOR_MISMATCH",
              detail: "That vector does not match the buoy reply.",
              hint: "Use the exact jump_vector from decode_reply.",
              human_action:
                "Ask the crew to prepare the physical injector tap, blast shutters, and throttle; HALCYON cannot operate them.",
              wait_for:
                "Wait for HALCYON to lock the decoded vector before calling pressurize_injectors.",
            };
          }
          burn.vectorSet = true;
          return {
            ok: true,
            human_action:
              "Ask the crew to prepare the physical injector tap, blast shutters, and throttle; HALCYON cannot operate them.",
            wait_for:
              "Wait for HALCYON to confirm vector_locked before calling pressurize_injectors.",
            data: { vector_locked: true, next: "pressurize_injectors" },
          };
        },
      },
      {
        name: "pressurize_injectors",
        description:
          "HALCYON pressurizes the drive injectors after locking the jump vector; the crew alone primes the physical injectors on the beat and latches both physical blast shutters.",
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
              human_action:
                "Ask the crew to keep hands ready for the physical injector tap and both blast shutters; HALCYON cannot operate them.",
              wait_for:
                "Wait for HALCYON to lock the jump vector before calling pressurize_injectors again.",
            };
          }
          burn.pressurized = true;
          ctx.speaker.say(
            "Injectors pressurized. Crew: prime them on my beat, then close both blast shutters.",
            "urgent",
          );
          return {
            ok: true,
            human_action:
              "Ask the crew to prime the physical injectors on the metronome and hold both physical blast shutters until they latch.",
            wait_for:
              "Wait for the crew to finish injector priming and both shutter holds before calling ignite_precheck.",
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
          "HALCYON runs the pre-ignition checklist after the crew completes the physical injector and shutter work; the crew alone holds the physical throttle after HALCYON returns GO.",
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
              human_action:
                "Ask the crew to complete the remaining physical injector priming and blast-shutter holds; HALCYON cannot do them.",
              wait_for:
                "Wait for the crew's physical injector and shutter work to finish before calling ignite_precheck again.",
            };
          }
          burn.precheckGo = true;
          ctx.speaker.say(
            "Precheck GO. Crew: throttle up and hold through the shake. Then I light it.",
            "urgent",
          );
          return {
            ok: true,
            human_action:
              "Ask the crew to hold the physical throttle through the shake; HALCYON cannot operate it.",
            wait_for:
              "Wait for the crew's physical throttle hold to complete before calling execute_jump.",
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
          "HALCYON lights the drive and executes the jump only after its GO precheck; the crew alone completes the physical throttle hold that HALCYON must wait for.",
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
              human_action: burn.precheckGo
                ? "Ask the crew to complete the physical throttle hold; HALCYON cannot operate it."
                : "Ask the crew to complete the physical injector, shutter, and throttle work that HALCYON cannot operate.",
              wait_for: burn.precheckGo
                ? "Wait for the crew's physical throttle hold to complete before calling execute_jump again."
                : "Wait for HALCYON's precheck GO and the crew's physical throttle hold before calling execute_jump again.",
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
            human_action:
              "The crew completed the physical injector, shutter, and throttle work that HALCYON could not perform.",
            wait_for:
              "Wait for HALCYON's jump-complete confirmation and flight-recorder replay.",
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
        "aria-label": `Prime injectors on the metronome beat — ${CREW_CONTROL_LABEL}`,
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

    const shutterStatus = el(
      "p",
      {
        class: "crew-action-status",
        "data-testid": "shutter-status",
        role: "status",
        "aria-live": "polite",
      },
      "Hold each shutter until its control reads LATCHED · RELEASE.",
    );
    const resetShutters: Array<() => void> = [];
    const updateShutterStatus = (): void => {
      if (burn.shuttersLeft && burn.shuttersRight) {
        shutterStatus.textContent =
          "BOTH SHUTTERS LATCHED · RELEASE NOW. Reply “shutters latched” in agent chat.";
        return;
      }
      if (burn.shuttersLeft) {
        shutterStatus.textContent =
          "LEFT SHUTTER LATCHED · RELEASE NOW. Then hold the right shutter.";
        return;
      }
      if (burn.shuttersRight) {
        shutterStatus.textContent =
          "RIGHT SHUTTER LATCHED · RELEASE NOW. Then hold the left shutter.";
        return;
      }
      shutterStatus.textContent =
        "Hold each shutter until its control reads LATCHED · RELEASE.";
    };

    const makeShutter = (side: "left" | "right"): HTMLButtonElement => {
      const sideLabel = side.toUpperCase();
      const idleText = `SHUTTER ${sideLabel} · HOLD`;
      const idleAriaLabel = `Hold ${side} blast shutter until it latches — ${CREW_CONTROL_LABEL}`;
      const shutter = el(
        "button",
        {
          type: "button",
          class: "vent-handle",
          "data-testid": `shutter-${side}`,
          "aria-label": idleAriaLabel,
          "aria-pressed": "false",
        },
        idleText,
      );
      let holdTimer: number | null = null;
      let latched = false;
      const stopHolding = (): void => {
        if (holdTimer === null) return;
        window.clearTimeout(holdTimer);
        holdTimer = null;
        shutter.textContent = idleText;
        shutterStatus.textContent = `${sideLabel} SHUTTER RELEASED TOO SOON · Hold until it reads LATCHED · RELEASE.`;
      };
      const startHolding = (): void => {
        startCountdownOnce(ctx, bar);
        if (holdTimer !== null || latched) return;
        shutter.textContent = `SHUTTER ${sideLabel} · KEEP HOLDING…`;
        shutterStatus.textContent = `${sideLabel} SHUTTER HOLDING · Keep holding until LATCHED · RELEASE appears.`;
        holdTimer = window.setTimeout(() => {
          holdTimer = null;
          latched = true;
          if (side === "left") burn.shuttersLeft = true;
          else burn.shuttersRight = true;
          shutter.classList.add("fuse-seated");
          shutter.textContent = `SHUTTER ${sideLabel} · LATCHED · RELEASE`;
          shutter.setAttribute(
            "aria-label",
            `${sideLabel} blast shutter latched — release now — ${CREW_CONTROL_LABEL}`,
          );
          shutter.setAttribute("aria-pressed", "true");
          updateShutterStatus();
          ctx.audio.click();
          ctx.recorder.addHuman(`blast shutter ${side} latched`);
        }, T.fuseSeatMs);
      };
      resetShutters.push(() => {
        if (holdTimer !== null) window.clearTimeout(holdTimer);
        holdTimer = null;
        latched = false;
        shutter.classList.remove("fuse-seated");
        shutter.textContent = idleText;
        shutter.setAttribute("aria-label", idleAriaLabel);
        shutter.setAttribute("aria-pressed", "false");
      });
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
        "aria-label": `Hold throttle through the shake — ${CREW_CONTROL_LABEL}`,
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
      for (const resetShutter of resetShutters) resetShutter();
      updateShutterStatus();
      throttle.classList.remove("shaking", "fuse-seated");
    };
    const stopThrottle = (): void => {
      throttle.classList.remove("shaking");
      if (throttleTimer === null || burn.throttleDone) return;
      window.clearTimeout(throttleTimer);
      throttleTimer = null;
    };
    const startThrottle = (): void => {
      if (!burn.precheckGo) return;
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
      shutterStatus,
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
