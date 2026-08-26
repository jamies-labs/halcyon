import { expect, test, type Page } from "@playwright/test";

type Gauge = {
  pressure: number;
  safe_band: [number, number];
  armed: boolean;
  purged: boolean;
};

type Invocation = {
  outcome: {
    ok: boolean;
    code?: string;
    data?: Gauge | { armed_for_ms: number; next: string };
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
  for (let attempt = 0; attempt < 100; attempt += 1) {
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
  for (let attempt = 0; attempt < 100; attempt += 1) {
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
  expect(reading.armed).toBe(false);
  expect(reading.purged).toBe(false);
  const stageText = await page.getByTestId("stage").textContent();
  expect(stageText).not.toContain(String(reading.pressure));
  expect(stageText).not.toContain("safe band");
});

test("arming outside the band coaches PRESSURE_OUT_OF_BAND and inside opens the configured window", async ({
  page,
}) => {
  const outside = await coachWhenUnsafe(page);
  expect(outside.outcome.code).toBe("PRESSURE_OUT_OF_BAND");

  const inside = await armWhenSafe(page);
  expect(inside.outcome).toEqual({
    ok: true,
    data: {
      armed_for_ms: 4_000,
      next: "Crew must hold both handles simultaneously until the purge completes.",
    },
  });
  expect((await gauge(page)).armed).toBe(true);
});

test("one handle alone never purges; both handles inside the armed window do", async ({
  page,
}) => {
  expect((await armWhenSafe(page)).outcome.ok).toBe(true);

  const left = await page.getByTestId("vent-left").boundingBox();
  expect(left, "left vent must have a pointer target").not.toBeNull();
  await page.mouse.move(left!.x + left!.width / 2, left!.y + left!.height / 2);
  await page.mouse.down();
  try {
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
    await page.waitForTimeout(900);
    expect(
      await page.evaluate(
        () => window.halcyonSim.getState().flags["drive.purged"],
      ),
      "Space alone must not purge the drive",
    ).toBe(false);

    // The two-handle proof needs its own full arm window. The preceding
    // one-handle checks deliberately consume real time and must not make the
    // positive path depend on scheduler jitter near the four-second deadline.
    expect((await armWhenSafe(page)).outcome.ok).toBe(true);
    await page.mouse.down();
    await expect
      .poll(
        () =>
          page.evaluate(
            () => window.halcyonSim.getState().flags["drive.purged"],
          ),
        { timeout: 2_000 },
      )
      .toBe(true);
    expect(
      await page.evaluate(() => window.halcyonSim.getState().chapterDone[5]),
    ).toBe(true);
  } finally {
    await page.keyboard.up("Space");
    await page.mouse.up();
  }
});

test("Two-Man Rule renders the accessible physical vent controls", async ({
  page,
}) => {
  await expect(page.getByTestId("vent-left")).toBeVisible();
  await expect(page.getByTestId("vent-right")).toBeVisible();
  await expect(page.getByTestId("hold-ring")).toBeVisible();
  await expect(page.getByTestId("vent-left")).toHaveAccessibleName(
    "Hold vent A with the pointer",
  );
  await expect(page.getByTestId("vent-left")).toContainText("pointer");
  await expect(page.getByTestId("vent-right")).toContainText("SPACE");
  await page.getByTestId("vent-left").focus();
  expect(
    await page
      .getByTestId("vent-left")
      .evaluate((control) => getComputedStyle(control).outlineStyle),
  ).toBe("solid");
});

test("the armed window expires and read_gauge reports armed false", async ({
  page,
}) => {
  const arm = await armWhenSafe(page);
  expect(arm.outcome.ok).toBe(true);
  expect(arm.outcome.data).toEqual({
    armed_for_ms: 4_000,
    next: "Crew must hold both handles simultaneously until the purge completes.",
  });
  await expect
    .poll(async () => (await gauge(page)).armed, { timeout: 5_000 })
    .toBe(false);
  expect(
    await page.evaluate(
      () => window.halcyonSim.getState().flags["drive.purged"],
    ),
  ).toBe(false);
});
