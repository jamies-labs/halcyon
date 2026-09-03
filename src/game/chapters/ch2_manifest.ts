import { el, svgEl } from "../../ui/dom";
import type { ToolDef } from "../../webmcp/types";
import { FLAGS, type Chapter, type ChapterCtx } from "./types";

const SECTIONS = ["s1", "s2", "s3", "s4", "s5", "s6"] as const;
type SectionId = (typeof SECTIONS)[number];

const DAMAGE: Record<SectionId, string | null> = {
  s1: null,
  s2: "coolant line rupture",
  s3: null,
  s4: "junction burnout",
  s5: "frame stress fracture",
  s6: "hull breach — sensor ghosting",
};
const REACHABLE = new Set<SectionId>(["s1", "s2", "s4", "s5"]);
const TARGET_SECTIONS = new Set<SectionId>(["s2", "s4", "s5"]);
type HatchResult = "MOVES" | "JAMMED";

let flagged = new Set<SectionId>();
let acknowledged = new Set<SectionId>();
let tested = new Map<SectionId, HatchResult>();
let cleanup: Array<() => void> = [];
const sectionRects = new Map<SectionId, SVGRectElement>();
const sectionGroups = new Map<SectionId, SVGGElement>();
const sectionDots = new Map<SectionId, SVGCircleElement>();
const sectionStatuses = new Map<SectionId, SVGTextElement>();

function sectionLabel(id: SectionId, result = tested.get(id)): string {
  const state = result ?? "UNTESTED";
  const action = result
    ? "Result recorded. Report jammed section numbers to your agent chat."
    : "Tap once to test this hatch.";
  return `Section ${id.slice(1)}, ${state}. ${action} — physical control, crew hands only; HALCYON must ask the crew, not operate it.`;
}

function acknowledgeSection(id: SectionId, ctx: ChapterCtx): void {
  if (!flagged.has(id) || acknowledged.has(id)) return;

  acknowledged.add(id);
  sectionRects.get(id)?.classList.add("section-acknowledged");
  ctx.audio.click();
  ctx.recorder.addHuman(`Section ${id} acknowledged on the deck map.`);

  if (![...TARGET_SECTIONS].every((target) => acknowledged.has(target))) return;

  ctx.store.update((state) => {
    state.flags[FLAGS.manifestFlagged] = ["s2", "s4", "s5"];
  });
  ctx.speaker.say(
    "HALCYON flagged the manifest; crew deck-map confirmation is complete. Triage locked: s2, s4, s5 — s6 will have to wait for a bigger crowbar.",
    "calm",
  );
  ctx.complete();
}

function testSection(id: SectionId, ctx: ChapterCtx): void {
  const result: HatchResult = REACHABLE.has(id) ? "MOVES" : "JAMMED";
  if (!tested.has(id)) {
    tested.set(id, result);
    const status = sectionStatuses.get(id);
    if (status) status.textContent = result;
    const dot = sectionDots.get(id);
    dot?.classList.remove("hatch-dot-untested");
    dot?.classList.add(
      result === "MOVES" ? "hatch-dot-open" : "hatch-dot-jammed",
    );
    sectionGroups.get(id)?.setAttribute("aria-label", sectionLabel(id, result));
    ctx.audio.click();
    ctx.recorder.addHuman(`Hatch ${id.toUpperCase()} tested: ${result}.`);
    ctx.speaker.say(
      `${id.toUpperCase()} ${result}. Test the remaining hatches, then tell me here which sections are jammed.`,
      result === "JAMMED" ? "urgent" : "calm",
    );
  }
  acknowledgeSection(id, ctx);
}

function deckMap(ctx: ChapterCtx): SVGSVGElement {
  const scene = svgEl("svg", {
    class: "manifest-map",
    viewBox: "0 0 480 200",
    role: "group",
    "aria-label": "Deck map of six hatch sections",
  });

  for (const [index, id] of SECTIONS.entries()) {
    const x = 20 + (index % 3) * 150;
    const y = 20 + Math.floor(index / 3) * 90;
    const section = svgEl("g", {
      class: "manifest-section",
      "data-section": id,
      role: "button",
      tabindex: "0",
      "aria-label": sectionLabel(id),
    });
    const rect = svgEl("rect", {
      x: String(x),
      y: String(y),
      width: "130",
      height: "70",
      rx: "6",
      class: "manifest-section-panel",
    });
    const hatch = svgEl("circle", {
      cx: String(x + 116),
      cy: String(y + 14),
      r: "6",
      class: "hatch-dot-untested",
      "aria-hidden": "true",
    });
    const label = svgEl(
      "text",
      {
        x: String(x + 12),
        y: String(y + 40),
        class: "manifest-section-label",
        "aria-hidden": "true",
      },
      id.toUpperCase(),
    );
    const status = svgEl(
      "text",
      {
        x: String(x + 12),
        y: String(y + 60),
        class: "manifest-section-status",
        "data-testid": `hatch-state-${id}`,
        "aria-hidden": "true",
      },
      "UNTESTED",
    );
    const onActivate = (): void => testSection(id, ctx);
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      onActivate();
    };

    section.append(rect, hatch, label, status);
    section.addEventListener("click", onActivate);
    section.addEventListener("keydown", onKeyDown);
    cleanup.push(() => {
      section.removeEventListener("click", onActivate);
      section.removeEventListener("keydown", onKeyDown);
    });
    sectionRects.set(id, rect);
    sectionGroups.set(id, section);
    sectionDots.set(id, hatch);
    sectionStatuses.set(id, status);
    scene.append(section);
  }

  return scene;
}

export const ch2: Chapter = {
  id: 2,
  title: "Manifest",
  tools(ctx: ChapterCtx): ToolDef[] {
    return [
      {
        name: "read_damage_manifest",
        description:
          "HALCYON reads the internal damage manifest and flags damaged sections; the crew physically confirms reachable hatch sections on the deck map.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {},
        },
        readOnly: true,
        execute: () => ({
          ok: true,
          data: {
            sections: SECTIONS.map((id) => ({
              section_id: id,
              status: DAMAGE[id] === null ? "nominal" : "damaged",
              note: DAMAGE[id] ?? "all readings nominal",
            })),
          },
        }),
      },
      {
        name: "flag_section",
        description:
          "HALCYON flags a damaged hull section for repair triage; the crew physically confirms that reachable hatch section on the deck map.",
        inputSchema: {
          type: "object",
          required: ["section_id", "priority"],
          additionalProperties: false,
          properties: {
            section_id: { type: "string", enum: [...SECTIONS] },
            priority: { type: "integer", minimum: 1, maximum: 3 },
          },
        },
        execute: (args) => {
          const id = args.section_id as SectionId;
          if (DAMAGE[id] === null) {
            return {
              ok: false,
              code: "SECTION_NOMINAL",
              detail: `Section ${id} reports all readings nominal.`,
              hint: "Cross-check read_damage_manifest — only damaged sections need triage.",
              human_action:
                "Ask the crew to acknowledge a flagged reachable section on the physical deck map; this nominal section must stay unacknowledged.",
              wait_for:
                "Wait until a flagged reachable deck-map section is acknowledged before continuing triage.",
              state_consequence:
                "No triage flag was added; the nominal section remains unacknowledged.",
            };
          }
          if (!REACHABLE.has(id)) {
            return {
              ok: false,
              code: "SECTION_UNREACHABLE",
              detail: `The hatch to ${id} does not answer.`,
              hint: "Crew reports some hatches are jammed. Ask which sections they can physically reach, then flag those.",
              human_action:
                "Ask the crew to acknowledge a flagged reachable section on the physical deck map; this jammed hatch cannot be operated.",
              wait_for:
                "Wait until a flagged reachable deck-map section is acknowledged before continuing triage.",
              state_consequence:
                "No triage flag was added; the jammed hatch remains unreachable.",
            };
          }
          if (flagged.has(id)) {
            const alreadyAcknowledged = acknowledged.has(id);
            return {
              ok: true,
              human_action: alreadyAcknowledged
                ? "No repeated crew action is needed; the earlier physical hatch test already acknowledged this section."
                : "Ask the crew to acknowledge this flagged section on the physical deck map.",
              wait_for: alreadyAcknowledged
                ? "This section is already acknowledged; continue triage with the remaining damaged reachable sections."
                : "Wait until the flagged deck-map section is acknowledged before continuing triage.",
              state_consequence: alreadyAcknowledged
                ? "The section remains flagged and acknowledged; no ship state changed."
                : "The section remains flagged and awaits crew acknowledgement on the deck map.",
              data: {
                section_id: id,
                already_flagged: true,
                acknowledged: alreadyAcknowledged,
              },
            };
          }

          flagged.add(id);
          sectionRects.get(id)?.classList.add("section-flagged");
          ctx.audio.click();
          const priorCrewTestApplied = tested.get(id) === "MOVES";
          if (priorCrewTestApplied) acknowledgeSection(id, ctx);
          return {
            ok: true,
            human_action: priorCrewTestApplied
              ? "No repeated crew action is needed; HALCYON applied the crew's earlier physical hatch test to this flag."
              : "Ask the crew to acknowledge this flagged section on the physical deck map.",
            wait_for: priorCrewTestApplied
              ? "The earlier crew test acknowledged this section; continue triage with the remaining damaged reachable sections."
              : "Wait until the flagged deck-map section is acknowledged before continuing triage.",
            state_consequence: priorCrewTestApplied
              ? "The section is flagged and acknowledged from the crew's earlier physical hatch test."
              : "The section is flagged and awaits crew acknowledgement on the deck map.",
            data: {
              section_id: id,
              flagged: true,
              acknowledged: priorCrewTestApplied,
              ...(priorCrewTestApplied
                ? { applied: "earlier crew hatch test" }
                : { awaiting: "crew acknowledgement on the deck map" }),
            },
          };
        },
      },
    ];
  },
  mount(ctx: ChapterCtx): void {
    flagged = new Set();
    acknowledged = new Set();
    tested = new Map();
    sectionRects.clear();
    sectionGroups.clear();
    sectionDots.clear();
    sectionStatuses.clear();
    ctx.stage.append(
      el(
        "section",
        {
          class: "crew-action manifest-crew-action",
          "data-testid": "crew-action-ch2",
          "aria-labelledby": "ch2-crew-action-title",
        },
        el("h2", { id: "ch2-crew-action-title" }, "CREW ACTION"),
        el(
          "p",
          {},
          "Tap S1-S6 once. Working hatches show MOVES; stuck hatches show JAMMED. Then reply to your agent chat with the jammed section numbers.",
        ),
        el(
          "p",
          { class: "manifest-legend", "aria-label": "Hatch result legend" },
          "UNTESTED = not checked · MOVES = working · JAMMED = stuck",
        ),
      ),
      el(
        "section",
        { class: "manifest-scene", "aria-label": "Manifest deck map" },
        deckMap(ctx),
      ),
    );
    ctx.speaker.say(
      "Crew, tap every hatch once, then tell me here which sections are jammed. I will update the manifest.",
      "calm",
    );
  },
  unmount(): void {
    for (const dispose of cleanup) dispose();
    cleanup = [];
    sectionRects.clear();
    sectionGroups.clear();
    sectionDots.clear();
    sectionStatuses.clear();
  },
};
