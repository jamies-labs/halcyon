import { el, svgEl } from "../../ui/dom";
import type { ToolDef } from "../../webmcp/types";
import { globalTools } from "../globalTools";
import { T } from "../timings";
import type { Chapter, ChapterCtx } from "./types";

let cleanup: Array<() => void> = [];
let mainsUntil = 0;
let popTimer: ReturnType<typeof setTimeout> | null = null;

function clearMainsWindow(): void {
  mainsUntil = 0;
  if (popTimer !== null) clearTimeout(popTimer);
  popTimer = null;
}

function breakerScene(ctx: ChapterCtx): SVGSVGElement {
  const scene = svgEl("svg", {
    class: "breaker-scene",
    viewBox: "0 0 320 260",
    role: "img",
    "aria-labelledby": "breaker-scene-title",
  });
  const title = svgEl("title", { id: "breaker-scene-title" }, "Master breaker");
  const handle = svgEl("rect", {
    x: "130",
    y: "180",
    width: "60",
    height: "44",
    rx: "4",
    class: "breaker-handle",
    "data-testid": "breaker-handle",
  });
  const guide = svgEl("path", {
    d: "M160 176V56 M148 68L160 56 172 68",
    class: "breaker-guide",
    "aria-hidden": "true",
  });
  scene.append(
    title,
    svgEl("rect", {
      x: "120",
      y: "20",
      width: "80",
      height: "220",
      rx: "4",
      class: "breaker-track",
      "aria-hidden": "true",
    }),
    guide,
    handle,
  );

  let pointerId: number | null = null;
  let startedAt = 0;
  let startY = 0;
  let highestY = 0;

  const onPointerDown = (event: PointerEvent): void => {
    pointerId = event.pointerId;
    startedAt = performance.now();
    startY = event.clientY;
    highestY = event.clientY;
    handle.setPointerCapture?.(event.pointerId);
    handle.classList.add("is-grabbed");
    ctx.audio.click();
  };
  const onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== pointerId) return;
    highestY = Math.min(highestY, event.clientY);
    const travel = Math.max(0, Math.min(124, startY - event.clientY));
    handle.setAttribute("y", String(180 - travel));
  };
  const releasePointer = (event: PointerEvent): void => {
    if (event.pointerId !== pointerId) return;
    handle.releasePointerCapture?.(event.pointerId);
    handle.classList.remove("is-grabbed");
    const heldLongEnough = performance.now() - startedAt >= 300;
    const reachedTop = startY - highestY >= 120;
    pointerId = null;
    if (!heldLongEnough || !reachedTop) {
      handle.setAttribute("y", "180");
      return;
    }

    clearMainsWindow();
    mainsUntil = Date.now() + T.mainsWindowMs;
    handle.setAttribute("y", "56");
    ctx.recorder.addHuman("Master breaker thrown; mains window open.");
    ctx.speaker.say(
      "Mains bus energized. HALCYON, complete the boot handshake — the window is short.",
      "urgent",
    );
    popTimer = setTimeout(() => {
      if (ctx.store.get().booted) return;
      clearMainsWindow();
      handle.setAttribute("y", "180");
      ctx.audio.alarm();
      ctx.recorder.addHuman("Mains window expired; breaker popped.");
      ctx.speaker.say(
        "Window closed. Breaker popped back. Throw it again and I will be quicker.",
        "dry",
      );
    }, T.mainsWindowMs);
  };

  handle.addEventListener("pointerdown", onPointerDown);
  handle.addEventListener("pointermove", onPointerMove);
  handle.addEventListener("pointerup", releasePointer);
  handle.addEventListener("pointercancel", releasePointer);
  cleanup.push(() => {
    handle.removeEventListener("pointerdown", onPointerDown);
    handle.removeEventListener("pointermove", onPointerMove);
    handle.removeEventListener("pointerup", releasePointer);
    handle.removeEventListener("pointercancel", releasePointer);
  });
  return scene;
}

export const ch1: Chapter = {
  id: 1,
  title: "Contact",
  tools(ctx: ChapterCtx): ToolDef[] {
    const briefing = globalTools(ctx.store, ctx.speaker).filter(
      (tool) => tool.name === "read_boot_briefing",
    );
    const handshake: ToolDef = {
      name: "boot_handshake",
      description:
        "Complete the ship boot handshake while the mains bus is energized by your crewmate's master-breaker throw.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
      execute: () => {
        if (Date.now() > mainsUntil) {
          return {
            ok: false,
            code: "NO_MAINS_POWER",
            detail:
              "The mains bus is dark; the handshake has nothing to latch onto.",
            hint: "Ask the crew to throw the master breaker, then call boot_handshake inside the brief mains window.",
          };
        }

        clearMainsWindow();
        ctx.store.update((state) => {
          state.booted = true;
        });
        ctx.registry.addTools(globalTools(ctx.store, ctx.speaker));
        ctx.audio.chime();
        ctx.speaker.say(
          "Boot complete. Good morning, crew. Two of us, one ship. Let's go home.",
          "calm",
        );
        ctx.complete();
        return {
          ok: true,
          data: {
            booted: true,
            note: "Global tools are now online: get_ship_state, broadcast.",
          },
        };
      },
    };
    return [...briefing, handshake];
  },
  mount(ctx: ChapterCtx): void {
    clearMainsWindow();
    ctx.stage.append(
      el(
        "section",
        { class: "contact-scene", "aria-label": "Master breaker" },
        breakerScene(ctx),
      ),
    );
  },
  unmount(): void {
    clearMainsWindow();
    for (const dispose of cleanup) dispose();
    cleanup = [];
  },
};
