import { expect, test, type Page } from "@playwright/test";

type Invocation = {
  outcome: { ok: boolean; code?: string };
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

test("an expired mains window pops the breaker home and allows another attempt", async ({
  page,
}) => {
  await page.goto("/?fast=1&sim=1");

  await dragBreaker(page);
  await page.waitForTimeout(2_100);
  await expect(page.getByTestId("breaker-handle")).toHaveAttribute("y", "180");
  const invocation = (await page.evaluate(() =>
    window.halcyonSim.invoke("boot_handshake", {}),
  )) as Invocation;

  expect(invocation.outcome.ok).toBe(false);
  expect(invocation.outcome.code).toBe("NO_MAINS_POWER");
});
