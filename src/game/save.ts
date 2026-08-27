import type { ChapterId } from "../webmcp/types";
import { FLAGS } from "./chapters/types";
import type { Store } from "./store";

const KEY = "halcyon.save.v1";
const CHAPTER_IDS: readonly ChapterId[] = [1, 2, 3, 4, 5, 6];

export interface SaveData {
  chapter: ChapterId;
  chapterDone: Record<ChapterId, boolean>;
}

function isChapterId(value: unknown): value is ChapterId {
  return typeof value === "number" && CHAPTER_IDS.includes(value as ChapterId);
}

function isChapterDone(value: unknown): value is Record<ChapterId, boolean> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === CHAPTER_IDS.length &&
    CHAPTER_IDS.every((chapter) => typeof record[String(chapter)] === "boolean")
  );
}

function isSaveData(value: unknown): value is SaveData {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === 2 &&
    isChapterId(record.chapter) &&
    isChapterDone(record.chapterDone)
  );
}

export function loadSave(): SaveData | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return null;
    const data: unknown = JSON.parse(raw);
    return isSaveData(data) ? data : null;
  } catch {
    return null;
  }
}

/** Rebuild only the prerequisites proved by the persisted completed chapters. */
export function restoreCampaign(store: Store, saved: SaveData): void {
  store.update((state) => {
    state.chapter = saved.chapter;
    state.campaignChapter = saved.chapter;
    state.chapterDone = { ...saved.chapterDone };
    state.booted = saved.chapterDone[1];
    if (saved.chapterDone[2]) {
      state.flags[FLAGS.manifestFlagged] = ["s2", "s4", "s5"];
    }
    if (saved.chapterDone[3]) {
      state.power = {
        life_support: 18,
        comms: 8,
        drive: 14,
        sensors: 6,
        lights: 4,
        heaters: 0,
      };
      state.flags[FLAGS.powerRouted] = true;
    }
    if (saved.chapterDone[4]) {
      state.flags[FLAGS.commsOnline] = true;
      state.flags[FLAGS.jumpVector] = { x: 0.42, y: -1.07, z: 3.14 };
    }
    if (saved.chapterDone[5]) state.flags[FLAGS.drivePurged] = true;
  });
}

export function bindAutosave(store: Store, enabled = true): void {
  if (!enabled) return;
  store.subscribe((state) => {
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify({
          chapter: state.campaignChapter,
          chapterDone: state.chapterDone,
        }),
      );
    } catch {
      // Storage can be unavailable in privacy-restricted browser sessions.
    }
  });
}
