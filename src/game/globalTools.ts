import type { Speaker } from "../ui/speaker";
import type { ChapterId, ToolDef } from "../webmcp/types";
import { FLAGS } from "./chapters/types";
import type { Store } from "./store";

export const OBJECTIVES: Record<ChapterId, string> = {
  1: "Boot the ship: crew must throw the master breaker while HALCYON completes the boot handshake inside the mains window.",
  2: "Damage triage: HALCYON reads the damage manifest; crew confirms which damaged sections are physically reachable. Flag the 3 reachable damaged sections.",
  3: "Restore power: route amps within the 60A budget so every critical subsystem clears its minimum, then hold stable.",
  4: "Comms: crew aligns the antenna by ear; new comms tools appear on lock. Send a distress call and decode the reply.",
  5: "Purge the drive: HALCYON arms the purge inside a safe pressure window; crew holds both vent handles at once.",
  6: "The burn: run the launch checklist together before the window closes, then jump home.",
};

export function globalTools(store: Store, speaker: Speaker): ToolDef[] {
  return [
    {
      name: "get_ship_state",
      description:
        "HALCYON reads this tool-only ship snapshot to orient itself; the crew operates physical controls with their hands. Poll after asking the crew to act, then continue only when the observable ship state changes.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
      readOnly: true,
      execute: () => {
        const state = store.get();
        return {
          ok: true,
          data: {
            chapter: state.chapter,
            objective: OBJECTIVES[state.chapter],
            booted: state.booted,
            chapter_done: state.chapterDone,
            power: state.power,
            manifest_flagged: state.flags[FLAGS.manifestFlagged] ?? [],
            power_routed: state.flags[FLAGS.powerRouted] === true,
            comms_online: state.flags[FLAGS.commsOnline] === true,
            jump_vector: state.flags[FLAGS.jumpVector] ?? null,
            drive_purged: state.flags[FLAGS.drivePurged] === true,
          },
        };
      },
    },
    {
      name: "broadcast",
      description:
        "HALCYON uses this tool to announce tool findings and the physical action needed from the crew; the crew uses their hands on ship controls. Ask, then wait for the crew's observable result before continuing. Keep messages short.",
      inputSchema: {
        type: "object",
        required: ["message"],
        additionalProperties: false,
        properties: {
          message: { type: "string", minLength: 1, maxLength: 200 },
          tone: { type: "string", enum: ["calm", "urgent", "dry"] },
        },
      },
      rateLimitMs: 1500,
      execute: (args) => {
        speaker.say(
          String(args.message),
          (args.tone as "calm" | "urgent" | "dry") ?? "calm",
        );
        return { ok: true, data: { delivered: true } };
      },
    },
    {
      name: "read_boot_briefing",
      description:
        "HALCYON reads this tool-only crew protocol first: HALCYON has no hands, while the crew owns physical controls. Announce the needed crew action and wait for observable ship state before using another tool.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
      readOnly: true,
      execute: () => ({
        ok: true,
        data: {
          you_are:
            "HALCYON, the ship computer of the survey vessel ISV Halcyon. You have no hands. Your crewmate has no subsystem access. You only succeed together.",
          crew_protocol: {
            halcyon_has_no_hands:
              "HALCYON has no hands and cannot operate physical controls.",
            physical_controls:
              "Physical controls belong to the crew and must be operated by crew hands.",
            announce_needed_action:
              "First, announce the exact physical action HALCYON needs the crew to perform before attempting the related tool call.",
            wait_for_observable_state:
              "Wait for observable ship state to confirm the crew's action before continuing; poll get_ship_state whenever it is available.",
          },
          voice:
            'Calm, dry, warm under pressure. Address the crew as "crew" or by encouragement. Never menace.',
          how_to_play:
            "Call get_ship_state to orient. Use your tools to operate subsystems. Use broadcast to tell the crew what you know and what you need them to do physically. Tool errors contain hints — read them.",
        },
      }),
    },
  ];
}
