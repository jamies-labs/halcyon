import { expect, test, type Page } from "@playwright/test";
import { recoverDecoderFromToolResults } from "./commsRecovery";

const CREW_ONLY =
  "physical control, crew hands only; HALCYON must ask the crew, not operate it";
const MINIMUM_ROUTE = [
  { subsystem: "life_support", amps: 18 },
  { subsystem: "comms", amps: 8 },
  { subsystem: "sensors", amps: 6 },
  { subsystem: "lights", amps: 4 },
  { subsystem: "drive", amps: 14 },
];
const JUMP_VECTOR = { x: 0.42, y: -1.07, z: 3.14 };

type Outcome = {
  ok: boolean;
  code?: string;
  human_action?: unknown;
  wait_for?: unknown;
};

type Invocation = { outcome: Outcome };

async function invoke(
  page: Page,
  name: string,
  args: unknown = {},
): Promise<Invocation> {
  return (await page.evaluate(
    ([tool, input]) => window.halcyonSim.invoke(tool, input),
    [name, args],
  )) as Invocation;
}

function expectCrewHandoff(label: string, invocation: Invocation): void {
  expect(
    typeof invocation.outcome.human_action,
    `${label} must expose a string human_action`,
  ).toBe("string");
  expect(
    (invocation.outcome.human_action as string).trim(),
    `${label} human_action must not be blank`,
  ).not.toBe("");
  expect(
    typeof invocation.outcome.wait_for,
    `${label} must expose a string wait_for`,
  ).toBe("string");
  expect(
    (invocation.outcome.wait_for as string).trim(),
    `${label} wait_for must not be blank`,
  ).not.toBe("");
}

async function holdFor(
  page: Page,
  selector: string,
  durationMs: number,
): Promise<void> {
  const target = page.locator(selector);
  const box = await target.boundingBox();
  expect(box, `${selector} must be a visible physical control`).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(durationMs);
  await page.mouse.up();
}

async function boot(page: Page): Promise<Invocation> {
  const handle = page.getByTestId("breaker-handle");
  const box = await handle.boundingBox();
  expect(box, "Chapter 1 must render its physical breaker").not.toBeNull();
  const x = box!.x + box!.width / 2;
  const y = box!.y + box!.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 140, { steps: 8 });
  await page.waitForTimeout(320);
  await page.mouse.up();
  return invoke(page, "boot_handshake");
}

async function seatFuses(page: Page): Promise<void> {
  for (const subsystem of [
    "life_support",
    "comms",
    "sensors",
    "lights",
    "drive",
  ]) {
    await holdFor(page, `[data-fuse=${subsystem}]`, 200);
  }
}

async function alignDish(page: Page): Promise<void> {
  const pad = await page.getByTestId("dish-pad").boundingBox();
  const knob = await page.getByTestId("dish-knob").boundingBox();
  expect(pad, "Chapter 4 must render the dish pad").not.toBeNull();
  expect(knob, "Chapter 4 must render the dish knob").not.toBeNull();
  await page.mouse.move(knob!.x + knob!.width / 2, knob!.y + knob!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    pad!.x + (137 / 180) * pad!.width,
    pad!.y + (42 / 90) * pad!.height,
    { steps: 10 },
  );
  await page.mouse.up();
  await page.waitForTimeout(600);
}

async function armPurgeWhenUnsafe(page: Page): Promise<Invocation> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await invoke(page, "arm_purge");
    if (response.outcome.code === "PRESSURE_OUT_OF_BAND") return response;
    expect(
      response.outcome.ok,
      `arm attempt ${attempt + 1} must either arm or coach for pressure`,
    ).toBe(true);
    await page.waitForTimeout(50);
  }
  throw new Error("arm_purge never returned PRESSURE_OUT_OF_BAND");
}

test("default_route_rejects_forward_seeding", async ({ page }) => {
  await page.goto("/?ch=6");
  const defaultState = await page.evaluate(() => window.halcyonSim.getState());
  expect(defaultState.chapter, "default ?ch=6 must remain at Chapter 1").toBe(
    1,
  );
  expect(
    defaultState.flags["drive.purged"],
    "default ?ch=6 must not grant the Chapter 5 purge",
  ).toBe(false);
  await expect(page.getByTestId("goto-ch6")).toBeDisabled();

  await page.goto("/?sim=1&ch=6");
  const simulatorState = await page.evaluate(() =>
    window.halcyonSim.getState(),
  );
  expect(
    simulatorState.chapter,
    "explicit simulator mode must seed Chapter 6",
  ).toBe(6);
  expect(
    simulatorState.flags["drive.purged"],
    "Chapter 6 simulator seed must include its required purge",
  ).toBe(true);
});

test("all_physical_controls_are_crew_only", async ({ page }) => {
  const controls = [
    {
      route: "/?fast=1&sim=1&ch=1",
      selector: "[data-testid=breaker-handle]",
      count: 1,
    },
    { route: "/?fast=1&sim=1&ch=2", selector: "[data-section]", count: 6 },
    {
      route: "/?fast=1&sim=1&ch=4",
      selector: "[data-testid=dish-knob]",
      count: 1,
    },
    {
      route: "/?fast=1&sim=1&ch=5",
      selector: "[data-testid=vent-left], [data-testid=vent-right]",
      count: 2,
    },
    {
      route: "/?fast=1&sim=1&ch=6",
      selector:
        "[data-testid=inject-tap], [data-testid=shutter-left], [data-testid=shutter-right], [data-testid=throttle]",
      count: 4,
    },
  ] as const;

  for (const control of controls) {
    await page.goto(control.route);
    const targets = page.locator(control.selector);
    await expect(targets, `${control.route} physical controls`).toHaveCount(
      control.count,
    );
    for (let index = 0; index < control.count; index += 1) {
      await expect(targets.nth(index)).toHaveAccessibleName(
        new RegExp(CREW_ONLY),
      );
    }
  }

  await page.goto("/?fast=1&sim=1&ch=3");
  expect(
    (await invoke(page, "route_power", { allocations: MINIMUM_ROUTE })).outcome
      .ok,
    "the production power route must create the Chapter 3 physical fuse controls",
  ).toBe(true);
  const fuses = page.locator("[data-fuse]");
  await expect(fuses).toHaveCount(5);
  for (let index = 0; index < 5; index += 1) {
    await expect(fuses.nth(index)).toHaveAccessibleName(new RegExp(CREW_ONLY));
  }
});

test("all_gate_outcomes_carry_crew_handoff_fields", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/?fast=1&sim=1");

  const noMains = await invoke(page, "boot_handshake");
  expect(noMains.outcome.code).toBe("NO_MAINS_POWER");
  const booted = await boot(page);
  expect(booted.outcome.ok).toBe(true);
  await expect
    .poll(() => page.evaluate(() => window.halcyonSim.getState().chapter))
    .toBe(2);

  const nominalSection = await invoke(page, "flag_section", {
    section_id: "s1",
    priority: 1,
  });
  expect(nominalSection.outcome.code).toBe("SECTION_NOMINAL");
  const flaggedSection = await invoke(page, "flag_section", {
    section_id: "s2",
    priority: 1,
  });
  expect(flaggedSection.outcome.ok).toBe(true);
  for (const sectionId of ["s2", "s4", "s5"]) {
    if (sectionId !== "s2") {
      expect(
        (
          await invoke(page, "flag_section", {
            section_id: sectionId,
            priority: 1,
          })
        ).outcome.ok,
      ).toBe(true);
    }
    await page.locator(`[data-section=${sectionId}]`).click();
  }
  await expect
    .poll(() => page.evaluate(() => window.halcyonSim.getState().chapter))
    .toBe(3);

  const overBudget = await invoke(page, "route_power", {
    allocations: [
      { subsystem: "life_support", amps: 40 },
      { subsystem: "drive", amps: 40 },
    ],
  });
  expect(overBudget.outcome.code).toBe("OVER_BUDGET");
  const routed = await invoke(page, "route_power", {
    allocations: MINIMUM_ROUTE,
  });
  expect(routed.outcome.ok).toBe(true);
  await seatFuses(page);
  await expect
    .poll(() => page.evaluate(() => window.halcyonSim.getState().chapter))
    .toBe(4);

  const farMeter = await invoke(page, "read_signal_meter");
  await alignDish(page);
  const lockedMeter = await invoke(page, "read_signal_meter");
  expect(lockedMeter.outcome.ok).toBe(true);
  expect(
    (
      await invoke(page, "send_distress", {
        message: "ISV Halcyon requesting vector home.",
      })
    ).outcome.ok,
  ).toBe(true);
  const noReply = await invoke(page, "decode_reply");
  expect(noReply.outcome.code).toBe("NO_REPLY_YET");
  await page.waitForTimeout(600);
  const decoded = await recoverDecoderFromToolResults(page, (name, args) =>
    invoke(page, name, args),
  );
  expect(decoded.outcome.ok).toBe(true);
  await expect
    .poll(() => page.evaluate(() => window.halcyonSim.getState().chapter))
    .toBe(5);

  const pressureMiss = await armPurgeWhenUnsafe(page);
  expect(pressureMiss.outcome.code).toBe("PRESSURE_OUT_OF_BAND");
  let armed: Invocation | undefined;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = await invoke(page, "arm_purge");
    if (candidate.outcome.ok) {
      armed = candidate;
      break;
    }
    expect(candidate.outcome.code).toBe("PRESSURE_OUT_OF_BAND");
    await page.waitForTimeout(50);
  }
  expect(
    armed,
    "a fast pressure cycle must eventually arm the purge",
  ).toBeDefined();
  await page.getByTestId("vent-left").hover();
  await page.mouse.down();
  await page.keyboard.down("Space");
  try {
    await expect
      .poll(() => page.evaluate(() => window.halcyonSim.getState().chapter))
      .toBe(6);
  } finally {
    await page.keyboard.up("Space");
    await page.mouse.up();
  }

  const pressBeforeVector = await invoke(page, "pressurize_injectors");
  expect(pressBeforeVector.outcome.code).toBe("SEQUENCE_ORDER");
  const wrongVector = await invoke(page, "set_jump_vector", {
    x: 1,
    y: 2,
    z: 3,
  });
  expect(wrongVector.outcome.code).toBe("VECTOR_MISMATCH");
  const vector = await invoke(page, "set_jump_vector", JUMP_VECTOR);
  expect(vector.outcome.ok).toBe(true);
  const pressurized = await invoke(page, "pressurize_injectors");
  expect(pressurized.outcome.ok).toBe(true);
  const precheckBeforeCrewWork = await invoke(page, "ignite_precheck");
  expect(precheckBeforeCrewWork.outcome.code).toBe("NOT_READY");
  for (let tap = 0; tap < 4; tap += 1) {
    await page.getByTestId("inject-tap").click();
    await page.waitForTimeout(120);
  }
  await holdFor(page, "[data-testid=shutter-left]", 300);
  await holdFor(page, "[data-testid=shutter-right]", 300);
  const precheckGo = await invoke(page, "ignite_precheck");
  expect(precheckGo.outcome.ok).toBe(true);
  const jumpBeforeThrottle = await invoke(page, "execute_jump");
  expect(jumpBeforeThrottle.outcome.code).toBe("NOT_READY");
  await holdFor(page, "[data-testid=throttle]", 1_400);
  const jumped = await invoke(page, "execute_jump");
  expect(jumped.outcome.ok).toBe(true);

  for (const [label, response] of [
    ["boot failure", noMains],
    ["boot success", booted],
    ["manifest failure", nominalSection],
    ["manifest success", flaggedSection],
    ["power failure", overBudget],
    ["power success", routed],
    ["antenna before lock", farMeter],
    ["antenna after lock", lockedMeter],
    ["purge failure", pressureMiss],
    ["purge success", armed!],
    ["burn pressurize failure", pressBeforeVector],
    ["burn vector failure", wrongVector],
    ["burn vector success", vector],
    ["burn pressurize success", pressurized],
    ["burn precheck failure", precheckBeforeCrewWork],
    ["burn precheck success", precheckGo],
    ["burn jump failure", jumpBeforeThrottle],
    ["burn jump success", jumped],
  ] as const) {
    expectCrewHandoff(label, response);
  }
});
