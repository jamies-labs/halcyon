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

async function alignDish(page: Page): Promise<void> {
  const pad = await page.getByTestId("dish-pad").boundingBox();
  const knob = await page.getByTestId("dish-knob").boundingBox();
  expect(pad, "dish pad must have a physical target").not.toBeNull();
  expect(knob, "dish knob must have a physical target").not.toBeNull();

  const targetX = pad!.x + (137 / 180) * pad!.width;
  const targetY = pad!.y + (42 / 90) * pad!.height;
  await page.mouse.move(knob!.x + knob!.width / 2, knob!.y + knob!.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetX, targetY, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(800);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/?fast=1&sim=1&ch=4");
});

test("Antenna registers its meter with the real read-only host annotation", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const registered: Array<{
      name: string;
      annotations?: { readOnlyHint?: boolean };
    }> = [];
    Object.defineProperty(window, "__antennaRegisteredTools", {
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
  await page.goto("/?fast=1&sim=1&ch=4");

  const meter = await page.evaluate(() =>
    (
      window as typeof window & {
        __antennaRegisteredTools: Array<{
          name: string;
          annotations?: { readOnlyHint?: boolean };
        }>;
      }
    ).__antennaRegisteredTools.find(
      (tool) => tool.name === "read_signal_meter",
    ),
  );
  expect(meter).toEqual({
    name: "read_signal_meter",
    annotations: { readOnlyHint: true },
  });

  await alignDish(page);
  const dynamicTools = await page.evaluate(() =>
    (
      window as typeof window & {
        __antennaRegisteredTools: Array<{
          name: string;
          annotations?: { readOnlyHint?: boolean };
        }>;
      }
    ).__antennaRegisteredTools.filter((tool) =>
      ["send_distress", "tune_decoder", "decode_reply"].includes(tool.name),
    ),
  );
  expect(dynamicTools.map((tool) => tool.name)).toEqual([
    "send_distress",
    "tune_decoder",
    "decode_reply",
  ]);
  expect(
    dynamicTools.find((tool) => tool.name === "decode_reply")?.annotations,
  ).toBeUndefined();
});

test("comms tools are absent before lock and appear after dynamic registration", async ({
  page,
}) => {
  expect(
    await page.evaluate(() => window.halcyonSim.listTools()),
  ).not.toContain("send_distress");
  expect(
    (await invoke(page, "send_distress", { message: "hello" })).outcome.code,
  ).toBe("UNKNOWN_TOOL");

  await alignDish(page);
  await expect
    .poll(() => page.evaluate(() => window.halcyonSim.listTools()))
    .toEqual(
      expect.arrayContaining(["send_distress", "tune_decoder", "decode_reply"]),
    );

  expect(
    await page.evaluate(
      () => window.halcyonSim.getState().flags["comms.online"],
    ),
  ).toBe(true);
  const meter = await invoke(page, "read_signal_meter");
  expect(meter.outcome.data).toMatchObject({
    band: "LOCK",
    locked: true,
    comms_online: true,
  });
});

test("dish maps pointer space to its physical ranges without leaking the vector", async ({
  page,
}) => {
  await expect(page.getByTestId("dish-pad")).toBeVisible();
  await expect(page.getByTestId("dish-knob")).toBeVisible();
  await expect(page.getByTestId("dish-readout")).toContainText(
    "AZ ~20° EL ~70°",
  );
  await expect(page.getByTestId("dish-pad")).toHaveAttribute(
    "aria-label",
    "Antenna azimuth and elevation control",
  );

  await alignDish(page);
  await expect(page.getByTestId("dish-readout")).toContainText(
    "AZ ~140° EL ~40°",
  );
  await expect(page.locator("[data-testid=stage] button")).toHaveCount(0);
  expect(await page.getByTestId("stage").textContent()).not.toContain("0.42");
  expect(await page.getByTestId("stage").textContent()).not.toContain("-1.07");
  expect(await page.getByTestId("stage").textContent()).not.toContain("3.14");
});

test("decode before any reply coaches NO_REPLY_YET; tune loop reaches the vector", async ({
  page,
}) => {
  await alignDish(page);
  expect((await invoke(page, "decode_reply")).outcome.code).toBe(
    "NO_REPLY_YET",
  );

  expect(
    (
      await invoke(page, "send_distress", {
        message: "ISV Halcyon requesting vector home.",
      })
    ).outcome.ok,
  ).toBe(true);
  await page.waitForTimeout(700);

  const garbled = await invoke(page, "decode_reply");
  expect(garbled.outcome.data?.checksum_quality).toBeLessThan(0.95);
  expect(
    (await invoke(page, "tune_decoder", { offset_khz: -18 })).outcome.data,
  ).toEqual({
    offset_khz: -18,
    checksum_quality: 1,
  });

  const decoded = await invoke(page, "decode_reply");
  expect(decoded.outcome.data).toMatchObject({
    checksum_quality: 1,
    decoded: { jump_vector: JUMP_VECTOR },
  });
  await expect
    .poll(() =>
      page.evaluate(() => window.halcyonSim.getState().chapterDone[4]),
    )
    .toBe(true);
  expect(
    await page.evaluate(
      () => window.halcyonSim.getState().flags["comms.jump_vector"],
    ),
  ).toEqual(JUMP_VECTOR);
  const visibleText = await page.locator("body").textContent();
  expect(visibleText).not.toContain("0.42");
  expect(visibleText).not.toContain("-1.07");
  expect(visibleText).not.toContain("3.14");
});

test("comms tools reject malformed messages and every decoder schema boundary", async ({
  page,
}) => {
  await alignDish(page);

  for (const args of [{}, { message: "" }, { message: "x".repeat(121) }]) {
    expect(
      (await invoke(page, "send_distress", args)).outcome.code,
      `${JSON.stringify(args)} must be rejected by the send_distress schema`,
    ).toBe("INVALID_ARGS");
  }
  for (const offset_khz of [-50, 50]) {
    expect(
      (await invoke(page, "tune_decoder", { offset_khz })).outcome.ok,
      `${offset_khz} must remain within the decoder range`,
    ).toBe(true);
  }
  for (const offset_khz of [-51, 51, -18.5]) {
    expect(
      (await invoke(page, "tune_decoder", { offset_khz })).outcome.code,
      `${offset_khz} must be rejected by the decoder schema`,
    ).toBe("INVALID_ARGS");
  }
});
