export const FAST =
  new URLSearchParams(globalThis.location?.search ?? "").get("fast") === "1";

export const T = {
  // Real browser-agent turns routinely take close to a minute. Keep the
  // accelerated retry loop for simulations, but give a human/agent pair time
  // for a full chat round trip before the physical breaker pops.
  mainsWindowMs: FAST ? 2_000 : 120_000,
  fuseSeatMs: FAST ? 150 : 1_000,
  powerStableMs: FAST ? 800 : 10_000,
  lockHoldMs: FAST ? 500 : 1_500,
  replyDelayMs: FAST ? 500 : 2_000,
  armWindowMs: FAST ? 4_000 : 10_000,
  holdMs: FAST ? 600 : 2_000,
  throttleHoldMs: FAST ? 1_000 : 3_000,
  burnCountdownMs: FAST ? 20_000 : 90_000,
  advanceDelayMs: FAST ? 200 : 1_500,
} as const;
