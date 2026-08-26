import { expect, test, type Page } from "@playwright/test";

type Invocation = { outcome: { ok: boolean; code?: string } };

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

async function boot(page: Page): Promise<void> {
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
  expect((await invoke(page, "boot_handshake")).outcome.ok).toBe(true);
  await expect
    .poll(() => page.evaluate(() => window.halcyonSim.getState().chapter))
    .toBe(2);
}

async function triageManifest(page: Page): Promise<void> {
  for (const sectionId of ["s2", "s4", "s5"]) {
    expect(
      (
        await invoke(page, "flag_section", {
          section_id: sectionId,
          priority: 1,
        })
      ).outcome.ok,
      `${sectionId} must be triaged by the agent before crew acknowledgement`,
    ).toBe(true);
    await page.locator(`[data-section="${sectionId}"]`).click();
  }
  await expect
    .poll(() =>
      page.evaluate(() => window.halcyonSim.getState().chapterDone[2]),
    )
    .toBe(true);
}

async function routePower(page: Page): Promise<void> {
  expect(
    (await invoke(page, "route_power", { allocations: MINIMUM_ROUTE })).outcome
      .ok,
  ).toBe(true);
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
  expect(
    (await invoke(page, "tune_decoder", { offset_khz: -18 })).outcome.ok,
  ).toBe(true);
  expect((await invoke(page, "decode_reply")).outcome.ok).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() => window.halcyonSim.getState().chapterDone[4]),
    )
    .toBe(true);
}

async function purgeDrive(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const arm = await invoke(page, "arm_purge");
    if (arm.outcome.ok) break;
    expect(arm.outcome.code, "arm_purge must only wait for pressure").toBe(
      "PRESSURE_OUT_OF_BAND",
    );
    await page.waitForTimeout(50);
    if (attempt === 99) {
      throw new Error("arm_purge never opened its configured pressure window");
    }
  }
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
}

async function burnHome(page: Page): Promise<void> {
  expect((await invoke(page, "set_jump_vector", JUMP_VECTOR)).outcome.ok).toBe(
    true,
  );
  expect((await invoke(page, "pressurize_injectors")).outcome.ok).toBe(true);
  for (let tap = 0; tap < 4; tap += 1) {
    await page.getByTestId("inject-tap").click();
    await page.waitForTimeout(120);
  }
  await holdFor(page, "[data-testid=shutter-left]", 300);
  await holdFor(page, "[data-testid=shutter-right]", 300);
  expect((await invoke(page, "ignite_precheck")).outcome.ok).toBe(true);
  await holdFor(page, "[data-testid=throttle]", 1_400);
  expect((await invoke(page, "execute_jump")).outcome.ok).toBe(true);
}

test("the full six-chapter simulation reaches jump home", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/?fast=1&sim=1");
  await boot(page);
  await triageManifest(page);
  await expect
    .poll(() => page.evaluate(() => window.halcyonSim.getState().chapter))
    .toBe(3);
  await routePower(page);
  await expect
    .poll(() => page.evaluate(() => window.halcyonSim.getState().chapter))
    .toBe(4);
  await alignAndDecode(page);
  await expect
    .poll(() => page.evaluate(() => window.halcyonSim.getState().chapter))
    .toBe(5);
  await purgeDrive(page);
  await expect
    .poll(() => page.evaluate(() => window.halcyonSim.getState().chapter))
    .toBe(6);
  await burnHome(page);
  expect(
    await page.evaluate(() => window.halcyonSim.getState().chapterDone[6]),
    "the real full sequence must mark Chapter 6 complete",
  ).toBe(true);
});
