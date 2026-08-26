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
