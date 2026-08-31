import { expect, test, type Page } from "@playwright/test";

type Invocation = {
  outcome: {
    ok: boolean;
    code?: string;
    human_action?: string;
    wait_for?: string;
  };
};

async function dragBreaker(
  page: Page,
  {
    distance = 160,
    pauseMs = 60,
  }: { distance?: number; pauseMs?: number } = {},
): Promise<void> {
  const handle = page.getByTestId("breaker-handle");
  const box = await handle.boundingBox();
  if (!box) throw new Error("breaker handle must have a visible hit target");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;

  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 8; step += 1) {
    await page.mouse.move(x, y - (distance * step) / 8);
    if (pauseMs > 0) await page.waitForTimeout(pauseMs);
  }
  await page.mouse.up();
}

test("handshake before mains fails with NO_MAINS_POWER and keeps the ship unbooted", async ({
  page,
}) => {
  await page.goto("/?fast=1&sim=1");

  const names = await page.evaluate(() => window.halcyonSim.listTools());
  expect(names).toEqual(["read_boot_briefing", "boot_handshake"]);
  const invocation = (await page.evaluate(() =>
    window.halcyonSim.invoke("boot_handshake", {}),
  )) as Invocation;

  expect(invocation.outcome.ok).toBe(false);
  expect(invocation.outcome.code).toBe("NO_MAINS_POWER");
  expect(await page.evaluate(() => window.halcyonSim.getState().booted)).toBe(
    false,
  );
});

test("boot handshake returns crew handoff fields on success and no mains error", async ({
  page,
}) => {
  await page.goto("/?fast=1&sim=1");

  const noMains = (await page.evaluate(() =>
    window.halcyonSim.invoke("boot_handshake", {}),
  )) as Invocation;
  expect(noMains.outcome.ok).toBe(false);
  expect(noMains.outcome.human_action).toMatch(/master breaker/i);
  expect(noMains.outcome.wait_for).toMatch(/mains/i);

  await dragBreaker(page);
  const booted = (await page.evaluate(() =>
    window.halcyonSim.invoke("boot_handshake", {}),
  )) as Invocation;
  expect(booted.outcome.ok).toBe(true);
  expect(booted.outcome.human_action).toMatch(/master-breaker/i);
  expect(booted.outcome.wait_for).toMatch(/get_ship_state/i);
});

test("Contact exposes the crew-only breaker contract", async ({ page }) => {
  await page.goto("/?fast=1&sim=1");

  await expect(page.getByTestId("breaker-handle")).toHaveAttribute(
    "aria-label",
    "Master breaker — physical control, crew hands only; HALCYON must ask the crew, not operate it",
  );
  await dragBreaker(page);
  await expect(page.getByTestId("speaker-panel")).toContainText(
    "Mains open. HALCYON, call boot_handshake now",
  );
});

test("contact crew action names the physical action report channel and next role", async ({
  page,
}) => {
  await page.goto("/?fast=1&sim=1");

  const action = page.getByTestId("crew-action-ch1");
  await expect(action).toContainText("CREW ACTION");
  await expect(action).toContainText("Pull and hold the master breaker");
  await expect(action).toContainText("breaker up");
  await expect(action).toContainText("HALCYON");
});

test("a breaker drag shorter than 300ms does not open the mains window", async ({
  page,
}) => {
  await page.goto("/?fast=1&sim=1");

  await dragBreaker(page, { pauseMs: 0 });
  const invocation = (await page.evaluate(() =>
    window.halcyonSim.invoke("boot_handshake", {}),
  )) as Invocation;

  expect(invocation.outcome.ok).toBe(false);
  expect(invocation.outcome.code).toBe("NO_MAINS_POWER");
  await expect(page.getByTestId("breaker-handle")).toHaveAttribute("y", "180");
});

test("a held breaker drag that misses the top does not open the mains window", async ({
  page,
}) => {
  await page.goto("/?fast=1&sim=1");

  await dragBreaker(page, { distance: 80 });
  const invocation = (await page.evaluate(() =>
    window.halcyonSim.invoke("boot_handshake", {}),
  )) as Invocation;

  expect(invocation.outcome.ok).toBe(false);
  expect(invocation.outcome.code).toBe("NO_MAINS_POWER");
  await expect(page.getByTestId("breaker-handle")).toHaveAttribute("y", "180");
});

test("breaker plus a timely handshake boots the ship, advances, and registers global tools", async ({
  page,
}) => {
  await page.goto("/?fast=1&sim=1");

  await dragBreaker(page);
  const invocation = (await page.evaluate(() =>
    window.halcyonSim.invoke("boot_handshake", {}),
  )) as Invocation;

  expect(invocation.outcome.ok).toBe(true);
  await expect
    .poll(() => page.evaluate(() => window.halcyonSim.getState().booted))
    .toBe(true);
  await expect
    .poll(() => page.evaluate(() => window.halcyonSim.getState().chapter))
    .toBe(2);
  const names = await page.evaluate(() => window.halcyonSim.listTools());
  expect(names).toContain("get_ship_state");
  expect(names).toContain("broadcast");
});

test("contact handoff reports progress expiry and the next role", async ({
  page,
}) => {
  await page.goto("/?fast=1&sim=1");

  await dragBreaker(page);
  await expect(page.getByTestId("ch1-mains-status")).toContainText(
    "MAINS OPEN",
  );
  await expect(page.getByTestId("speaker-panel")).toContainText(
    "HALCYON, call boot_handshake now",
  );
  await page.waitForTimeout(2_100);
  await expect(page.getByTestId("breaker-handle")).toHaveAttribute("y", "180");
  await expect(page.getByTestId("ch1-mains-status")).toContainText(
    "CREW: pull and hold the breaker again",
  );
  await expect(page.getByTestId("ch1-mains-status")).toContainText("HALCYON");
  const invocation = (await page.evaluate(() =>
    window.halcyonSim.invoke("boot_handshake", {}),
  )) as Invocation;

  expect(invocation.outcome.ok).toBe(false);
  expect(invocation.outcome.code).toBe("NO_MAINS_POWER");
});

test("normal-mode mains survives a conversational delay", async ({ page }) => {
  await page.goto("/?sim=1");

  await dragBreaker(page);
  await page.waitForTimeout(6_000);
  const invocation = (await page.evaluate(() =>
    window.halcyonSim.invoke("boot_handshake", {}),
  )) as Invocation;

  expect(invocation.outcome.ok).toBe(true);
  expect(await page.evaluate(() => window.halcyonSim.getState().booted)).toBe(
    true,
  );
});

test("contact has no alternate boot control", async ({ page }) => {
  await page.goto("/?fast=1&sim=1");

  await expect(
    page.locator("section[aria-label='Master breaker'] button"),
  ).toHaveCount(0);
  const beforeDrag = (await page.evaluate(() =>
    window.halcyonSim.invoke("boot_handshake", {}),
  )) as Invocation;
  expect(beforeDrag.outcome.code).toBe("NO_MAINS_POWER");
  expect(await page.evaluate(() => window.halcyonSim.getState().booted)).toBe(
    false,
  );

  await dragBreaker(page);
  const afterDrag = (await page.evaluate(() =>
    window.halcyonSim.invoke("boot_handshake", {}),
  )) as Invocation;
  expect(afterDrag.outcome.ok).toBe(true);
  expect(await page.evaluate(() => window.halcyonSim.getState().booted)).toBe(
    true,
  );
});
