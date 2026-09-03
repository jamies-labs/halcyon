import { el } from "../../ui/dom";
import type { ToolDef } from "../../webmcp/types";
import { FAST, T } from "../timings";
import { FLAGS, type Chapter, type ChapterCtx } from "./types";

const PERIOD_MS = FAST ? 3_000 : 12_000;
const SAFE_BAND = [30, 55] as const;
type VentSide = "left" | "right";
type InputSource = "pointer" | "keyboard";
type VentState = "READY" | "HELD" | "RELEASED";

let startedAt = 0;
let armedUntil = 0;
let crewReady = false;
let purgeComplete = false;
let bothSince: number | null = null;
let watch: number | null = null;
let disarmTimer: number | null = null;
let armGeneration = 0;
let cleanup: Array<() => void> = [];
let leftSources = new Set<InputSource>();
let rightSources = new Set<InputSource>();
let leftState: VentState = "READY";
let rightState: VentState = "READY";
let resetCause = "Waiting for crew-ready acknowledgement.";

let leftControl: HTMLButtonElement | null = null;
let rightControl: HTMLButtonElement | null = null;
let leftStatus: HTMLElement | null = null;
let rightStatus: HTMLElement | null = null;
let ring: HTMLElement | null = null;
let ringText: HTMLElement | null = null;
let handoffStatus: HTMLElement | null = null;
let crewReadyStatus: HTMLElement | null = null;
let armCountdown: HTMLElement | null = null;
let resetStatus: HTMLElement | null = null;

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

function sourcesFor(side: VentSide): Set<InputSource> {
  return side === "left" ? leftSources : rightSources;
}

function setProgress(value: number): void {
  const percentage = Math.round(Math.max(0, Math.min(1, value)) * 100);
  ring?.style.setProperty("--hold-progress", String(percentage / 100));
  ring?.setAttribute("aria-valuenow", String(percentage));
  ring?.setAttribute("aria-valuetext", `${percentage}% complete`);
  if (ringText) ringText.textContent = `${percentage}%`;
}

function renderVentState(side: VentSide): void {
  const state = side === "left" ? leftState : rightState;
  const control = side === "left" ? leftControl : rightControl;
  const status = side === "left" ? leftStatus : rightStatus;
  const name = side === "left" ? "VENT A" : "VENT B";
  if (status) status.textContent = state;
  control?.classList.toggle("vent-held", state === "HELD");
  control?.setAttribute("aria-pressed", String(state === "HELD"));
  control?.setAttribute(
    "aria-label",
    `${name} ${state} — physical control, crew hands only; HALCYON must ask the crew, not operate it`,
  );
}

function updateSurface(): void {
  renderVentState("left");
  renderVentState("right");
  const armed = isArmed();
  leftControl?.classList.toggle("vent-armed", armed);
  rightControl?.classList.toggle("vent-armed", armed);
  if (armCountdown) {
    armCountdown.textContent = purgeComplete
      ? "PURGE COMPLETE — drive pressure is safe."
      : armed
      ? `ARMED — ${(Math.max(0, armedUntil - Date.now()) / 1_000).toFixed(1)} seconds remaining`
      : crewReady
        ? "Crew ready — waiting for HALCYON to arm the full window."
        : "Not armed — acknowledge crew ready first.";
  }
  if (resetStatus) resetStatus.textContent = resetCause;
}

function resetOverlap(reason: string): void {
  bothSince = null;
  setProgress(0);
  resetCause = reason;
  updateSurface();
}

function setInput(
  ctx: ChapterCtx,
  side: VentSide,
  source: InputSource,
  held: boolean,
  reason: string,
): void {
  const sources = sourcesFor(side);
  const wasHeld = sources.size > 0;
  if (held) sources.add(source);
  else sources.delete(source);
  const nowHeld = sources.size > 0;
  if (side === "left") leftState = nowHeld ? "HELD" : held ? leftState : "RELEASED";
  else rightState = nowHeld ? "HELD" : held ? rightState : "RELEASED";

  if (wasHeld !== nowHeld) {
    const name = side === "left" ? "VENT A" : "VENT B";
    ctx.recorder.addHuman(`${name} ${nowHeld ? "held" : "released"} (${reason}).`);
  }
  if (!nowHeld && !purgeComplete) resetOverlap(reason);
  else updateSurface();
}

function clearHeldInputs(ctx: ChapterCtx, reason: string): void {
  const leftWasHeld = leftSources.size > 0;
  const rightWasHeld = rightSources.size > 0;
  leftSources.clear();
  rightSources.clear();
  if (leftWasHeld) ctx.recorder.addHuman(`VENT A released (${reason}).`);
  if (rightWasHeld) ctx.recorder.addHuman(`VENT B released (${reason}).`);
  leftState = leftWasHeld ? "RELEASED" : "READY";
  rightState = rightWasHeld ? "RELEASED" : "READY";
  resetOverlap(reason);
}

function resetChapterState(): void {
  for (const dispose of cleanup) dispose();
  cleanup = [];
  if (watch !== null) window.clearInterval(watch);
  if (disarmTimer !== null) window.clearTimeout(disarmTimer);
  armGeneration += 1;
  startedAt = 0;
  armedUntil = 0;
  crewReady = false;
  purgeComplete = false;
  bothSince = null;
  watch = null;
  disarmTimer = null;
  leftSources = new Set();
  rightSources = new Set();
  leftState = "READY";
  rightState = "READY";
  resetCause = "Waiting for crew-ready acknowledgement.";
  leftControl = null;
  rightControl = null;
  leftStatus = null;
  rightStatus = null;
  ring = null;
  ringText = null;
  handoffStatus = null;
  crewReadyStatus = null;
  armCountdown = null;
  resetStatus = null;
}

export const ch5: Chapter = {
  id: 5,
  title: "Two-Man Rule",
  tools(ctx: ChapterCtx): ToolDef[] {
    return [
      {
        name: "read_gauge",
        description:
          "HALCYON reads the drive pressure and crew-ready state. First ask the crew to use the visible ready control. Then poll until pressure is 30–55, call arm_purge, and wait while the crew alone holds two physical vent controls simultaneously.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {},
        },
        readOnly: true,
        execute: () => ({
          ok: true,
          human_action:
            "Ask the crew to acknowledge ready, then hold two physical vent controls simultaneously only after HALCYON arms the purge.",
          wait_for:
            "Wait for crew_ready true, pressure inside the safe band, then an armed purge or completion.",
          data: {
            pressure: Number(pressure().toFixed(1)),
            safe_band: [...SAFE_BAND],
            crew_ready: crewReady,
            armed: isArmed(),
            purged: ctx.store.get().flags[FLAGS.drivePurged] === true,
          },
        }),
      },
      {
        name: "arm_purge",
        description:
          "HALCYON alone arms the drive purge. It must first receive the crew's visible ready acknowledgement, then call inside the 30–55 pressure band. Arming opens a full visible countdown; the crew completes the purge with two simultaneous physical controls (VENT A plus Space, both touch vents, or A plus Space).",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {},
        },
        execute: () => {
          if (!crewReady) {
            return {
              ok: false,
              code: "CREW_NOT_READY",
              detail: "The crew has not acknowledged that both controls are ready.",
              hint: "Ask the crew to press CREW READY, then poll read_gauge and arm inside the safe band.",
              human_action:
                "Ask the crew to press the visible CREW READY control before HALCYON arms the purge.",
              wait_for:
                "Wait for read_gauge to report crew_ready true before trying arm_purge again.",
              state_consequence:
                "The purge remains unarmed and drive.purged remains false.",
            };
          }

          const value = pressure();
          if (!isInSafeBand(value)) {
            return {
              ok: false,
              code: "PRESSURE_OUT_OF_BAND",
              detail: `Pressure is ${value.toFixed(1)}; the safe band is ${SAFE_BAND[0]}–${SAFE_BAND[1]}.`,
              hint: "Poll read_gauge and call arm_purge the moment the pressure enters the band. The crew-ready acknowledgement remains active.",
              human_action:
                "Ask the ready crew to keep both physical vent controls clear until HALCYON arms the purge.",
              wait_for:
                "Wait for read_gauge to report pressure inside the safe band before calling arm_purge again.",
              state_consequence:
                "The purge remains unarmed and drive.purged remains false.",
            };
          }

          clearHeldInputs(
            ctx,
            "Purge armed: release any pre-held input, then start a fresh two-control hold.",
          );
          armedUntil = Date.now() + T.armWindowMs;
          const generation = ++armGeneration;
          ctx.audio.alarm();
          ctx.speaker.say(
            "HALCYON has armed the full purge window. Crew: hold VENT A plus SPACE, both touch vents, or A plus SPACE until progress reaches 100%.",
            "urgent",
          );
          ctx.recorder.addHuman(
            `Purge armed — ${T.armWindowMs / 1_000}-second crew window opened.`,
          );
          if (handoffStatus)
            handoffStatus.textContent =
              "ARMED: begin a fresh two-control hold now and keep both held to 100%.";
          if (disarmTimer !== null) window.clearTimeout(disarmTimer);
          disarmTimer = window.setTimeout(() => {
            if (generation !== armGeneration) return;
            armedUntil = 0;
            if (ctx.store.get().flags[FLAGS.drivePurged] === true) return;
            clearHeldInputs(ctx, "Arm window expired before a continuous two-control hold completed.");
            ctx.speaker.say(
              "Arm window expired. Release both controls; HALCYON can time another attempt.",
              "dry",
            );
            ctx.recorder.addHuman("Purge arm window expired — retry required.");
          }, T.armWindowMs);
          updateSurface();

          return {
            ok: true,
            human_action:
              "Ask the crew to start a fresh simultaneous two-control hold: VENT A plus Space, both touch vents, or keyboard A plus Space.",
            wait_for:
              "Wait for purge or arm-window expiry; poll read_gauge until purged is true or armed is false.",
            state_consequence:
              "The purge is armed for the full visible crew window; drive.purged remains false until the uninterrupted hold completes.",
            data: {
              armed_for_ms: T.armWindowMs,
              next: "Crew must hold two controls simultaneously until progress reaches 100%.",
            },
          };
        },
      },
    ];
  },
  mount(ctx: ChapterCtx): void {
    resetChapterState();
    startedAt = Date.now();

    leftStatus = el(
      "span",
      { class: "vent-state", "data-testid": "vent-left-state", "aria-live": "polite" },
      "READY",
    );
    rightStatus = el(
      "span",
      { class: "vent-state", "data-testid": "vent-right-state", "aria-live": "polite" },
      "READY",
    );
    leftControl = el(
      "button",
      {
        type: "button",
        class: "vent-handle",
        "data-testid": "vent-left",
        "aria-pressed": "false",
      },
      el("strong", {}, "VENT A"),
      el("span", {}, "Pointer, touch, or A key"),
      leftStatus,
    );
    rightControl = el(
      "button",
      {
        type: "button",
        class: "vent-handle vent-key",
        "data-testid": "vent-right",
        "aria-pressed": "false",
      },
      el("strong", {}, "VENT B"),
      el("span", {}, "Space key or touch"),
      rightStatus,
    );
    ringText = el("span", { class: "hold-ring-text" }, "0%");
    ring = el(
      "div",
      {
        class: "hold-ring",
        "data-testid": "hold-ring",
        "aria-label": "Two-control purge hold progress",
        "aria-valuemin": "0",
        "aria-valuemax": "100",
        "aria-valuenow": "0",
        "aria-valuetext": "0% complete",
        role: "progressbar",
      },
      ringText,
    );
    handoffStatus = el(
      "p",
      { class: "ch5-handoff-status", "data-testid": "ch5-handoff-status", "aria-live": "polite" },
      "Step 1: confirm CREW READY. Step 2: HALCYON arms. Step 3: hold two controls to 100%.",
    );
    crewReadyStatus = el(
      "p",
      { class: "crew-action-status", "data-testid": "ch5-crew-ready-status", "aria-live": "polite" },
      "NOT READY — HALCYON cannot arm yet.",
    );
    armCountdown = el(
      "p",
      { class: "arm-countdown", "data-testid": "ch5-arm-countdown", "aria-live": "polite" },
      "Not armed — acknowledge crew ready first.",
    );
    resetStatus = el(
      "p",
      { class: "hold-reset-status", "data-testid": "ch5-reset-status", "aria-live": "assertive" },
      resetCause,
    );
    const readyButton = el(
      "button",
      { type: "button", class: "crew-ready", "data-testid": "ch5-crew-ready" },
      "CREW READY — both controls clear",
    );
    readyButton.addEventListener("click", () => {
      crewReady = true;
      readyButton.disabled = true;
      if (crewReadyStatus)
        crewReadyStatus.textContent = `CREW READY — HALCYON may arm a full ${T.armWindowMs / 1_000}-second window.`;
      resetCause = "Crew ready. Keep both controls clear until HALCYON arms.";
      ctx.recorder.addHuman("Crew ready for Chapter 5 two-control hold.");
      ctx.speaker.say(
        "Crew ready confirmed. HALCYON will arm when pressure enters the safe band.",
        "calm",
      );
      updateSurface();
    });

    let leftPointerId: number | null = null;
    let rightPointerId: number | null = null;
    const bindPointer = (
      side: VentSide,
      control: HTMLButtonElement,
    ): void => {
      const down = (event: PointerEvent): void => {
        if (side === "left") {
          if (leftPointerId !== null) return;
          leftPointerId = event.pointerId;
        } else {
          if (rightPointerId !== null) return;
          rightPointerId = event.pointerId;
        }
        control.setPointerCapture?.(event.pointerId);
        setInput(ctx, side, "pointer", true, "pointer down");
      };
      const release = (event: PointerEvent): void => {
        const expected = side === "left" ? leftPointerId : rightPointerId;
        if (event.pointerId !== expected) return;
        if (side === "left") leftPointerId = null;
        else rightPointerId = null;
        setInput(ctx, side, "pointer", false, event.type);
      };
      const blurControl = (): void => {
        if (side === "left") leftPointerId = null;
        else rightPointerId = null;
        setInput(ctx, side, "pointer", false, `${side} control lost focus`);
      };
      control.addEventListener("pointerdown", down);
      control.addEventListener("pointerup", release);
      control.addEventListener("pointerleave", release);
      control.addEventListener("pointercancel", release);
      control.addEventListener("lostpointercapture", release);
      control.addEventListener("blur", blurControl);
      cleanup.push(() => {
        control.removeEventListener("pointerdown", down);
        control.removeEventListener("pointerup", release);
        control.removeEventListener("pointerleave", release);
        control.removeEventListener("pointercancel", release);
        control.removeEventListener("lostpointercapture", release);
        control.removeEventListener("blur", blurControl);
      });
    };
    bindPointer("left", leftControl);
    bindPointer("right", rightControl);

    const keyDown = (event: KeyboardEvent): void => {
      const side = event.code === "KeyA" ? "left" : event.code === "Space" ? "right" : null;
      if (!side) return;
      event.preventDefault();
      if (!event.repeat) setInput(ctx, side, "keyboard", true, `${event.code} down`);
    };
    const keyUp = (event: KeyboardEvent): void => {
      const side = event.code === "KeyA" ? "left" : event.code === "Space" ? "right" : null;
      if (!side) return;
      event.preventDefault();
      setInput(ctx, side, "keyboard", false, `${event.code} up`);
    };
    const blur = (): void => {
      leftPointerId = null;
      rightPointerId = null;
      clearHeldInputs(ctx, "Window lost focus; hold reset to prevent a stuck input.");
    };
    const visibilityChange = (): void => {
      if (!document.hidden) return;
      blur();
    };
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("blur", blur);
    document.addEventListener?.("visibilitychange", visibilityChange);
    cleanup.push(() => {
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("blur", blur);
      document.removeEventListener?.("visibilitychange", visibilityChange);
    });

    watch = window.setInterval(() => {
      updateSurface();
      const bothHeld =
        leftSources.size > 0 && rightSources.size > 0 && isArmed();
      if (!bothHeld) {
        if (bothSince !== null)
          resetOverlap("Continuous overlap broke; hold both controls again from 0%.");
        return;
      }

      if (bothSince === null) {
        bothSince = Date.now();
        resetCause = "Both controls held — keep holding continuously.";
        ctx.recorder.addHuman("VENT A and VENT B overlap started.");
      }
      const progress = Math.min(1, (Date.now() - bothSince) / T.holdMs);
      setProgress(progress);
      if (progress < 1 || ctx.store.get().flags[FLAGS.drivePurged] === true)
        return;

      ctx.store.update((state) => {
        state.flags[FLAGS.drivePurged] = true;
      });
      purgeComplete = true;
      armedUntil = 0;
      armGeneration += 1;
      if (disarmTimer !== null) window.clearTimeout(disarmTimer);
      disarmTimer = null;
      ctx.audio.chime();
      ctx.recorder.addHuman("Two-control hold reached 100% — drive purged.");
      if (handoffStatus) handoffStatus.textContent = "PURGE COMPLETE — Chapter 6 unlocked.";
      resetCause = "Success: uninterrupted two-control hold complete.";
      updateSurface();
      ctx.speaker.say(
        "Purge complete. Textbook two-man rule, crew. The drive is clean.",
        "calm",
      );
      ctx.complete();
    }, 50);

    ctx.stage.append(
      el(
        "section",
        { class: "crew-action ch5-crew-action" },
        el("h2", {}, "CREW ACTION"),
        el(
          "p",
          {},
          "Confirm ready before HALCYON arms. Then hold two controls together for two seconds: mouse + Space, both touch vents, or keyboard A + Space.",
        ),
        readyButton,
        crewReadyStatus!,
      ),
      handoffStatus!,
      armCountdown!,
      el("div", { class: "vent-row" }, leftControl!, ring!, rightControl!),
      resetStatus!,
    );
    updateSurface();
    ctx.speaker.say(
      "Crew, confirm ready first. HALCYON will read pressure and arm; you will hold two physical vent controls together.",
      "dry",
    );
  },
  unmount(): void {
    resetChapterState();
  },
};
