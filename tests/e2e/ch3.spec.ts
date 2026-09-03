import { expect, test, type Page } from "@playwright/test";

type Invocation = {
  outcome: {
    ok: boolean;
    code?: string;
    detail?: string;
    data?: unknown;
    human_action?: unknown;
    wait_for?: unknown;
    state_consequence?: unknown;
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

test("Power tool descriptions declare the agent and crew roles", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const descriptions: Array<{ name: string; description: string }> = [];
    Object.defineProperty(window, "__powerToolDescriptions", {
      configurable: true,
      value: descriptions,
    });
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        registerTool(tool: { name: string; description: string }) {
          descriptions.push({ name: tool.name, description: tool.description });
          return { unregister() {} };
        },
      },
    });
  });
  await page.goto("/?fast=1&sim=1&ch=3");

  const descriptions = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __powerToolDescriptions: Array<{ name: string; description: string }>;
        }
      ).__powerToolDescriptions,
  );
  const telemetry = descriptions.find(
    ({ name }) => name === "read_power_telemetry",
  );
  const routePower = descriptions.find(({ name }) => name === "route_power");

  expect(telemetry?.description).toBe(
    "HALCYON reads the current draw and 60A total budget. Next, HALCYON alone calls route_power with an allocations array of subsystem/amps objects; the crew never routes power and physically seats every fuse shown only after a route is accepted. Required subsystem minimums are taught one at a time by structured BROWNOUT results.",
  );
  expect(routePower?.description).toBe(
    "HALCYON alone allocates power within the 60A budget. Submit allocations as an array of unique objects with subsystem (life_support, comms, drive, sensors, lights, or heaters) and integer amps from 0 to 40. Omitted subsystems receive 0A. Follow each BROWNOUT minimum in order; after acceptance, ask the crew to seat every physical fuse shown, one at a time. Re-routing pops and resets the full fuse set.",
  );
});

test("route power returns crew handoff fields for accepted and rejected routes", async ({
  page,
}) => {
  const accepted = await route(page, minimumRoute);
  const overBudget = await route(page, [
    { subsystem: "life_support", amps: 40 },
    { subsystem: "drive", amps: 40 },
  ]);
  const brownout = await route(page, [{ subsystem: "drive", amps: 10 }]);
  const duplicate = await route(page, [
    { subsystem: "lights", amps: 4 },
    { subsystem: "lights", amps: 5 },
  ]);

  for (const [label, invocation, code] of [
    ["accepted route", accepted, undefined],
    ["over-budget route", overBudget, "OVER_BUDGET"],
    ["brownout route", brownout, "BROWNOUT"],
    ["duplicate-subsystem route", duplicate, "DUPLICATE_SUBSYSTEM"],
  ] as const) {
    expect(invocation.outcome.code, `${label} code`).toBe(code);
    expect(
      typeof invocation.outcome.human_action,
      `${label} must name the crew action`,
    ).toBe("string");
    expect(
      (invocation.outcome.human_action as string).trim().length,
      `${label} human_action must be non-empty`,
    ).toBeGreaterThan(0);
    expect(
      typeof invocation.outcome.wait_for,
      `${label} must name the wait condition`,
    ).toBe("string");
    expect(
      (invocation.outcome.wait_for as string).trim().length,
      `${label} wait_for must be non-empty`,
    ).toBeGreaterThan(0);
    expect(
      typeof invocation.outcome.state_consequence,
      `${label} must explain whether ship state changed`,
    ).toBe("string");
  }
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
      [
        [
          { subsystem: "life_support", amps: 18 },
          { subsystem: "comms", amps: 8 },
          { subsystem: "sensors", amps: 6 },
          { subsystem: "lights", amps: 4 },
        ],
        "drive",
        14,
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

test("an optional powered heater gets its own visible fuse and truthful outcome", async ({
  page,
}) => {
  const accepted = await route(page, [
    ...minimumRoute,
    { subsystem: "heaters", amps: 10 },
  ]);
  expect(accepted.outcome).toMatchObject({
    ok: true,
    state_consequence:
      "The accepted allocation popped 6 physical fuses; power remains unchanged until the crew seats them and stabilization completes.",
  });
  await expect(page.locator("[data-fuse]")).toHaveCount(6);
  await expect(page.locator('[data-fuse="heaters"]')).toContainText("Heaters");
  await expect(page.getByTestId("speaker-panel")).toContainText(
    "Route accepted — 6 fuses popped.",
  );
});

test("Power fuse guidance exposes hold progress, persistent state, and stabilization", async ({
  page,
}) => {
  await expect(page.getByTestId("power-crew-guidance")).toContainText(
    "hold each popped fuse until × changes to ●",
  );
  await expect(page.getByTestId("power-crew-guidance")).toContainText(
    "Seat them one at a time",
  );
  expect((await route(page, minimumRoute)).outcome.ok).toBe(true);
  await expect(page.getByTestId("fuse-state-life_support")).toHaveText(
    "× POPPED",
  );

  const life = page.locator('[data-fuse="life_support"]');
  const lifeBox = await life.boundingBox();
  await page.mouse.move(lifeBox!.x + lifeBox!.width / 2, lifeBox!.y + lifeBox!.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(50);
  await expect(page.getByTestId("fuse-state-life_support")).toHaveText(
    "× HOLDING",
  );
  await page.mouse.up();
  await expect(page.getByTestId("fuse-progress-life_support")).toHaveJSProperty(
    "value",
    0,
  );
  await expect(page.getByTestId("fuse-state-life_support")).toHaveText(
    "× POPPED",
  );

  await life.focus();
  await page.keyboard.down("Space");
  await page.waitForTimeout(200);
  await page.keyboard.up("Space");
  await expect(page.getByTestId("fuse-state-life_support")).toHaveText(
    "● SEATED",
  );
  await expect(life).toContainText("Life support");

  await seatFuses(page, ["comms", "sensors", "lights", "drive"]);
  await expect(page.getByTestId("power-stabilization-status")).toContainText(
    "Bus stabilizing",
  );
  await expect(page.getByTestId("speaker-panel")).toContainText(
    "Keep hands clear while the bus stabilizes",
  );
});

test("Power normal-speed five-fuse handoff unlocks Chapter 4", async ({
  page,
}) => {
  test.setTimeout(30_000);
  await page.goto("/?sim=1&ch=3");
  expect((await route(page, minimumRoute)).outcome.ok).toBe(true);
  for (const id of ["life_support", "comms", "sensors", "lights", "drive"]) {
    const fuse = page.locator(`[data-fuse="${id}"]`);
    const box = await fuse.boundingBox();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(1_100);
    await page.mouse.up();
    await expect(page.getByTestId(`fuse-state-${id}`)).toHaveText("● SEATED");
  }
  await expect
    .poll(() => page.evaluate(() => window.halcyonSim.getState().chapter), {
      timeout: 12_500,
    })
    .toBe(4);
});

test("Power fuses are crew-only and still complete the stable route", async ({
  page,
}) => {
  const crewOnlyName =
    "physical control, crew hands only; HALCYON must ask the crew, not operate it";
  expect((await route(page, minimumRoute)).outcome.ok).toBe(true);

  const fuses = page.locator("[data-fuse]");
  await expect(fuses).toHaveCount(5);
  for (let index = 0; index < (await fuses.count()); index += 1) {
    await expect(fuses.nth(index)).toHaveAttribute(
      "aria-label",
      new RegExp(crewOnlyName),
    );
  }

  await seatFuses(page, [
    "life_support",
    "comms",
    "sensors",
    "lights",
    "drive",
  ]);
  await expect
    .poll(() =>
      page.evaluate(() => window.halcyonSim.getState().flags["power.routed"]),
    )
    .toBe(true);
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
    { subsystem: "drive", amps: 24 },
  ]);
  expect(rerouted.outcome.ok).toBe(true);
  await expect(page.getByTestId("power-stabilization-status")).toContainText(
    "Allocation changed — every fuse popped. Seat the new set again.",
  );
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
    "drive",
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
      drive: 24,
      sensors: 6,
      lights: 4,
      heaters: 0,
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

test("Power broadcast and review scenario preserve cooperative evidence", async ({
  page,
}) => {
  await expect(page.getByTestId("speaker-panel")).toContainText(
    "HALCYON routes power; crew physically seats each popped fuse and holds the bus stable.",
  );

  const response = await page.request.get("/ui-review.json");
  expect(
    response.ok(),
    "the review manifest must be served to its runner",
  ).toBe(true);
  expect(
    response.headers()["content-type"],
    "the review manifest must be delivered as JSON rather than the app fallback",
  ).toContain("application/json");
  const manifest = (await response.json()) as {
    scenarios: Array<{
      route: string;
      state: string;
      variant?: string;
      viewports: number[];
      theme?: string;
      ready_selector: string;
      covers: { changedPaths: string[]; requirementKeys: unknown };
    }>;
  };
  const scenario = manifest.scenarios.find(
    ({ variant }) => variant === "chapter-three-power",
  );

  expect(scenario?.route).toBe("/");
  expect(scenario?.state).toBe("resolved");
  expect(scenario?.viewports).toEqual([375, 1280]);
  expect(scenario?.theme).toBe("light");
  expect(scenario?.ready_selector).toBe(
    "[data-testid=power-crew-guidance]",
  );
  expect(scenario?.covers.changedPaths).toContain(
    "src/game/chapters/ch3_power.ts",
  );
  expect(Array.isArray(scenario?.covers.requirementKeys)).toBe(true);
  for (const key of scenario?.covers.requirementKeys ?? []) {
    expect(key).toMatch(/^AC\d+/);
  }
});
