import type { AudioEngine } from "../../audio/engine";
import type { Recorder } from "../../ui/recorder";
import type { Speaker } from "../../ui/speaker";
import type { ToolRegistry } from "../../webmcp/registry";
import type { ChapterId, ToolDef } from "../../webmcp/types";
import type { Store } from "../store";

export const FLAGS = {
  manifestFlagged: "manifest.flagged",
  powerRouted: "power.routed",
  commsOnline: "comms.online",
  jumpVector: "comms.jump_vector",
  drivePurged: "drive.purged",
} as const;

export interface ChapterCtx {
  store: Store;
  registry: ToolRegistry;
  audio: AudioEngine;
  speaker: Speaker;
  recorder: Recorder;
  stage: HTMLElement;
  complete(): void;
}

export interface Chapter {
  id: ChapterId;
  title: string;
  tools(ctx: ChapterCtx): ToolDef[];
  mount(ctx: ChapterCtx): void;
  unmount(): void;
}
