import { test, expect } from "@playwright/test";

declare global {
  interface Window {
    halcyonSim: {
      invoke: (name: string, args?: unknown) => Promise<unknown>;
      listTools: () => string[];
      getState: () => {
        chapter: number;
        booted: boolean;
        chapterDone: Record<number, boolean>;
        power: Record<string, number>;
        flags: Record<string, unknown>;
      };
      goto: (chapter: number) => void;
    };
  }
}

test("gate shows without sim param and Start reveals the Chapter 1 breaker", async ({
  page,
}) => {
  await page.goto("/?fast=1");

  await expect(page.getByTestId("gate")).toBeVisible();
  await expect(page.getByTestId("gate")).toContainText("No crew link");
  await page.getByTestId("gate-start").click();

  await expect(page.getByTestId("gate")).toBeHidden();
  await expect(page.getByTestId("breaker-handle")).toBeVisible();
});

test("sim mode auto-starts and exposes chapter one via halcyonSim", async ({
  page,
}) => {
  await page.goto("/?fast=1&sim=1");

  await expect(page.getByTestId("gate")).toBeHidden();
  const chapter = await page.evaluate(
    () => window.halcyonSim.getState().chapter,
  );
  expect(chapter).toBe(1);
  await expect(page.getByTestId("breaker-handle")).toBeVisible();
});

test("default campaign ignores forward ch parameter", async ({ page }) => {
  await page.goto("/?fast=1&ch=6");

  await expect(page.getByTestId("chapter-select")).toHaveAttribute(
    "aria-label",
    "Campaign chapter selector",
  );
  const state = await page.evaluate(() => window.halcyonSim.getState());
  expect(state.chapter).toBe(1);
  expect(state.booted).toBe(false);
  expect(state.chapterDone).toEqual({
    1: false,
    2: false,
    3: false,
    4: false,
    5: false,
    6: false,
  });
  expect(state.flags["drive.purged"]).toBe(false);
  await expect(page.getByTestId("goto-ch6")).toBeDisabled();

  await page.evaluate(() => window.halcyonSim.goto(6));
  expect(await page.evaluate(() => window.halcyonSim.getState())).toMatchObject(
    {
      chapter: 1,
      booted: false,
      flags: { "drive.purged": false },
    },
  );
});

test("campaign selector revisits only saved progress", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "halcyon.save.v1",
      JSON.stringify({
        chapter: 3,
        chapterDone: {
          1: true,
          2: true,
          3: false,
          4: false,
          5: false,
          6: false,
        },
      }),
    );
  });
  await page.goto("/?fast=1");
  await page.getByTestId("gate-start").click();
  await expect(page.getByTestId("gate")).toBeHidden();

  const before = await page.evaluate(() => window.halcyonSim.getState());
  for (const chapter of [1, 2, 3]) {
    await expect(page.getByTestId(`goto-ch${chapter}`)).toBeEnabled();
    await page.getByTestId(`goto-ch${chapter}`).click();
    expect(
      await page.evaluate(() => window.halcyonSim.getState().chapter),
    ).toBe(chapter);
  }
  await expect(page.getByTestId("goto-ch4")).toBeDisabled();
  await page.getByTestId("goto-ch4").click({ force: true });

  const after = await page.evaluate(() => window.halcyonSim.getState());
  expect(after.chapter).toBe(3);
  expect(after.power).toEqual(before.power);
  expect(after.flags).toEqual(before.flags);
});

test("simulator seeding is ephemeral", async ({ page }) => {
  const savedCampaign =
    '{"chapter":3,"chapterDone":{"1":true,"2":true,"3":false,"4":false,"5":false,"6":false}}';
  await page.addInitScript((save) => {
    localStorage.setItem("halcyon.save.v1", save);
  }, savedCampaign);
  await page.goto("/?fast=1&sim=1");
  await expect(page.getByTestId("simulator-session")).toContainText(
    "TRAINING SIMULATION",
  );
  expect(await page.evaluate(() => window.halcyonSim.getState())).toMatchObject(
    {
      chapter: 1,
      booted: false,
      flags: { "drive.purged": false },
    },
  );
  expect(
    await page.evaluate(() => localStorage.getItem("halcyon.save.v1")),
  ).toBe(savedCampaign);

  await page.goto("/?fast=1&sim=1&ch=6");

  const seeded = await page.evaluate(() => window.halcyonSim.getState());
  expect(seeded).toMatchObject({
    chapter: 6,
    booted: true,
    chapterDone: { 1: true, 2: true, 3: true, 4: true, 5: true },
    flags: { "drive.purged": true },
  });
  await page.evaluate(() => window.halcyonSim.goto(6));
  expect(
    await page.evaluate(() => localStorage.getItem("halcyon.save.v1")),
  ).toBe(savedCampaign);
});

test("seeded chapter jump registers global tools and delivers broadcasts", async ({
  page,
}) => {
  await page.goto("/?fast=1&sim=1&ch=3");

  const state = await page.evaluate(() => window.halcyonSim.getState());
  expect(state.chapter).toBe(3);
  expect(state.booted).toBe(true);
  const tools = await page.evaluate(() => window.halcyonSim.listTools());
  expect(tools).toEqual([
    "get_ship_state",
    "broadcast",
    "read_boot_briefing",
    "read_power_telemetry",
    "route_power",
  ]);
  const result = await page.evaluate(() =>
    window.halcyonSim.invoke("get_ship_state", {}),
  );
  expect((result as { outcome: { ok: boolean } }).outcome.ok).toBe(true);
  await page.evaluate(() => window.halcyonSim.goto(6));
  const seeded = await page.evaluate(() => window.halcyonSim.getState());
  expect(seeded.chapter).toBe(6);
  expect(seeded.booted).toBe(true);
  expect(seeded.chapterDone).toMatchObject({
    1: true,
    2: true,
    3: true,
    4: true,
    5: true,
  });
  expect(seeded.power).toEqual({
    life_support: 18,
    comms: 8,
    drive: 14,
    sensors: 6,
    lights: 4,
    heaters: 0,
  });
  expect(seeded.flags).toMatchObject({
    "manifest.flagged": ["s2", "s4", "s5"],
    "power.routed": true,
    "comms.online": true,
    "comms.jump_vector": { x: 0.42, y: -1.07, z: 3.14 },
    "drive.purged": true,
  });

  await page.evaluate(() =>
    window.halcyonSim.invoke("broadcast", {
      message: "Good morning, crew.",
      tone: "dry",
    }),
  );
  await expect(page.getByTestId("speaker-panel")).toContainText(
    "Good morning, crew.",
  );
});

test("recorder panel lists a selected manual registry call", async ({
  page,
}) => {
  await page.goto("/?fast=1&sim=1&ch=3");

  await page.getByTestId("recorder-toggle").click();
  await expect(page.getByTestId("recorder-panel")).toBeVisible();
  await page.getByTestId("sim-tool-select").selectOption("get_ship_state");
  await page.getByTestId("sim-invoke").click();

  await expect(page.getByTestId("recorder-log")).toContainText(
    "get_ship_state (sim",
  );
});

test("recorder renders complete safe invocation outcomes", async ({ page }) => {
  await page.goto("/?fast=1&sim=1&ch=3");

  const log = page.getByTestId("recorder-log");
  await page.getByTestId("recorder-toggle").click();
  await page.getByTestId("sim-tool-select").selectOption("get_ship_state");
  await page.getByTestId("sim-invoke").click();

  await expect(log).toContainText("ok=true");
  await expect(log).toContainText("data: chapter=3");
  await expect(log).not.toContainText("Restore power: route amps");
  await expect(log).not.toContainText("life_support:18");

  await page.getByTestId("sim-tool-select").selectOption("route_power");
  await page.getByTestId("sim-args").fill("{}");
  await page.getByTestId("sim-invoke").click();

  await expect(log).toContainText("ok=false");
  await expect(log).toContainText("INVALID_ARGS");
  await expect(log).toContainText("args.allocations is required");
  await expect(log).toContainText(
    "Check the tool inputSchema and correct the arguments.",
  );
});

test("recorder opens and closes through pointer, touch and keyboard", async ({
  page,
}) => {
  await page.goto("/?fast=1&sim=1&ch=6");
  const toggle = page.getByTestId("recorder-toggle");
  const panel = page.getByTestId("recorder-panel");
  const close = page.getByTestId("recorder-close");

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(panel).toBeVisible();
  await close.click();
  await expect(panel).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toBeFocused();

  await page.touchscreen.tap(
    (await toggle.boundingBox())!.x + 4,
    (await toggle.boundingBox())!.y + 4,
  );
  await expect(panel).toBeVisible();
  await page.touchscreen.tap(
    (await close.boundingBox())!.x + 4,
    (await close.boundingBox())!.y + 4,
  );
  await expect(panel).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toBeFocused();

  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(panel).toBeVisible();
  await close.focus();
  await page.keyboard.press("Enter");
  await expect(panel).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toBeFocused();
});

test("recorder dock preserves Chapter 6 crew controls", async ({ page }) => {
  await page.goto("/?fast=1&sim=1&ch=6");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByTestId("recorder-toggle").click();

  const recorderBox = await page.getByTestId("recorder-panel").boundingBox();
  const injectBox = await page.getByTestId("inject-tap").boundingBox();
  expect(recorderBox, "recorder panel must have a desktop box").not.toBeNull();
  expect(injectBox, "inject-tap must have a desktop box").not.toBeNull();
  expect(injectBox!.x + injectBox!.width).toBeLessThanOrEqual(recorderBox!.x);

  await page.setViewportSize({ width: 375, height: 812 });
  const crewPrecondition = await page.evaluate(async () => {
    const vector = await window.halcyonSim.invoke("set_jump_vector", {
      x: 0.42,
      y: -1.07,
      z: 3.14,
    });
    const pressurize = await window.halcyonSim.invoke("pressurize_injectors");
    return {
      vectorLocked: (vector as { outcome: { ok: boolean } }).outcome.ok,
      injectorsPressurized: (pressurize as { outcome: { ok: boolean } }).outcome
        .ok,
    };
  });
  expect(crewPrecondition.vectorLocked).toBe(true);
  expect(crewPrecondition.injectorsPressurized).toBe(true);
  await page.getByTestId("inject-tap").click();
  await expect(page.getByTestId("inject-tap")).toHaveText("PRIME 1/4");
});
