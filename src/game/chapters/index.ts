import type { ChapterId } from "../../webmcp/types";
import { ch1 } from "./ch1_contact";
import type { Chapter } from "./types";

export const CHAPTERS: Partial<Record<ChapterId, Chapter>> = { 1: ch1 };
