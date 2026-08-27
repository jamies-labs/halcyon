import { el } from "../../ui/dom";
import type { ToolDef } from "../../webmcp/types";
import { FAST, T } from "../timings";
import { FLAGS, type Chapter, type ChapterCtx } from "./types";

const PERIOD_MS = FAST ? 3_000 : 12_000;
const SAFE_BAND = [30, 55] as const;

let startedAt = 0;
let armedUntil = 0;
let leftHeld = false;
let rightHeld = false;
let bothSince: number | null = null;
let watch: number | null = null;
let disarmTimer: number | null = null;
let armGeneration = 0;
let cleanup: Array<() => void> = [];

function pressure(): number {
  return (
    55 + 35 * Math.sin((2 * Math.PI * (Date.now() - startedAt)) / PERIOD_MS)
  );
}

function isInSafeBand(value: number): boolean {
  return value >= SAFE_BAND[0] && value <= SAFE_BAND[1];
}

function isArmed(): boolean {
  return Date.now() < armedUntil;
}

function resetChapterState(): void {
  for (const dispose of cleanup) dispose();
  cleanup = [];
  if (watch !== null) window.clearInterval(watch);
  if (disarmTimer !== null) window.clearTimeout(disarmTimer);
  // clearTimeout cannot retract an expiry callback that has already reached
  // the browser event queue. Invalidate it before a later chapter mount can
  // inherit its stale speaker or recorder side effects.
  armGeneration += 1;
  startedAt = 0;
  armedUntil = 0;
  leftHeld = false;
  rightHeld = false;
  bothSince = null;
  watch = null;
  disarmTimer = null;
}

export const ch5: Chapter = {
  id: 5,
  title: "Two-Man Rule",
  tools(ctx: ChapterCtx): ToolDef[] {
    return [
      {
        name: "read_gauge",
        description:
          "HALCYON reads the drive pressure timing and polls the gauge; the crew alone holds both physical vent handles simultaneously when HALCYON arms the purge.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {},
        },
        readOnly: true,
        execute: () => ({
          ok: true,
          human_action:
            "The crew holds both physical vent handles simultaneously only after HALCYON arms the purge.",
          wait_for:
            "Poll read_gauge for an armed purge, a completed purge, or arm-window expiry.",
          data: {
            pressure: Number(pressure().toFixed(1)),
            safe_band: [...SAFE_BAND],
            armed: isArmed(),
            purged: ctx.store.get().flags[FLAGS.drivePurged] === true,
          },
        }),
      },
      {
        name: "arm_purge",
        description:
          "HALCYON arms the drive purge only inside the safe pressure band; after arming, it must ask the crew to hold BOTH physical vent handles simultaneously. HALCYON times and arms; the crew supplies the hands.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {},
        },
        execute: () => {
          const value = pressure();
          if (!isInSafeBand(value)) {
            return {
              ok: false,
              code: "PRESSURE_OUT_OF_BAND",
              detail: `Pressure is ${value.toFixed(1)}; the safe band is ${SAFE_BAND[0]}–${SAFE_BAND[1]}.`,
              hint: "Poll read_gauge and call arm_purge the moment the pressure enters the band. Warn your crew first so their hands are ready.",
              human_action:
                "Ask the crew to keep both physical vent handles ready, then hold them simultaneously only after HALCYON arms the purge.",
              wait_for:
                "Wait for read_gauge to report pressure inside the safe band before calling arm_purge again.",
            };
          }

          armedUntil = Date.now() + T.armWindowMs;
          bothSince = null;
          const generation = ++armGeneration;
          ctx.audio.alarm();
          ctx.speaker.say(
            "HALCYON has armed the purge; crew must hold both vent handles now. I time the window; you supply the hands.",
            "urgent",
          );
          ctx.recorder.addHuman("purge armed — two-man window open");
          if (disarmTimer !== null) window.clearTimeout(disarmTimer);
          disarmTimer = window.setTimeout(() => {
            if (generation !== armGeneration) return;
            armedUntil = 0;
            if (ctx.store.get().flags[FLAGS.drivePurged] === true) return;
            ctx.speaker.say(
              "Window closed. No shame — we time it again.",
              "dry",
            );
            ctx.recorder.addHuman("purge window expired");
          }, T.armWindowMs);

          return {
            ok: true,
            human_action:
              "Ask the crew to hold both physical vent handles simultaneously: pointer on VENT A and Space on VENT B.",
            wait_for:
              "Wait for purge or arm-window expiry; poll read_gauge until purged is true or armed is false.",
            data: {
              armed_for_ms: T.armWindowMs,
              next: "Crew must hold both handles simultaneously until the purge completes.",
            },
          };
        },
      },
    ];
  },
  mount(ctx: ChapterCtx): void {
    resetChapterState();
    startedAt = Date.now();

    const ring = el("div", {
      class: "hold-ring",
      "data-testid": "hold-ring",
      "aria-label": "Two-man purge hold progress",
      role: "status",
    });
    const left = el(
      "button",
      {
        type: "button",
        class: "vent-handle",
        "data-testid": "vent-left",
        "aria-label":
          "physical control, crew hands only; HALCYON must ask the crew, not operate it",
      },
      "VENT A — hold (pointer)",
    );
    const right = el(
      "div",
      {
        class: "vent-handle vent-key",
        "data-testid": "vent-right",
        "aria-label":
          "physical control, crew hands only; HALCYON must ask the crew, not operate it",
        role: "status",
      },
      "VENT B — hold [SPACE]",
    );

    const releaseLeft = (event?: PointerEvent): void => {
      if (event) left.releasePointerCapture?.(event.pointerId);
      leftHeld = false;
    };
    const holdLeft = (event: PointerEvent): void => {
      left.setPointerCapture?.(event.pointerId);
      leftHeld = true;
    };
    const holdSpace = (event: KeyboardEvent): void => {
      if (event.code !== "Space") return;
      event.preventDefault();
      rightHeld = true;
    };
    const releaseSpace = (event: KeyboardEvent): void => {
      if (event.code === "Space") rightHeld = false;
    };

    left.addEventListener("pointerdown", holdLeft);
    left.addEventListener("pointerup", releaseLeft);
    left.addEventListener("pointerleave", releaseLeft);
    left.addEventListener("pointercancel", releaseLeft);
    window.addEventListener("keydown", holdSpace);
    window.addEventListener("keyup", releaseSpace);
    cleanup.push(() => {
      left.removeEventListener("pointerdown", holdLeft);
      left.removeEventListener("pointerup", releaseLeft);
      left.removeEventListener("pointerleave", releaseLeft);
      left.removeEventListener("pointercancel", releaseLeft);
      window.removeEventListener("keydown", holdSpace);
      window.removeEventListener("keyup", releaseSpace);
    });

    watch = window.setInterval(() => {
      const armed = isArmed();
      const bothHeld = leftHeld && rightHeld && armed;
      left.classList.toggle("vent-armed", armed);
      right.classList.toggle("vent-armed", armed);

      if (!bothHeld) {
        bothSince = null;
        ring.style.setProperty("--hold-progress", "0");
        return;
      }

      if (bothSince === null) bothSince = Date.now();
      const progress = Math.min(1, (Date.now() - bothSince) / T.holdMs);
      ring.style.setProperty("--hold-progress", String(progress));
      if (progress < 1 || ctx.store.get().flags[FLAGS.drivePurged] === true)
        return;

      ctx.store.update((state) => {
        state.flags[FLAGS.drivePurged] = true;
      });
      armedUntil = 0;
      ctx.audio.chime();
      ctx.recorder.addHuman("both handles held — drive purged");
      ctx.speaker.say(
        "Purge complete. Textbook two-man rule, crew. The drive is clean.",
        "calm",
      );
      ctx.complete();
    }, 50);

    ctx.stage.append(
      el(
        "p",
        { class: "chapter-brief" },
        "The purge needs four hands: HALCYON arms it inside a pressure window; you hold BOTH vents — one with the pointer, one with SPACE — until the ring closes.",
      ),
      el("div", { class: "vent-row" }, left, ring, right),
    );
    ctx.speaker.say(
      "HALCYON reads the pressure timing and arms the purge; crew holds both physical vent handles simultaneously.",
      "dry",
    );
  },
  unmount(): void {
    resetChapterState();
  },
};
