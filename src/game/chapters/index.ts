import type { ChapterId } from "../../webmcp/types";
import { ch1 } from "./ch1_contact";
import { ch2 } from "./ch2_manifest";
import type { Chapter } from "./types";

export const CHAPTERS: Partial<Record<ChapterId, Chapter>> = { 1: ch1, 2: ch2 };
