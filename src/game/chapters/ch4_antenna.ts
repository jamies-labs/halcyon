import { el } from "../../ui/dom";
import type { ToolDef } from "../../webmcp/types";
import { T } from "../timings";
import { FLAGS, type Chapter, type ChapterCtx } from "./types";

const TARGET = { azimuth: 137, elevation: 42 };
const LOCK_TOLERANCE = 4;
const DECODER_TARGET_KHZ = -18;
const JUMP_VECTOR = { x: 0.42, y: -1.07, z: 3.14 };

let position = { azimuth: 20, elevation: 70 };
let locked = false;
let lockStartedAt: number | null = null;
let replyAt: number | null = null;
let decoderOffsetKhz = 0;
let meterTimer: number | null = null;
let cleanup: Array<() => void> = [];
let dishStatus: HTMLElement | null = null;
let strengthMeter: HTMLProgressElement | null = null;
let lockProgress: HTMLProgressElement | null = null;
let holdStatus: HTMLElement | null = null;
let dishKnob: HTMLElement | null = null;

function alignmentError(): number {
  return Math.hypot(
    position.azimuth - TARGET.azimuth,
    position.elevation - TARGET.elevation,
  );
}

function signalBand(error = alignmentError()): "FAR" | "NEAR" | "LOCK" {
  return error < LOCK_TOLERANCE ? "LOCK" : error < 25 ? "NEAR" : "FAR";
}

function signalStrength(error = alignmentError()): number {
  return Math.round(Math.max(0, Math.min(100, 100 - error * 2)));
}

function checksumQuality(): number {
  return Math.max(0, 1 - Math.abs(decoderOffsetKhz - DECODER_TARGET_KHZ) / 50);
}

function roundedQuality(): number {
  return Number(checksumQuality().toFixed(2));
}

function garble(text: string, quality: number): string {
  const noise = "#@%&$!?~^*";
  return [...text]
    .map((character, index) =>
      character === " " || ((index * 7919) % 100) / 100 < quality
        ? character
        : noise[index % noise.length],
    )
    .join("");
}

function noReplyYet() {
  return {
    ok: false as const,
    code: "NO_REPLY_YET",
    detail: "The receiver holds no transmission.",
    hint: "First wait for the buoy reply after send_distress, then tune_decoder with a schema-valid offset_khz.",
  };
}

function dynamicCommsTools(ctx: ChapterCtx): ToolDef[] {
  return [
    {
      name: "send_distress",
      description:
        "HALCYON operates the distress transmitter only after the crew's physical antenna alignment locks comms; the crew alone aligns the dish. The recovery order is send_distress, wait for the reply, tune_decoder, then decode_reply.",
      inputSchema: {
        type: "object",
        required: ["message"],
        additionalProperties: false,
        properties: {
          message: { type: "string", minLength: 1, maxLength: 120 },
        },
      },
      rateLimitMs: 2_000,
      execute: (args) => {
        replyAt = Date.now() + T.replyDelayMs;
        ctx.speaker.say(`Transmitting: “${String(args.message)}”`, "calm");
        window.setTimeout(() => {
          ctx.audio.chime();
          ctx.speaker.say(
            "Incoming reply. It is garbled — tune the decoder.",
            "urgent",
          );
        }, T.replyDelayMs);
        return {
          ok: true,
          data: {
            sent: true,
            next: "Wait for the reply, then call tune_decoder and compare checksum_quality before decode_reply.",
          },
        };
      },
    },
    {
      name: "tune_decoder",
      description:
        "HALCYON operates the decoder after the crew's physical antenna alignment locks comms; the crew alone aligns the dish. After the reply arrives, set a schema-valid decoder offset_khz and compare the returned checksum_quality (0 to 1); decode_reply succeeds at 0.95 or better.",
      inputSchema: {
        type: "object",
        required: ["offset_khz"],
        additionalProperties: false,
        properties: {
          offset_khz: { type: "integer", minimum: -50, maximum: 50 },
        },
      },
      execute: (args) => {
        if (replyAt === null || Date.now() < replyAt) return noReplyYet();
        decoderOffsetKhz = args.offset_khz as number;
        return {
          ok: true,
          data: {
            offset_khz: decoderOffsetKhz,
            checksum_quality: roundedQuality(),
          },
        };
      },
    },
    {
      name: "decode_reply",
      description:
        "HALCYON operates reply decoding after the crew's physical antenna alignment locks comms; the crew alone aligns the dish. Wait for a reply, tune_decoder, then decode_reply. Below 0.95 checksum_quality the text stays garbled and returns another tuning action.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
      execute: () => {
        if (replyAt === null || Date.now() < replyAt) return noReplyYet();

        const quality = roundedQuality();
        const message =
          "RESCUE BUOY 7: vector home locked. Goodspeed, HALCYON.";
        if (quality < 0.95) {
          return {
            ok: true,
            data: {
              checksum_quality: quality,
              text: garble(message, quality),
              hint: `Choose another offset_khz within the documented schema bounds, compare its checksum_quality to ${quality}, then decode again only at 0.95 or higher.`,
            },
          };
        }

        ctx.store.update((state) => {
          state.flags[FLAGS.jumpVector] = { ...JUMP_VECTOR };
        });
        ctx.audio.chime();
        ctx.speaker.say(
          "Reply decoded. We have a vector home, crew. I will need it for the burn.",
          "calm",
        );
        ctx.complete();
        return {
          ok: true,
          data: {
            checksum_quality: quality,
            decoded: {
              message,
              jump_vector: { ...JUMP_VECTOR },
            },
          },
        };
      },
    },
  ];
}

function lockAntenna(ctx: ChapterCtx): void {
  if (locked) return;
  locked = true;
  if (dishStatus) dishStatus.textContent = "LOCK — antenna alignment complete";
  if (strengthMeter) strengthMeter.value = 100;
  if (lockProgress) lockProgress.value = 100;
  if (holdStatus)
    holdStatus.textContent =
      "Crew action complete. HALCYON: send distress, wait for the reply, tune the decoder, then decode it.";
  dishKnob?.setAttribute("aria-valuenow", "100");
  dishKnob?.setAttribute(
    "aria-valuetext",
    "LOCK. Antenna alignment complete; HALCYON now operates communications.",
  );
  ctx.audio.stopStatic();
  ctx.audio.chime();
  ctx.store.update((state) => {
    state.flags[FLAGS.commsOnline] = true;
  });
  ctx.registry.addTools(dynamicCommsTools(ctx));
  ctx.recorder.addHuman("Antenna locked — comms tools registered mid-page.");
  ctx.speaker.say(
    "My coarse meter confirms LOCK; your fine physical alignment brought us here, crew. New comms tools are online for me: send_distress, tune_decoder, decode_reply.",
    "urgent",
  );
}

function resetChapterState(): void {
  for (const dispose of cleanup) dispose();
  cleanup = [];
  if (meterTimer !== null) window.clearInterval(meterTimer);
  meterTimer = null;
  position = { azimuth: 20, elevation: 70 };
  locked = false;
  lockStartedAt = null;
  replyAt = null;
  decoderOffsetKhz = 0;
  dishStatus = null;
  strengthMeter = null;
  lockProgress = null;
  holdStatus = null;
  dishKnob = null;
}

export const ch4: Chapter = {
  id: 4,
  title: "Antenna",
  tools(ctx: ChapterCtx): ToolDef[] {
    return [
      {
        name: "read_signal_meter",
        description:
          "HALCYON reads the coarse signal meter; it must wait for the crew's physical antenna alignment to reach LOCK before comms tools can operate.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {},
        },
        readOnly: true,
        execute: () => {
          const error = alignmentError();
          return {
            ok: true,
            human_action: "Crew physically aligns the antenna dish by hand.",
            wait_for: "Wait for band LOCK and comms_online true.",
            data: {
              band:
                error < LOCK_TOLERANCE ? "LOCK" : error < 25 ? "NEAR" : "FAR",
              locked,
              comms_online: ctx.store.get().flags[FLAGS.commsOnline] === true,
            },
          };
        },
      },
    ];
  },
  mount(ctx: ChapterCtx): void {
    resetChapterState();
    const readout = el("div", {
      class: "dish-readout",
      "data-testid": "dish-readout",
      "aria-live": "polite",
    });
    dishStatus = el(
      "p",
      {
        class: "dish-status",
        "data-testid": "dish-status",
        "aria-live": "polite",
      },
      "FAR",
    );
    strengthMeter = el("progress", {
      class: "signal-strength",
      "data-testid": "signal-strength",
      max: "100",
      value: "0",
      "aria-label": "Antenna signal strength",
    });
    lockProgress = el("progress", {
      class: "antenna-lock-progress",
      "data-testid": "antenna-lock-progress",
      max: "100",
      value: "0",
      "aria-label": "Antenna lock hold progress",
    });
    holdStatus = el(
      "p",
      {
        class: "antenna-hold-status",
        "data-testid": "antenna-hold-status",
        "aria-live": "assertive",
      },
      "Sweep slowly. When strength peaks and LOCK appears, hold steady for 1.5 seconds.",
    );
    const knob = el("div", {
      class: "dish-knob",
      "data-testid": "dish-knob",
      tabindex: "0",
      role: "slider",
      "aria-valuemin": "0",
      "aria-valuemax": "100",
      "aria-valuenow": "0",
      "aria-label":
        "Antenna dish signal alignment — physical control, crew hands only; HALCYON must ask the crew, not operate it",
    });
    dishKnob = knob;
    const pad = el(
      "div",
      {
        class: "dish-pad",
        "data-testid": "dish-pad",
        role: "group",
        "aria-label": "Antenna azimuth and elevation control",
      },
      knob,
    );

    let previousStrength = signalStrength();
    let holdResetVisible = false;
    const updateFeedback = (): void => {
      if (locked) return;
      const error = alignmentError();
      const band = signalBand(error);
      const strength = signalStrength(error);
      const trend =
        strength > previousStrength
          ? "RISING"
          : strength < previousStrength
            ? "FALLING"
            : "STEADY";
      previousStrength = strength;
      if (strengthMeter) strengthMeter.value = strength;
      knob.setAttribute("aria-valuenow", String(strength));

      if (band === "LOCK") {
        holdResetVisible = false;
        if (lockStartedAt === null) lockStartedAt = Date.now();
        const progress = Math.min(
          1,
          (Date.now() - lockStartedAt) / T.lockHoldMs,
        );
        if (dishStatus) dishStatus.textContent = "LOCK — hold steady";
        readout.textContent = `Peak signal · ${strength}% · HOLD STEADY`;
        if (lockProgress) lockProgress.value = Math.round(progress * 100);
        if (holdStatus)
          holdStatus.textContent = `Lock hold ${Math.round(progress * 100)}% — keep the dish still.`;
        knob.setAttribute(
          "aria-valuetext",
          `LOCK. Signal strength ${strength} percent. Hold progress ${Math.round(progress * 100)} percent.`,
        );
        if (progress >= 1) lockAntenna(ctx);
        return;
      }

      if (lockStartedAt !== null) {
        lockStartedAt = null;
        holdResetVisible = true;
        if (holdStatus)
          holdStatus.textContent =
            "Lock hold reset: the dish left peak strength. Return to LOCK and hold steady.";
        ctx.recorder.addHuman("Antenna lock hold reset: dish moved off peak.");
      } else if (holdStatus && !holdResetVisible) {
        holdStatus.textContent =
          band === "NEAR"
            ? "NEAR: use small movements or Shift + Arrow keys. Follow rising strength."
            : "FAR: sweep slowly toward rising strength.";
      }
      if (lockProgress) lockProgress.value = 0;
      if (dishStatus) dishStatus.textContent = band;
      readout.textContent =
        band === "NEAR"
          ? `Fine signal · ${strength}% · ${trend}`
          : `AZ ~${Math.round(position.azimuth / 10) * 10}° EL ~${Math.round(position.elevation / 10) * 10}° · FAR · ${strength}%`;
      knob.setAttribute(
        "aria-valuetext",
        `${band}. Signal strength ${strength} percent, ${trend.toLowerCase()}.`,
      );
    };
    const placeKnob = (): void => {
      knob.style.left = `${(position.azimuth / 180) * 100}%`;
      knob.style.top = `${(position.elevation / 90) * 100}%`;
      updateFeedback();
    };
    const moveToPointer = (event: PointerEvent): void => {
      const bounds = pad.getBoundingClientRect();
      position.azimuth = Math.max(
        0,
        Math.min(180, ((event.clientX - bounds.left) / bounds.width) * 180),
      );
      position.elevation = Math.max(
        0,
        Math.min(90, ((event.clientY - bounds.top) / bounds.height) * 90),
      );
      placeKnob();
    };

    let pointerId: number | null = null;
    const pointerDown = (event: PointerEvent): void => {
      if (locked) return;
      pointerId = event.pointerId;
      knob.setPointerCapture?.(event.pointerId);
      moveToPointer(event);
      ctx.audio.click();
    };
    const pointerMove = (event: PointerEvent): void => {
      if (locked || event.pointerId !== pointerId) return;
      moveToPointer(event);
    };
    const pointerUp = (event: PointerEvent): void => {
      if (event.pointerId !== pointerId) return;
      pointerId = null;
    };
    const keyDown = (event: KeyboardEvent): void => {
      if (locked) return;
      const adjustments: Record<
        string,
        readonly ["azimuth" | "elevation", number]
      > = {
        ArrowLeft: ["azimuth", -2],
        ArrowRight: ["azimuth", 2],
        ArrowUp: ["elevation", -2],
        ArrowDown: ["elevation", 2],
      };
      const adjustment = adjustments[event.key];
      if (!adjustment) return;
      event.preventDefault();
      const [axis, coarseDelta] = adjustment;
      const delta = event.shiftKey ? Math.sign(coarseDelta) * 0.5 : coarseDelta;
      const maximum = axis === "azimuth" ? 180 : 90;
      position[axis] = Math.max(0, Math.min(maximum, position[axis] + delta));
      placeKnob();
      ctx.audio.click();
    };

    knob.addEventListener("pointerdown", pointerDown);
    knob.addEventListener("pointermove", pointerMove);
    knob.addEventListener("pointerup", pointerUp);
    knob.addEventListener("pointercancel", pointerUp);
    knob.addEventListener("lostpointercapture", pointerUp);
    knob.addEventListener("keydown", keyDown);
    cleanup.push(() => {
      knob.removeEventListener("pointerdown", pointerDown);
      knob.removeEventListener("pointermove", pointerMove);
      knob.removeEventListener("pointerup", pointerUp);
      knob.removeEventListener("pointercancel", pointerUp);
      knob.removeEventListener("lostpointercapture", pointerUp);
      knob.removeEventListener("keydown", keyDown);
    });

    meterTimer = window.setInterval(() => {
      if (locked) return;
      const error = alignmentError();
      ctx.audio.setStatic(
        Math.min(1, error / 60),
        200 + Math.max(0, 1 - error / 120) * 900,
      );
      updateFeedback();
    }, 100);
    cleanup.push(() => {
      if (meterTimer !== null) window.clearInterval(meterTimer);
      meterTimer = null;
      ctx.audio.stopStatic();
    });

    placeKnob();
    ctx.stage.append(
      el(
        "section",
        { class: "crew-action antenna-crew-action", "data-testid": "crew-action-ch4" },
        el("h2", {}, "CREW ACTION"),
        el(
          "p",
          {},
          "Drag left/right for azimuth and up/down for elevation. Keyboard: Arrow keys; hold Shift for fine steps. Sweep slowly toward rising strength, then hold steady when LOCK appears.",
        ),
      ),
      pad,
      readout,
      el(
        "section",
        { class: "antenna-feedback", "aria-label": "Antenna alignment feedback" },
        dishStatus!,
        el("label", {}, "Signal strength", strengthMeter!),
        el("label", {}, "Lock hold", lockProgress!),
        holdStatus!,
      ),
    );
    ctx.speaker.say(
      "HALCYON reads the coarse meter and operates the comms tools; crew performs the fine physical antenna alignment. My signal meter only says FAR, NEAR, or LOCK. Sweep slowly.",
      "calm",
    );
  },
  unmount(): void {
    resetChapterState();
  },
};
