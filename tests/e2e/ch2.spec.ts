import { expect, test } from "@playwright/test";

type Invocation = {
  outcome: {
    ok: boolean;
    code?: string;
    data?: unknown;
  };
};

type RegisteredTool = {
  name: string;
  annotations?: { readOnlyHint?: boolean };
};

test.beforeEach(async ({ page }) => {
  await page.goto("/?fast=1&sim=1&ch=2");
});

test("Manifest registers read_damage_manifest with the real read-only host annotation", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const registeredTools: Array<{
      name: string;
      annotations?: { readOnlyHint?: boolean };
    }> = [];
    Object.defineProperty(window, "__manifestRegisteredTools", {
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
  await page.goto("/?fast=1&sim=1&ch=2");

  const manifestTool = await page.evaluate(() =>
    (
      window as typeof window & {
        __manifestRegisteredTools: RegisteredTool[];
      }
    ).__manifestRegisteredTools.find(
      (tool) => tool.name === "read_damage_manifest",
    ),
  );
  expect(manifestTool).toEqual({
    name: "read_damage_manifest",
    annotations: { readOnlyHint: true },
  });
});

test("manifest lists all six sections with damage status, never reachability", async ({
  page,
}) => {
  const invocation = (await page.evaluate(() =>
    window.halcyonSim.invoke("read_damage_manifest", {}),
  )) as Invocation;

  expect(invocation.outcome.ok).toBe(true);
  const data = invocation.outcome.data as {
    sections: Array<{ section_id: string; status: string; note: string }>;
  };
  expect(data.sections).toHaveLength(6);
  expect(data.sections).toEqual([
    {
      section_id: "s1",
      status: "nominal",
      note: "all readings nominal",
    },
    {
      section_id: "s2",
      status: "damaged",
      note: "coolant line rupture",
    },
    {
      section_id: "s3",
      status: "nominal",
      note: "all readings nominal",
    },
    {
      section_id: "s4",
      status: "damaged",
      note: "junction burnout",
    },
    {
      section_id: "s5",
      status: "damaged",
      note: "frame stress fracture",
    },
    {
      section_id: "s6",
      status: "damaged",
      note: "hull breach — sensor ghosting",
    },
  ]);
  expect(JSON.stringify(data)).not.toContain("reachable");
});

test("flagging a healthy section coaches with SECTION_NOMINAL", async ({
  page,
}) => {
  const invocation = (await page.evaluate(() =>
    window.halcyonSim.invoke("flag_section", { section_id: "s1", priority: 1 }),
  )) as Invocation;

  expect(invocation.outcome.ok).toBe(false);
  expect(invocation.outcome.code).toBe("SECTION_NOMINAL");
});

test("flagging the jammed damaged section coaches with SECTION_UNREACHABLE", async ({
  page,
}) => {
  const invocation = (await page.evaluate(() =>
    window.halcyonSim.invoke("flag_section", { section_id: "s6", priority: 1 }),
  )) as Invocation;

  expect(invocation.outcome.ok).toBe(false);
  expect(invocation.outcome.code).toBe("SECTION_UNREACHABLE");
});

test("flag_section accepts only its section enum and integer priority range", async ({
  page,
}) => {
  for (const priority of [1, 3]) {
    const invocation = (await page.evaluate(
      (value) =>
        window.halcyonSim.invoke("flag_section", {
          section_id: "s2",
          priority: value,
        }),
      value,
    )) as Invocation;
    expect(invocation.outcome.ok, `priority ${priority} must be accepted`).toBe(
      true,
    );
  }

  for (const args of [
    { section_id: "s2", priority: 0 },
    { section_id: "s2", priority: 4 },
    { section_id: "s2", priority: 1.5 },
    { section_id: "s7", priority: 1 },
  ]) {
    const invocation = (await page.evaluate(
      (invalidArgs) => window.halcyonSim.invoke("flag_section", invalidArgs),
      args,
    )) as Invocation;
    expect(
      invocation.outcome.code,
      `${JSON.stringify(args)} must be rejected by the input schema`,
    ).toBe("INVALID_ARGS");
  }
});

test("acknowledging an unflagged section does not complete Manifest", async ({
  page,
}) => {
  await page.locator('[data-section="s2"]').click();

  expect(
    await page.evaluate(() => window.halcyonSim.getState().chapterDone[2]),
  ).toBe(false);
  expect(
    await page.evaluate(
      () => window.halcyonSim.getState().flags["manifest.flagged"],
    ),
  ).toBeUndefined();
  const agentFlag = (await page.evaluate(() =>
    window.halcyonSim.invoke("flag_section", { section_id: "s2", priority: 1 }),
  )) as Invocation;
  expect(agentFlag.outcome).toMatchObject({
    ok: true,
    data: { section_id: "s2", flagged: true },
  });
});

test("flag plus human acknowledgement on the three reachable damaged sections completes Manifest", async ({
  page,
}) => {
  for (const sectionId of ["s2", "s4", "s5"]) {
    const invocation = (await page.evaluate(
      (id) =>
        window.halcyonSim.invoke("flag_section", {
          section_id: id,
          priority: 1,
        }),
      sectionId,
    )) as Invocation;
    expect(
      invocation.outcome.ok,
      `${sectionId} must be accepted by the agent tool`,
    ).toBe(true);
    await page.locator(`[data-section="${sectionId}"]`).click();
  }

  await expect
    .poll(() =>
      page.evaluate(() => window.halcyonSim.getState().chapterDone[2]),
    )
    .toBe(true);
  expect(
    await page.evaluate(
      () => window.halcyonSim.getState().flags["manifest.flagged"],
    ),
  ).toEqual(["s2", "s4", "s5"]);
});

test("a flagged section can be acknowledged from the keyboard", async ({
  page,
}) => {
  const invocation = (await page.evaluate(() =>
    window.halcyonSim.invoke("flag_section", { section_id: "s2", priority: 1 }),
  )) as Invocation;
  expect(invocation.outcome.ok).toBe(true);

  await page.locator('[data-section="s2"]').focus();
  await page.keyboard.press("Enter");

  await expect(
    page.locator('[data-section="s2"] .manifest-section-panel'),
  ).toHaveClass(/section-acknowledged/);
});

test("chapter select renders the six-section Manifest deck map", async ({
  page,
}) => {
  await page.goto("/?fast=1&sim=1");
  await page.getByTestId("goto-ch2").click();

  await expect(page.locator("[data-section]")).toHaveCount(6);
  await expect(page.locator('[data-section="s2"]')).toBeVisible();
  await expect(page.locator('[data-section="s6"]')).toBeVisible();
  await expect(
    page.locator('[data-section="s2"] .hatch-dot-open'),
  ).toBeVisible();
  await expect(
    page.locator('[data-section="s6"] .hatch-dot-jammed'),
  ).toBeVisible();
});
