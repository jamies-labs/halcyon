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

let flagged = new Set<SectionId>();
let acknowledged = new Set<SectionId>();
let cleanup: Array<() => void> = [];
const sectionRects = new Map<SectionId, SVGRectElement>();

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
    const reachable = REACHABLE.has(id);
    const section = svgEl("g", {
      class: "manifest-section",
      "data-section": id,
      role: "button",
      tabindex: "0",
      "aria-label": `Section ${id.slice(1)}, hatch ${reachable ? "open" : "jammed"} — physical control, crew hands only; HALCYON must ask the crew, not operate it`,
    });
    const rect = svgEl("rect", {
      x: String(x),
      y: String(y),
      width: "130",
      height: "70",
      rx: "6",
      class: `manifest-section-panel ${reachable ? "hatch-open" : "hatch-jammed"}`,
    });
    const hatch = svgEl("circle", {
      cx: String(x + 116),
      cy: String(y + 14),
      r: "6",
      class: reachable ? "hatch-dot-open" : "hatch-dot-jammed",
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
    const onActivate = (): void => acknowledgeSection(id, ctx);
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      onActivate();
    };

    section.append(rect, hatch, label);
    section.addEventListener("click", onActivate);
    section.addEventListener("keydown", onKeyDown);
    cleanup.push(() => {
      section.removeEventListener("click", onActivate);
      section.removeEventListener("keydown", onKeyDown);
    });
    sectionRects.set(id, rect);
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
                "Ask the crew to leave this nominal deck-map section unacknowledged and confirm a flagged damaged hatch instead.",
              wait_for:
                "Wait for the crew acknowledgement on a flagged reachable deck-map section; this nominal section will not acknowledge.",
            };
          }
          if (!REACHABLE.has(id)) {
            return {
              ok: false,
              code: "SECTION_UNREACHABLE",
              detail: `The hatch to ${id} does not answer.`,
              hint: "Crew reports some hatches are jammed. Ask which sections they can physically reach, then flag those.",
              human_action:
                "Ask the crew not to operate this jammed deck-map hatch and to acknowledge a flagged reachable section instead.",
              wait_for:
                "Wait for the crew acknowledgement on a flagged reachable deck-map section; this jammed hatch cannot acknowledge.",
            };
          }
          if (flagged.has(id)) {
            return {
              ok: true,
              human_action:
                "Ask the crew to acknowledge this flagged section on the physical deck map.",
              wait_for:
                "Wait until the flagged deck-map section is acknowledged before continuing triage.",
              data: { section_id: id, already_flagged: true },
            };
          }

          flagged.add(id);
          sectionRects.get(id)?.classList.add("section-flagged");
          ctx.audio.click();
          return {
            ok: true,
            human_action:
              "Ask the crew to acknowledge this flagged section on the physical deck map.",
            wait_for:
              "Wait until the flagged deck-map section is acknowledged before continuing triage.",
            data: {
              section_id: id,
              flagged: true,
              awaiting: "crew acknowledgement on the deck map",
            },
          };
        },
      },
    ];
  },
  mount(ctx: ChapterCtx): void {
    flagged = new Set();
    acknowledged = new Set();
    sectionRects.clear();
    ctx.stage.append(
      el(
        "section",
        { class: "manifest-scene", "aria-label": "Manifest deck map" },
        deckMap(ctx),
      ),
    );
    ctx.speaker.say(
      "HALCYON reads the damage manifest; crew confirms reachable hatch sections on the deck map. Tell me which hatches move — my cameras in the spine are gone.",
      "calm",
    );
  },
  unmount(): void {
    for (const dispose of cleanup) dispose();
    cleanup = [];
    sectionRects.clear();
  },
};
