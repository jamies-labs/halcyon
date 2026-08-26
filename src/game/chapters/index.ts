import type { ChapterId } from "../../webmcp/types";
import { ch1 } from "./ch1_contact";
import { ch2 } from "./ch2_manifest";
import { ch3 } from "./ch3_power";
import { ch4 } from "./ch4_antenna";
import { ch5 } from "./ch5_twoman";
import { ch6 } from "./ch6_burn";
import type { Chapter } from "./types";

export const CHAPTERS: Partial<Record<ChapterId, Chapter>> = {
  1: ch1,
  2: ch2,
  3: ch3,
  4: ch4,
  5: ch5,
  6: ch6,
};
