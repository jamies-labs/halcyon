import { expect, test, type Page } from "@playwright/test";

type Invocation = {
  outcome: {
    ok: boolean;
    code?: string;
    detail?: string;
    data?: unknown;
  };
};

const minimumRoute = [
  { subsystem: "life_support", amps: 18 },
  { subsystem: "comms", amps: 8 },
  { subsystem: "sensors", amps: 6 },
  { subsystem: "lights", amps: 4 },
  { subsystem: "drive", amps: 14 },
];

async function route(page: Page, allocations: unknown): Promise<Invocation> {
  return (await page.evaluate(
    (value) => window.halcyonSim.invoke("route_power", { allocations: value }),
    allocations,
  )) as Invocation;
}

async function seatFuses(page: Page, ids: string[]): Promise<void> {
  for (const id of ids) {
    const fuse = page.locator(`[data-fuse="${id}"]`);
    const box = await fuse.boundingBox();
    expect(box, `${id} fuse must have a physical target`).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(200);
    await page.mouse.up();
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto("/?fast=1&sim=1&ch=3");
});

test("Power registers read_power_telemetry with the real read-only host annotation", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const registeredTools: Array<{
      name: string;
      annotations?: { readOnlyHint?: boolean };
    }> = [];
    Object.defineProperty(window, "__powerRegisteredTools", {
      configurable: true,
      value: registeredTools,
    });
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        registerTool(tool: {
          name: string;
          annotations?: { readOnlyHint?: boolean };
        }) {
          registeredTools.push({
            name: tool.name,
            annotations: tool.annotations,
          });
          return { unregister() {} };
        },
      },
    });
  });
  await page.goto("/?fast=1&sim=1&ch=3");

  const powerTool = await page.evaluate(() =>
    (
      window as typeof window & {
        __powerRegisteredTools: Array<{
          name: string;
          annotations?: { readOnlyHint?: boolean };
        }>;
      }
    ).__powerRegisteredTools.find(
      (tool) => tool.name === "read_power_telemetry",
    ),
  );
  expect(powerTool).toEqual({
    name: "read_power_telemetry",
    annotations: { readOnlyHint: true },
  });

  const telemetry = (await page.evaluate(() =>
    window.halcyonSim.invoke("read_power_telemetry", {}),
  )) as Invocation;
  expect(telemetry.outcome).toEqual({
    ok: true,
    data: {
      budget_amps: 60,
      draw: {
        life_support: 0,
        comms: 0,
        drive: 0,
        sensors: 0,
        lights: 0,
        heaters: 0,
      },
      routed: false,
    },
  });
});

test("route_power rejects invalid allocations, duplicates, and an 80A request", async ({
  page,
}) => {
  for (const allocations of [
    [{ subsystem: "lights", amps: -1 }],
    [{ subsystem: "lights", amps: 41 }],
    [{ subsystem: "lights", amps: 4.5 }],
    [{ subsystem: "unknown", amps: 4 }],
    [{ subsystem: "lights" }],
  ]) {
    const invalid = await route(page, allocations);
    expect(
      invalid.outcome.code,
      `${JSON.stringify(allocations)} must fail the declared allocation schema`,
    ).toBe("INVALID_ARGS");
  }

  const duplicate = await route(page, [
    { subsystem: "lights", amps: 4 },
    { subsystem: "lights", amps: 5 },
  ]);
  expect(duplicate.outcome.code).toBe("DUPLICATE_SUBSYSTEM");
  expect(duplicate.outcome.detail).toBe("lights appears twice.");

  const overBudget = await route(page, [
    { subsystem: "life_support", amps: 40 },
    { subsystem: "drive", amps: 40 },
  ]);
  expect(overBudget.outcome.code).toBe("OVER_BUDGET");
  expect(overBudget.outcome.detail).toBe("Requested 80A of a 60A budget.");
});

test("brownouts reveal minimums one at a time, life_support first", async ({
  page,
}) => {
  for (const [allocations, subsystem, amps] of [
    [[{ subsystem: "drive", amps: 10 }], "life_support", 18],
    [
      [
        { subsystem: "life_support", amps: 18 },
        { subsystem: "drive", amps: 10 },
      ],
      "comms",
      8,
    ],
    [
      [
        { subsystem: "life_support", amps: 18 },
        { subsystem: "comms", amps: 8 },
        { subsystem: "drive", amps: 10 },
      ],
      "sensors",
      6,
    ],
    [
      [
        { subsystem: "life_support", amps: 18 },
        { subsystem: "comms", amps: 8 },
        { subsystem: "sensors", amps: 6 },
        { subsystem: "drive", amps: 10 },
      ],
      "lights",
      4,
    ],
  ] as const) {
    const brownout = await route(page, allocations);
    expect(brownout.outcome.code).toBe("BROWNOUT");
    expect(brownout.outcome.detail).toContain(
      `${subsystem} browns out below ${amps}A`,
    );
    for (const other of ["life_support", "comms", "sensors", "lights"]) {
      if (other !== subsystem)
        expect(brownout.outcome.detail).not.toContain(other);
    }
  }
});

test("valid routing pops fuses; seating them all plus stability completes the chapter", async ({
  page,
}) => {
  const accepted = await route(page, minimumRoute);
  expect(accepted.outcome.ok).toBe(true);
  await expect(page.locator("[data-fuse]")).toHaveCount(5);
  await seatFuses(page, [
    "life_support",
    "comms",
    "sensors",
    "lights",
    "drive",
  ]);

  await expect
    .poll(() =>
      page.evaluate(() => window.halcyonSim.getState().chapterDone[3]),
    )
    .toBe(true);
  expect(
    await page.evaluate(
      () => window.halcyonSim.getState().flags["power.routed"],
    ),
  ).toBe(true);
  expect(await page.evaluate(() => window.halcyonSim.getState().power)).toEqual(
    {
      life_support: 18,
      comms: 8,
      drive: 14,
      sensors: 6,
      lights: 4,
      heaters: 0,
    },
  );
});

test("rerouting during stability requires seating the new fuse set", async ({
  page,
}) => {
  expect((await route(page, minimumRoute)).outcome.ok).toBe(true);
  await seatFuses(page, [
    "life_support",
    "comms",
    "sensors",
    "lights",
    "drive",
  ]);

  const rerouted = await route(page, [
    { subsystem: "life_support", amps: 18 },
    { subsystem: "comms", amps: 8 },
    { subsystem: "sensors", amps: 6 },
    { subsystem: "lights", amps: 4 },
    { subsystem: "heaters", amps: 14 },
  ]);
  expect(rerouted.outcome.ok).toBe(true);
  await expect(page.locator("[data-fuse]")).toHaveCount(5);
  await page.waitForTimeout(1_000);
  expect(
    await page.evaluate(() => window.halcyonSim.getState().chapterDone[3]),
    "the cancelled stability timer must not complete the new route",
  ).toBe(false);

  await seatFuses(page, [
    "life_support",
    "comms",
    "sensors",
    "lights",
    "heaters",
  ]);
  await expect
    .poll(() =>
      page.evaluate(() => window.halcyonSim.getState().chapterDone[3]),
    )
    .toBe(true);
  expect(await page.evaluate(() => window.halcyonSim.getState().power)).toEqual(
    {
      life_support: 18,
      comms: 8,
      drive: 0,
      sensors: 6,
      lights: 4,
      heaters: 14,
    },
  );
});

test("chapter select exposes the Power fuse tray without a route control", async ({
  page,
}) => {
  await page.goto("/?fast=1&sim=1");
  await page.getByTestId("goto-ch3").click();
  await expect(page.getByTestId("fuse-tray")).toBeVisible();

  expect((await route(page, minimumRoute)).outcome.ok).toBe(true);
  const fuses = page.locator("[data-fuse]");
  await expect(fuses).toHaveCount(5);
  await fuses.first().focus();
  await page.keyboard.press("Tab");
  await expect(fuses.nth(1)).toBeFocused();
  expect(
    await fuses.nth(1).evaluate((fuse) => getComputedStyle(fuse).outlineStyle),
  ).toBe("solid");
  await expect(page.locator("[data-testid=stage] button")).toHaveCount(5);
  const sceneText = await page.getByTestId("stage").textContent();
  expect(sceneText).not.toContain("18A");
  expect(sceneText).not.toContain("read_power_telemetry");
});
