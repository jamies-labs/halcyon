import { expect, test, type Page } from "@playwright/test";

type Gauge = {
  pressure: number;
  safe_band: [number, number];
  crew_ready: boolean;
  armed: boolean;
  purged: boolean;
};

type Invocation = {
  outcome: {
    ok: boolean;
    code?: string;
    detail?: string;
    data?: Gauge | { armed_for_ms: number; next: string };
    human_action?: unknown;
    wait_for?: unknown;
    state_consequence?: unknown;
  };
};

async function invoke(page: Page, name: string): Promise<Invocation> {
  return (await page.evaluate(
    (tool) => window.halcyonSim.invoke(tool, {}),
    name,
  )) as Invocation;
}

async function gauge(page: Page): Promise<Gauge> {
  const result = await invoke(page, "read_gauge");
  expect(result.outcome.ok, "read_gauge must succeed").toBe(true);
  return result.outcome.data as Gauge;
}

async function armWhenSafe(page: Page): Promise<Invocation> {
  const ready = page.getByTestId("ch5-crew-ready");
  if (await ready.isEnabled()) await ready.click();
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const result = await invoke(page, "arm_purge");
    if (result.outcome.ok) return result;
    expect(
      result.outcome.code,
      `arm attempt ${attempt + 1} must fail only while pressure is out of band`,
    ).toBe("PRESSURE_OUT_OF_BAND");
    await page.waitForTimeout(50);
  }
  throw new Error("arm_purge never opened its configured pressure window");
}

async function coachWhenUnsafe(page: Page): Promise<Invocation> {
  const ready = page.getByTestId("ch5-crew-ready");
  if (await ready.isEnabled()) await ready.click();
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const result = await invoke(page, "arm_purge");
    if (result.outcome.code === "PRESSURE_OUT_OF_BAND") return result;
    expect(
      result.outcome.ok,
      `arm attempt ${attempt + 1} must either arm or coach for pressure`,
    ).toBe(true);
    await page.waitForTimeout(50);
  }
  throw new Error("arm_purge never returned PRESSURE_OUT_OF_BAND");
}

test.beforeEach(async ({ page }) => {
  await page.goto("/?fast=1&sim=1&ch=5");
});

test("Two-Man Rule registers the read gauge with the real read-only host annotation", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const registered: Array<{
      name: string;
      annotations?: { readOnlyHint?: boolean };
    }> = [];
    Object.defineProperty(window, "__twoManRegisteredTools", {
      configurable: true,
      value: registered,
    });
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        registerTool(tool: {
          name: string;
          annotations?: { readOnlyHint?: boolean };
        }) {
          registered.push({ name: tool.name, annotations: tool.annotations });
          return { unregister() {} };
        },
      },
    });
  });
  await page.goto("/?fast=1&sim=1&ch=5");

  const registered = await page.evaluate(() =>
    (
      window as typeof window & {
        __twoManRegisteredTools: Array<{
          name: string;
          annotations?: { readOnlyHint?: boolean };
        }>;
      }
    ).__twoManRegisteredTools.filter((tool) =>
      ["read_gauge", "arm_purge"].includes(tool.name),
    ),
  );
  expect(registered.find((tool) => tool.name === "read_gauge")).toEqual({
    name: "read_gauge",
    annotations: { readOnlyHint: true },
  });
  expect(
    registered.find((tool) => tool.name === "arm_purge")?.annotations,
  ).toBeUndefined();

  const reading = await gauge(page);
  expect(reading.safe_band).toEqual([30, 55]);
  expect(reading.crew_ready).toBe(false);
  expect(reading.armed).toBe(false);
  expect(reading.purged).toBe(false);
  const stageText = await page.getByTestId("stage").textContent();
  expect(stageText).not.toContain(String(reading.pressure));
  expect(stageText).not.toContain("safe band");
});

test("Two-Man Rule tool descriptions declare the agent and crew roles", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const registered: Array<{ name: string; description: string }> = [];
    Object.defineProperty(window, "__twoManToolDescriptions", {
      configurable: true,
      value: registered,
    });
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        registerTool(tool: { name: string; description: string }) {
          registered.push({ name: tool.name, description: tool.description });
          return { unregister() {} };
        },
      },
    });
  });
  await page.goto("/?fast=1&sim=1&ch=5");

  const descriptions = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __twoManToolDescriptions: Array<{
            name: string;
            description: string;
          }>;
        }
      ).__twoManToolDescriptions,
  );

  expect(
    descriptions.find(({ name }) => name === "read_gauge")?.description,
  ).toBe(
    "HALCYON reads the drive pressure and crew-ready state. First ask the crew to use the visible ready control. Then poll until pressure is 30–55, call arm_purge, and wait while the crew alone holds two physical vent controls simultaneously.",
  );
  expect(
    descriptions.find(({ name }) => name === "arm_purge")?.description,
  ).toBe(
    "HALCYON alone arms the drive purge. It must first receive the crew's visible ready acknowledgement, then call inside the 30–55 pressure band. Arming opens a full visible countdown; the crew completes the purge with two simultaneous physical controls (VENT A plus Space, both touch vents, or A plus Space).",
  );
});

test("arm purge returns crew handoff fields inside and outside the pressure band", async ({
  page,
}) => {
  const notReady = await invoke(page, "arm_purge");
  expect(notReady.outcome).toMatchObject({
    ok: false,
    code: "CREW_NOT_READY",
    state_consequence: "The purge remains unarmed and drive.purged remains false.",
  });
  await expect(page.getByTestId("ch5-crew-ready-status")).toContainText(
    "NOT READY",
  );
  const outside = await coachWhenUnsafe(page);
  expect(outside.outcome.code).toBe("PRESSURE_OUT_OF_BAND");
  for (const [label, response] of [
    ["outside the pressure band", outside],
    ["inside the pressure band", await armWhenSafe(page)],
  ] as const) {
    expect(
      typeof response.outcome.human_action,
      `${label} response must name the crew action`,
    ).toBe("string");
    expect(
      (response.outcome.human_action as string).trim().length,
      `${label} human_action must be non-empty`,
    ).toBeGreaterThan(0);
    expect(
      typeof response.outcome.wait_for,
      `${label} response must name the observable wait condition`,
    ).toBe("string");
    expect(
      (response.outcome.wait_for as string).trim().length,
      `${label} wait_for must be non-empty`,
    ).toBeGreaterThan(0);
  }

  const inside = await armWhenSafe(page);
  expect(inside.outcome.data).toEqual({
    armed_for_ms: 4_000,
    next: "Crew must hold two controls simultaneously until progress reaches 100%.",
  });
  expect(inside.outcome.wait_for).toBe(
    "Wait for purge or arm-window expiry; poll read_gauge until purged is true or armed is false.",
  );
  expect((await gauge(page)).armed).toBe(true);
});

test("one handle alone never purges; both handles inside the armed window do", async ({
  page,
}) => {
  expect((await armWhenSafe(page)).outcome.ok).toBe(true);

  const firstLeft = await page.getByTestId("vent-left").boundingBox();
  expect(firstLeft, "left vent must have a pointer target").not.toBeNull();
  await page.mouse.move(
    firstLeft!.x + firstLeft!.width / 2,
    firstLeft!.y + firstLeft!.height / 2,
  );
  await page.mouse.down();
  try {
    await expect(page.getByTestId("vent-left-state")).toHaveText("HELD");
    await expect(page.getByTestId("vent-right-state")).toHaveText("READY");
    await page.waitForTimeout(900);
    expect(
      await page.evaluate(
        () => window.halcyonSim.getState().flags["drive.purged"],
      ),
      "one held vent must not purge the drive",
    ).toBe(false);
    expect(
      await page.evaluate(() => window.halcyonSim.getState().chapterDone[5]),
      "one held vent must not complete chapter five",
    ).toBe(false);

    await page.mouse.up();
    await page.keyboard.down("Space");
    await expect(page.getByTestId("vent-left-state")).toHaveText("RELEASED");
    await expect(page.getByTestId("vent-right-state")).toHaveText("HELD");
    await page.waitForTimeout(900);
    expect(
      await page.evaluate(
        () => window.halcyonSim.getState().flags["drive.purged"],
      ),
      "Space alone must not purge the drive",
    ).toBe(false);
  } finally {
    await page.keyboard.up("Space");
    await page.mouse.up();
  }

  // Reset the browser state between the negative and positive paths. The
  // negative proof deliberately holds inputs for longer than the success hold;
  // carrying that elapsed real time into a re-arm makes the positive path
  // dependent on browser scheduling instead of the Two-Man Rule itself.
  await page.goto("/?fast=1&sim=1&ch=5");
  expect((await armWhenSafe(page)).outcome.ok).toBe(true);
  const freshLeft = await page.getByTestId("vent-left").boundingBox();
  expect(freshLeft, "fresh vent must have a pointer target").not.toBeNull();
  await page.mouse.move(
    freshLeft!.x + freshLeft!.width / 2,
    freshLeft!.y + freshLeft!.height / 2,
  );
  await page.mouse.down();
  await page.keyboard.down("Space");
  try {
    await expect(page.getByTestId("hold-ring")).toHaveAttribute(
      "aria-valuetext",
      /[1-9][0-9]?% complete|100% complete/,
    );
    await expect
      .poll(
        () =>
          page.evaluate(
            () => window.halcyonSim.getState().flags["drive.purged"],
          ),
        { intervals: [50, 100, 200], timeout: 3_000 },
      )
      .toBe(true);
    expect(
      await page.evaluate(() => window.halcyonSim.getState().chapterDone[5]),
      "simultaneous physical holds must complete Chapter Five",
    ).toBe(true);
  } finally {
    await page.keyboard.up("Space");
    await page.mouse.up();
  }
});

test("normal timing Chrome completes three fresh runs in both input orders", async ({
  page,
}) => {
  test.setTimeout(55_000);
  for (const order of ["pointer-first", "space-first", "pointer-first"] as const) {
    await page.goto("/?sim=1&ch=5");
    expect((await armWhenSafe(page)).outcome.ok).toBe(true);
    const left = await page.getByTestId("vent-left").boundingBox();
    await page.mouse.move(left!.x + left!.width / 2, left!.y + left!.height / 2);
    if (order === "space-first") {
      await page.keyboard.down("Space");
      await page.mouse.down();
    } else {
      await page.mouse.down();
      await page.keyboard.down("Space");
    }
    try {
      await expect
        .poll(
          () =>
            page.evaluate(
              () => window.halcyonSim.getState().flags["drive.purged"],
            ),
          { timeout: 4_000 },
        )
        .toBe(true);
      expect(
        await page.evaluate(() => window.halcyonSim.getState().chapterDone[5]),
      ).toBe(true);
      await expect(page.getByTestId("ch5-handoff-status")).toContainText(
        "PURGE COMPLETE",
      );
    } finally {
      await page.keyboard.up("Space");
      await page.mouse.up();
    }
  }
});

test("two-control touch and keyboard alternatives preserve containment", async ({
  page,
}) => {
  expect((await armWhenSafe(page)).outcome.ok).toBe(true);
  await page.keyboard.down("a");
  await page.waitForTimeout(800);
  expect(
    await page.evaluate(() => window.halcyonSim.getState().flags["drive.purged"]),
    "keyboard A alone must not purge",
  ).toBe(false);
  await page.keyboard.down("Space");
  try {
    await expect
      .poll(() =>
        page.evaluate(
          () => window.halcyonSim.getState().flags["drive.purged"],
        ),
      )
      .toBe(true);
  } finally {
    await page.keyboard.up("Space");
    await page.keyboard.up("a");
  }

  await page.goto("/?fast=1&sim=1&ch=5");
  expect((await armWhenSafe(page)).outcome.ok).toBe(true);
  const left = await page.getByTestId("vent-left").boundingBox();
  const right = await page.getByTestId("vent-right").boundingBox();
  const session = await page.context().newCDPSession(page);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { x: left!.x + left!.width / 2, y: left!.y + left!.height / 2, id: 1 },
      { x: right!.x + right!.width / 2, y: right!.y + right!.height / 2, id: 2 },
    ],
  });
  try {
    await expect(page.getByTestId("vent-left-state")).toHaveText("HELD");
    await expect(page.getByTestId("vent-right-state")).toHaveText("HELD");
    await expect
      .poll(() =>
        page.evaluate(
          () => window.halcyonSim.getState().flags["drive.purged"],
        ),
      )
      .toBe(true);
  } finally {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await session.detach();
  }
});

test("input loss resets readable progress with a named cause", async ({ page }) => {
  expect((await armWhenSafe(page)).outcome.ok).toBe(true);
  const left = page.getByTestId("vent-left");
  const box = await left.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.keyboard.down("Space");
  await expect
    .poll(() =>
      page
        .getByTestId("hold-ring")
        .evaluate((node) => Number(node.getAttribute("aria-valuenow"))),
    )
    .toBeGreaterThan(0);

  await page.keyboard.up("Space");
  await expect(page.getByTestId("vent-left-state")).toHaveText("HELD");
  await expect(page.getByTestId("vent-right-state")).toHaveText("RELEASED");
  await expect(page.getByTestId("hold-ring")).toHaveAttribute(
    "aria-valuenow",
    "0",
  );
  await expect(page.getByTestId("ch5-reset-status")).toContainText(
    "Space up",
  );

  await page.keyboard.down("Space");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(page.getByTestId("vent-left-state")).toHaveText("RELEASED");
  await expect(page.getByTestId("vent-right-state")).toHaveText("RELEASED");
  await expect(page.getByTestId("ch5-reset-status")).toContainText(
    "Window lost focus",
  );
  await page.mouse.up();
  await page.keyboard.up("Space");
});

test("recorder reports Chapter Five handoff, inputs, reset, and completion", async ({
  page,
}) => {
  await page.getByTestId("recorder-toggle").click();
  await page.getByTestId("ch5-crew-ready").click();
  expect((await armWhenSafe(page)).outcome.ok).toBe(true);
  const box = await page.getByTestId("vent-left").boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.keyboard.down("Space");
  await page.waitForTimeout(100);
  await page.keyboard.up("Space");
  await page.keyboard.down("Space");
  try {
    await expect
      .poll(() =>
        page.evaluate(
          () => window.halcyonSim.getState().flags["drive.purged"],
        ),
      )
      .toBe(true);
  } finally {
    await page.keyboard.up("Space");
    await page.mouse.up();
  }

  const log = page.getByTestId("recorder-log");
  await expect(log).toContainText("Crew ready for Chapter 5");
  await expect(log).toContainText("Purge armed");
  await expect(log).toContainText("VENT A held");
  await expect(log).toContainText("VENT B released");
  await expect(log).toContainText("overlap started");
  await expect(log).toContainText("drive purged");
  const stageText = await page.getByTestId("stage").textContent();
  expect(stageText).not.toContain("safe band");
  expect(stageText).not.toContain("30–55");
});

test("Two-Man Rule keeps crew-only labels and dual-channel containment", async ({
  page,
}) => {
  await expect(page.getByTestId("vent-left")).toBeVisible();
  await expect(page.getByTestId("vent-right")).toBeVisible();
  await expect(page.getByTestId("hold-ring")).toBeVisible();
  await expect(page.getByTestId("vent-left")).toHaveAccessibleName(
    /VENT A READY.*physical control, crew hands only/,
  );
  await expect(page.getByTestId("vent-right")).toHaveAccessibleName(
    /VENT B READY.*physical control, crew hands only/,
  );
  await expect(page.getByTestId("vent-left")).toContainText("Pointer");
  await expect(page.getByTestId("vent-right")).toContainText("Space");
  await page.getByTestId("vent-left").focus();
  expect(
    await page
      .getByTestId("vent-left")
      .evaluate((control) => getComputedStyle(control).outlineStyle),
  ).toBe("solid");
});

test("Two-Man Rule broadcast and review scenario preserve cooperative evidence", async ({
  page,
}) => {
  await expect(page.getByTestId("speaker-panel")).toContainText(
    "Crew, confirm ready first. HALCYON will read pressure and arm; you will hold two physical vent controls together.",
  );

  expect((await armWhenSafe(page)).outcome.ok).toBe(true);
  await expect(page.getByTestId("speaker-panel")).toContainText(
    "HALCYON has armed the full purge window.",
  );

  const response = await page.request.get("/ui-review.json");
  expect(
    response.ok(),
    "the review manifest must be served to its runner",
  ).toBe(true);
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
    ({ variant }) => variant === "chapter-five-two-man",
  );

  expect(scenario?.route).toBe("/");
  expect(scenario?.state).toBe("resolved");
  expect(scenario?.viewports).toEqual([375, 1280]);
  expect(scenario?.theme).toBe("light");
  expect(scenario?.ready_selector).toBe("[data-testid=ch5-handoff-status]");
  expect(scenario?.covers.changedPaths).toEqual([
    "src/game/chapters/ch5_twoman.ts",
  ]);
  const requirementKeys = scenario?.covers.requirementKeys;
  expect(Array.isArray(requirementKeys)).toBe(true);
  if (!Array.isArray(requirementKeys)) {
    throw new Error("Chapter Five requirement keys must be an array");
  }
  for (const key of requirementKeys) {
    expect(typeof key).toBe("string");
    if (typeof key !== "string") {
      throw new Error("Chapter Five requirement key must be a string");
    }
    expect(key).toMatch(/^AC\d+/);
  }
});

test("the armed window expires and read_gauge reports armed false", async ({
  page,
}) => {
  const arm = await armWhenSafe(page);
  expect(arm.outcome.ok).toBe(true);
  expect(arm.outcome.data).toEqual({
    armed_for_ms: 4_000,
    next: "Crew must hold two controls simultaneously until progress reaches 100%.",
  });
  await expect
    .poll(async () => (await gauge(page)).armed, {
      intervals: [100, 250, 500],
      timeout: 6_000,
    })
    .toBe(false);
  expect(
    await page.evaluate(
      () => window.halcyonSim.getState().flags["drive.purged"],
    ),
  ).toBe(false);
});
