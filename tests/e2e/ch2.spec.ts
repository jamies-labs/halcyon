import { expect, test } from "@playwright/test";

type Invocation = {
  outcome: {
    ok: boolean;
    code?: string;
    data?: unknown;
    human_action?: string;
    wait_for?: string;
  };
};

type RegisteredTool = {
  name: string;
  description?: string;
  annotations?: { readOnlyHint?: boolean };
};

test.beforeEach(async ({ page }) => {
  await page.goto("/?fast=1&sim=1&ch=2");
});

test("Manifest tool descriptions declare the agent and crew roles", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const registeredTools: Array<{
      name: string;
      description?: string;
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
          description?: string;
          annotations?: { readOnlyHint?: boolean };
        }) {
          registeredTools.push({
            name: tool.name,
            description: tool.description,
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
    description:
      "HALCYON reads the internal damage manifest and flags damaged sections; the crew physically confirms reachable hatch sections on the deck map.",
  });

  const flagTool = await page.evaluate(() =>
    (
      window as typeof window & {
        __manifestRegisteredTools: RegisteredTool[];
      }
    ).__manifestRegisteredTools.find((tool) => tool.name === "flag_section"),
  );
  expect(flagTool?.description).toBe(
    "HALCYON flags a damaged hull section for repair triage; the crew physically confirms that reachable hatch section on the deck map.",
  );
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

test("flag section returns crew handoff fields for accepted and rejected triage", async ({
  page,
}) => {
  const invoke = async (sectionId: string): Promise<Invocation> =>
    (await page.evaluate(
      (id) =>
        window.halcyonSim.invoke("flag_section", {
          section_id: id,
          priority: 1,
        }),
      sectionId,
    )) as Invocation;

  for (const [sectionId, expectedCode] of [
    ["s2", undefined],
    ["s2", undefined],
    ["s1", "SECTION_NOMINAL"],
    ["s6", "SECTION_UNREACHABLE"],
  ] as const) {
    const invocation = await invoke(sectionId);
    expect(
      invocation.outcome.code,
      `${sectionId} must retain its triage outcome`,
    ).toBe(expectedCode);
    expect(
      invocation.outcome.human_action,
      `${sectionId} must tell the crew to acknowledge the physical deck-map section`,
    ).toMatch(/crew.*deck map/i);
    expect(
      invocation.outcome.wait_for,
      `${sectionId} must name the acknowledgement state HALCYON waits to observe`,
    ).toMatch(/acknowledg/i);
  }
});

test("flag_section accepts only its section enum and integer priority range", async ({
  page,
}) => {
  for (const { sectionId, priority } of [
    { sectionId: "s2", priority: 1 },
    { sectionId: "s4", priority: 3 },
  ]) {
    const invocation = (await page.evaluate(
      ({ id, value }) =>
        window.halcyonSim.invoke("flag_section", {
          section_id: id,
          priority: value,
        }),
      { id: sectionId, value: priority },
    )) as Invocation;
    expect(
      invocation.outcome,
      `${sectionId} at priority ${priority} must create a triage flag`,
    ).toMatchObject({
      ok: true,
      data: {
        section_id: sectionId,
        flagged: true,
        awaiting: "crew acknowledgement on the deck map",
      },
    });
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

test("Manifest exposes crew-only deck controls without losing triage completion", async ({
  page,
}) => {
  const crewOnlyName =
    "physical control, crew hands only; HALCYON must ask the crew, not operate it";
  const sections = page.locator("[data-section]");
  await expect(sections).toHaveCount(6);
  for (const sectionId of ["s1", "s2", "s3", "s4", "s5", "s6"]) {
    await expect(page.locator(`[data-section="${sectionId}"]`)).toHaveAttribute(
      "aria-label",
      new RegExp(crewOnlyName),
    );
  }

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
    await page.locator(`[data-section="${sectionId}"]`).focus();
    await page.keyboard.press("Enter");
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

test("Manifest broadcast and review selector preserve cooperative evidence", async ({
  page,
}) => {
  await expect(page.locator("[data-section=s2]")).toBeVisible();
  await expect(page.getByTestId("speaker-panel")).toContainText(
    "HALCYON reads the damage manifest; crew confirms reachable hatch sections on the deck map.",
  );

  for (const sectionId of ["s2", "s4", "s5"]) {
    const invocation = (await page.evaluate(
      (id) =>
        window.halcyonSim.invoke("flag_section", {
          section_id: id,
          priority: 1,
        }),
      sectionId,
    )) as Invocation;
    expect(invocation.outcome.ok).toBe(true);
    await page.locator(`[data-section="${sectionId}"]`).click();
  }
  await expect(page.getByTestId("speaker-panel")).toContainText(
    "HALCYON flagged the manifest; crew deck-map confirmation is complete.",
  );
});
