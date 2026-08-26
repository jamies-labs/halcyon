import { expect, test, type Page } from "@playwright/test";

type Invocation = {
  outcome: {
    ok: boolean;
    code?: string;
    detail?: string;
    data?: Record<string, unknown>;
  };
};

const JUMP_VECTOR = { x: 0.42, y: -1.07, z: 3.14 };

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

test("Burn renders only physical controls for its human checklist", async ({
  page,
}) => {
  await expect(page.getByTestId("inject-tap")).toBeVisible();
  await expect(page.getByTestId("shutter-left")).toBeVisible();
  await expect(page.getByTestId("shutter-right")).toBeVisible();
  await expect(page.getByTestId("throttle")).toBeVisible();
  await expect(page.getByTestId("inject-tap")).toHaveAccessibleName(
    /prime injectors/i,
  );
  await expect(page.getByTestId("throttle")).toHaveAccessibleName(
    /hold throttle/i,
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
