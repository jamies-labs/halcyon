import { expect, test, type Page } from "@playwright/test";
import { recoverDecoderFromToolResults } from "./commsRecovery";

type Invocation = {
  outcome: {
    ok: boolean;
    code?: string;
    human_action?: unknown;
    wait_for?: unknown;
  };
};

const JUMP_VECTOR = { x: 0.42, y: -1.07, z: 3.14 };
const MINIMUM_ROUTE = [
  { subsystem: "life_support", amps: 18 },
  { subsystem: "comms", amps: 8 },
  { subsystem: "sensors", amps: 6 },
  { subsystem: "lights", amps: 4 },
  { subsystem: "drive", amps: 14 },
];

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

function expectCrewHandoff(label: string, response: Invocation): void {
  expect(
    typeof response.outcome.human_action,
    `${label} must name the crew action`,
  ).toBe("string");
  expect(
    (response.outcome.human_action as string).trim().length,
    `${label} human_action must be non-empty`,
  ).toBeGreaterThan(0);
  expect(
    typeof response.outcome.wait_for,
    `${label} must name the observable wait condition`,
  ).toBe("string");
  expect(
    (response.outcome.wait_for as string).trim().length,
    `${label} wait_for must be non-empty`,
  ).toBeGreaterThan(0);
}

async function holdFor(
  page: Page,
  selector: string,
  ms: number,
): Promise<void> {
  const box = await page.locator(selector).boundingBox();
  expect(box, `${selector} must be a physical target`).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

async function boot(page: Page): Promise<Invocation> {
  const handle = page.getByTestId("breaker-handle");
  const box = await handle.boundingBox();
  expect(box, "breaker handle must be available in Chapter 1").not.toBeNull();
  const x = box!.x + box!.width / 2;
  const y = box!.y + box!.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 8; step += 1) {
    await page.mouse.move(x, y - (160 * step) / 8);
    await page.waitForTimeout(60);
  }
  await page.mouse.up();
  const handshake = await invoke(page, "boot_handshake");
  expect(handshake.outcome.ok).toBe(true);
  await expect
    .poll(() => page.evaluate(() => window.halcyonSim.getState().chapter))
    .toBe(2);
  return handshake;
}

async function triageManifest(page: Page): Promise<Invocation[]> {
  const triage = [] as Invocation[];
  for (const sectionId of ["s2", "s4", "s5"]) {
    const flagged = await invoke(page, "flag_section", {
      section_id: sectionId,
      priority: 1,
    });
    expect(
      flagged.outcome.ok,
      `${sectionId} must be triaged by the agent before crew acknowledgement`,
    ).toBe(true);
    triage.push(flagged);
    await page.locator(`[data-section="${sectionId}"]`).click();
  }
  await expect
    .poll(() =>
      page.evaluate(() => window.halcyonSim.getState().chapterDone[2]),
    )
    .toBe(true);
  return triage;
}

async function routePower(page: Page): Promise<Invocation> {
  const routed = await invoke(page, "route_power", {
    allocations: MINIMUM_ROUTE,
  });
  expect(routed.outcome.ok).toBe(true);
  for (const subsystem of [
    "life_support",
    "comms",
    "sensors",
    "lights",
    "drive",
  ]) {
    await holdFor(page, `[data-fuse="${subsystem}"]`, 200);
  }
  await expect
    .poll(() =>
      page.evaluate(() => window.halcyonSim.getState().chapterDone[3]),
    )
    .toBe(true);
  return routed;
}

async function alignAndDecode(page: Page): Promise<void> {
  const pad = await page.getByTestId("dish-pad").boundingBox();
  const knob = await page.getByTestId("dish-knob").boundingBox();
  expect(pad, "dish pad must be available in Chapter 4").not.toBeNull();
  expect(knob, "dish knob must be available in Chapter 4").not.toBeNull();
  await page.mouse.move(knob!.x + knob!.width / 2, knob!.y + knob!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    pad!.x + (137 / 180) * pad!.width,
    pad!.y + (42 / 90) * pad!.height,
    { steps: 10 },
  );
  await page.mouse.up();
  await page.waitForTimeout(800);
  expect(
    (
      await invoke(page, "send_distress", {
        message: "ISV Halcyon requesting vector home.",
      })
    ).outcome.ok,
  ).toBe(true);
  await page.waitForTimeout(700);
  const decoded = await recoverDecoderFromToolResults(page, (name, args) =>
    invoke(page, name, args),
  );
  expect(decoded.outcome.data).toMatchObject({
    decoded: { jump_vector: JUMP_VECTOR },
  });
  await expect
    .poll(() =>
      page.evaluate(() => window.halcyonSim.getState().chapterDone[4]),
    )
    .toBe(true);
  const visibleText = await page.locator("body").textContent();
  expect(visibleText).not.toContain("0.42");
  expect(visibleText).not.toContain("-1.07");
  expect(visibleText).not.toContain("3.14");
}

async function purgeDrive(page: Page): Promise<Invocation> {
  let armed: Invocation | undefined;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const arm = await invoke(page, "arm_purge");
    if (arm.outcome.ok) {
      armed = arm;
      break;
    }
    expect(arm.outcome.code, "arm_purge must only wait for pressure").toBe(
      "PRESSURE_OUT_OF_BAND",
    );
    expectCrewHandoff(`arm_purge pressure wait ${attempt + 1}`, arm);
    await page.waitForTimeout(50);
    if (attempt === 99) {
      throw new Error("arm_purge never opened its configured pressure window");
    }
  }
  if (!armed) throw new Error("arm_purge did not return an armed response");
  const box = await page.getByTestId("vent-left").boundingBox();
  expect(box, "left vent must be available in Chapter 5").not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.keyboard.down("Space");
  try {
    await expect
      .poll(() =>
        page.evaluate(() => window.halcyonSim.getState().chapterDone[5]),
      )
      .toBe(true);
  } finally {
    await page.keyboard.up("Space");
    await page.mouse.up();
  }
  return armed;
}

async function burnHome(page: Page): Promise<Invocation[]> {
  const vector = await invoke(page, "set_jump_vector", JUMP_VECTOR);
  expect(vector.outcome.ok).toBe(true);
  const pressurize = await invoke(page, "pressurize_injectors");
  expect(pressurize.outcome.ok).toBe(true);
  for (let tap = 0; tap < 4; tap += 1) {
    await page.getByTestId("inject-tap").click();
    await page.waitForTimeout(120);
  }
  await holdFor(page, "[data-testid=shutter-left]", 300);
  await holdFor(page, "[data-testid=shutter-right]", 300);
  const precheck = await invoke(page, "ignite_precheck");
  expect(precheck.outcome.ok).toBe(true);
  await holdFor(page, "[data-testid=throttle]", 1_400);
  const jump = await invoke(page, "execute_jump");
  expect(jump.outcome.ok).toBe(true);
  return [vector, pressurize, precheck, jump];
}

async function completeSixChapterRun(
  page: Page,
  route: string,
  startsAtGate = false,
): Promise<void> {
  await page.goto(route);
  if (startsAtGate) await page.getByTestId("gate-start").click();
  const bootResponse = await boot(page);
  const triageResponses = await triageManifest(page);
  await expect
    .poll(() => page.evaluate(() => window.halcyonSim.getState().chapter))
    .toBe(3);
  const routeResponse = await routePower(page);
  await expect
    .poll(() => page.evaluate(() => window.halcyonSim.getState().chapter))
    .toBe(4);
  await alignAndDecode(page);
  await expect
    .poll(() => page.evaluate(() => window.halcyonSim.getState().chapter))
    .toBe(5);
  const purgeResponse = await purgeDrive(page);
  await expect
    .poll(() => page.evaluate(() => window.halcyonSim.getState().chapter))
    .toBe(6);
  const burnResponses = await burnHome(page);
  for (const [label, response] of [
    ["boot_handshake", bootResponse],
    ["flag_section s2", triageResponses[0]!],
    ["flag_section s4", triageResponses[1]!],
    ["flag_section s5", triageResponses[2]!],
    ["route_power", routeResponse],
    ["arm_purge", purgeResponse],
    ["set_jump_vector", burnResponses[0]!],
    ["pressurize_injectors", burnResponses[1]!],
    ["ignite_precheck", burnResponses[2]!],
    ["execute_jump", burnResponses[3]!],
  ] as const) {
    expectCrewHandoff(label, response);
  }
  expect(
    await page.evaluate(() => window.halcyonSim.getState().chapterDone[6]),
    "the real full sequence must mark Chapter 6 complete",
  ).toBe(true);
  await expect(page.getByTestId("victory-card")).toBeVisible();
  await expect(page.getByTestId("replay-timeline")).toContainText(
    "execute_jump",
  );
}

test("training_full_run_marks_the_victory_card", async ({ page }) => {
  test.setTimeout(180_000);
  await completeSixChapterRun(page, "/?fast=1&sim=1");
  await expect(page.getByTestId("victory-card")).toContainText(
    "TRAINING SIMULATION",
  );
});

test("training_full_run_marks_the_replay", async ({ page }) => {
  test.setTimeout(180_000);
  await completeSixChapterRun(page, "/?fast=1&sim=1");
  await expect(page.getByTestId("replay-timeline")).toContainText(
    "TRAINING SIMULATION",
  );
  await expect(page.getByTestId("replay-timeline")).toContainText(
    "execute_jump",
  );
});

test("unseeded_campaign_victory_is_unmarked", async ({ page }) => {
  test.setTimeout(180_000);
  await completeSixChapterRun(page, "/?fast=1", true);
  await expect(page.getByTestId("victory-card")).toContainText("JUMP COMPLETE");
  await expect(page.getByTestId("victory-card")).not.toContainText(
    "TRAINING SIMULATION",
  );
});
