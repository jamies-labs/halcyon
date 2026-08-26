export const FAST =
  new URLSearchParams(globalThis.location?.search ?? "").get("fast") === "1";

export const T = {
  mainsWindowMs: FAST ? 2_000 : 5_000,
  fuseSeatMs: FAST ? 150 : 600,
  powerStableMs: FAST ? 800 : 10_000,
  lockHoldMs: FAST ? 500 : 1_500,
  replyDelayMs: FAST ? 500 : 2_000,
  armWindowMs: FAST ? 4_000 : 10_000,
  holdMs: FAST ? 600 : 2_000,
  burnCountdownMs: FAST ? 20_000 : 90_000,
  advanceDelayMs: FAST ? 200 : 1_500,
} as const;
