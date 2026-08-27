import { expect, test, type Page } from "@playwright/test";

type Invocation = {
  outcome: {
    ok: boolean;
    code?: string;
    detail?: string;
    data?: Record<string, unknown>;
    human_action?: unknown;
    wait_for?: unknown;
  };
};

const JUMP_VECTOR = { x: 0.42, y: -1.07, z: 3.14 };
const CREW_ONLY_LABEL =
  "physical control, crew hands only; HALCYON must ask the crew, not operate it";

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

async function holdFor(page: Page, testId: string, ms: number): Promise<void> {
  const target = page.getByTestId(testId);
  const box = await target.boundingBox();
  expect(box, `${testId} must have a physical pointer target`).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

async function completeBurnChecklist(page: Page): Promise<void> {
  expect(
    (await invoke(page, "set_jump_vector", JUMP_VECTOR)).outcome.ok,
    "the decoded jump vector must be accepted by the production tool",
  ).toBe(true);
  expect(
    (await invoke(page, "pressurize_injectors")).outcome.ok,
    "injectors must pressurize only after the agent locks the vector",
  ).toBe(true);
  for (let tap = 0; tap < 4; tap += 1) {
    await page.getByTestId("inject-tap").click();
    await page.waitForTimeout(120);
  }
  await holdFor(page, "shutter-left", 300);
  await holdFor(page, "shutter-right", 300);
  expect(
    (await invoke(page, "ignite_precheck")).outcome.ok,
    "the agent precheck must see the human priming and shutter work",
  ).toBe(true);
  await holdFor(page, "throttle", 1_400);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/?fast=1&sim=1&ch=6");
});

test("Burn tool descriptions declare the HALCYON sequence and crew physical work", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const registered: Array<{ name: string; description: string }> = [];
    Object.defineProperty(window, "__burnToolDescriptions", {
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
  await page.goto("/?fast=1&sim=1&ch=6");

  const descriptions = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __burnToolDescriptions: Array<{ name: string; description: string }>;
        }
      ).__burnToolDescriptions,
  );

  expect(
    descriptions.filter(({ name }) =>
      [
        "set_jump_vector",
        "pressurize_injectors",
        "ignite_precheck",
        "execute_jump",
      ].includes(name),
    ),
  ).toEqual([
    {
      name: "set_jump_vector",
      description:
        "HALCYON loads the decoded jump vector; the crew alone primes the physical injectors, latches both physical blast shutters, and holds the physical throttle when HALCYON asks.",
    },
    {
      name: "pressurize_injectors",
      description:
        "HALCYON pressurizes the drive injectors after locking the jump vector; the crew alone primes the physical injectors on the beat and latches both physical blast shutters.",
    },
    {
      name: "ignite_precheck",
      description:
        "HALCYON runs the pre-ignition checklist after the crew completes the physical injector and shutter work; the crew alone holds the physical throttle after HALCYON returns GO.",
    },
    {
      name: "execute_jump",
      description:
        "HALCYON lights the drive and executes the jump only after its GO precheck; the crew alone completes the physical throttle hold that HALCYON must wait for.",
    },
  ]);
});

test("Burn gate responses return crew handoff fields for valid errors and successes", async ({
  page,
}) => {
  const pressBeforeVector = await invoke(page, "pressurize_injectors");
  expect(pressBeforeVector.outcome.code).toBe("SEQUENCE_ORDER");

  const wrongVector = await invoke(page, "set_jump_vector", {
    x: 1,
    y: 2,
    z: 3,
  });
  expect(wrongVector.outcome.code).toBe("VECTOR_MISMATCH");
  const lockedVector = await invoke(page, "set_jump_vector", JUMP_VECTOR);
  expect(lockedVector.outcome.ok).toBe(true);
  const pressurized = await invoke(page, "pressurize_injectors");
  expect(pressurized.outcome.ok).toBe(true);

  const precheckBeforeCrewWork = await invoke(page, "ignite_precheck");
  expect(precheckBeforeCrewWork.outcome.code).toBe("NOT_READY");
  for (let tap = 0; tap < 4; tap += 1) {
    await page.getByTestId("inject-tap").click();
    await page.waitForTimeout(120);
  }
  await holdFor(page, "shutter-left", 300);
  await holdFor(page, "shutter-right", 300);
  const precheckGo = await invoke(page, "ignite_precheck");
  expect(precheckGo.outcome.ok).toBe(true);

  const jumpBeforeThrottle = await invoke(page, "execute_jump");
  expect(jumpBeforeThrottle.outcome.code).toBe("NOT_READY");
  await holdFor(page, "throttle", 1_400);
  const jumped = await invoke(page, "execute_jump");
  expect(jumped.outcome.ok).toBe(true);

  for (const [label, response] of [
    ["press before vector", pressBeforeVector],
    ["wrong vector", wrongVector],
    ["locked vector", lockedVector],
    ["pressurized injectors", pressurized],
    ["precheck before crew work", precheckBeforeCrewWork],
    ["precheck GO", precheckGo],
    ["jump before throttle", jumpBeforeThrottle],
    ["jump complete", jumped],
  ] as const) {
    expectCrewHandoff(label, response);
  }
  expect(pressurized.outcome.wait_for).toContain("ignite_precheck");
  expect(precheckGo.outcome.wait_for).toContain("execute_jump");
  expect(jumpBeforeThrottle.outcome.wait_for).toContain("throttle");
});

test("wrong vector coaches VECTOR_MISMATCH; precheck names what is missing", async ({
  page,
}) => {
  expect(
    await page.evaluate(() => window.halcyonSim.listTools()),
    "Chapter 6 must add exactly its four production tools beside the three global tools",
  ).toEqual([
    "get_ship_state",
    "broadcast",
    "read_boot_briefing",
    "set_jump_vector",
    "pressurize_injectors",
    "ignite_precheck",
    "execute_jump",
  ]);
  const wrongVector = await invoke(page, "set_jump_vector", {
    x: 1,
    y: 2,
    z: 3,
  });
  expect(wrongVector.outcome.code).toBe("VECTOR_MISMATCH");

  const precheck = await invoke(page, "ignite_precheck");
  expect(precheck.outcome.code).toBe("NOT_READY");
  expect(precheck.outcome.detail).toContain("jump_vector");
  const visibleText = await page.getByTestId("stage").textContent();
  expect(visibleText).not.toContain("0.42");
  expect(visibleText).not.toContain("-1.07");
  expect(visibleText).not.toContain("3.14");
});

test("the full interleaved checklist reaches the jump and the replay", async ({
  page,
}) => {
  const prematureJump = await invoke(page, "execute_jump");
  expect(
    prematureJump.outcome.code,
    "the agent must not jump before any human or agent checklist work",
  ).toBe("NOT_READY");
  expect(
    prematureJump.outcome.detail,
    "a premature jump must name the missing decoded vector instead of a generic deferral",
  ).toContain("jump_vector");

  await completeBurnChecklist(page);
  const jump = await invoke(page, "execute_jump");
  expect(jump.outcome).toMatchObject({ ok: true, data: { jumped: true } });
  await expect(page.getByTestId("victory-card")).toBeVisible();
  await expect(page.getByTestId("replay-timeline")).toContainText(
    "execute_jump",
  );
  await expect
    .poll(() =>
      page.evaluate(() => window.halcyonSim.getState().chapterDone[6]),
    )
    .toBe(true);
});

test("Burn exposes crew-only physical controls without bypassing physical completion", async ({
  page,
}) => {
  await expect(page.getByTestId("inject-tap")).toBeVisible();
  await expect(page.getByTestId("shutter-left")).toBeVisible();
  await expect(page.getByTestId("shutter-right")).toBeVisible();
  await expect(page.getByTestId("throttle")).toBeVisible();
  await expect(page.getByTestId("inject-tap")).toHaveAccessibleName(
    `Prime injectors on the metronome beat — ${CREW_ONLY_LABEL}`,
  );
  await expect(page.getByTestId("shutter-left")).toHaveAccessibleName(
    `Hold left blast shutter until it latches — ${CREW_ONLY_LABEL}`,
  );
  await expect(page.getByTestId("shutter-right")).toHaveAccessibleName(
    `Hold right blast shutter until it latches — ${CREW_ONLY_LABEL}`,
  );
  await expect(page.getByTestId("throttle")).toHaveAccessibleName(
    `Hold throttle through the shake — ${CREW_ONLY_LABEL}`,
  );
  const stageText = await page.getByTestId("stage").textContent();
  for (const toolName of [
    "set_jump_vector",
    "pressurize_injectors",
    "ignite_precheck",
    "execute_jump",
  ]) {
    expect(
      stageText,
      `${toolName} must not be offered as a UI action`,
    ).not.toContain(toolName);
  }
});
