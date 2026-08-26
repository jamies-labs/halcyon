import type { ChapterId } from "../webmcp/types";
import type { Store } from "./store";

const KEY = "halcyon.save.v1";
const CHAPTER_IDS: readonly ChapterId[] = [1, 2, 3, 4, 5, 6];

interface SaveData {
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

export function bindAutosave(store: Store): void {
  store.subscribe((state) => {
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify({
          chapter: state.chapter,
          chapterDone: state.chapterDone,
        }),
      );
    } catch {
      // Storage can be unavailable in privacy-restricted browser sessions.
    }
  });
}
