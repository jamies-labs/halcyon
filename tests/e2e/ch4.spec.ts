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
  await moveDish(page, 137, 42);
  await page.waitForTimeout(800);
}

async function moveDish(
  page: Page,
  azimuth: number,
  elevation: number,
): Promise<void> {
  const pad = await page.getByTestId("dish-pad").boundingBox();
  const knob = await page.getByTestId("dish-knob").boundingBox();
  expect(pad, "dish pad must have a physical target").not.toBeNull();
  expect(knob, "dish knob must have a physical target").not.toBeNull();

  const targetX = pad!.x + (azimuth / 180) * pad!.width;
  const targetY = pad!.y + (elevation / 90) * pad!.height;
  await page.mouse.move(knob!.x + knob!.width / 2, knob!.y + knob!.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetX, targetY, { steps: 10 });
  await page.mouse.up();
}

async function alignDishWithKeyboard(page: Page): Promise<void> {
  await page.getByTestId("dish-knob").focus();
  for (let index = 0; index < 58; index += 1) {
    await page.keyboard.press("ArrowRight");
  }
  for (let index = 0; index < 14; index += 1) {
    await page.keyboard.press("ArrowUp");
  }
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

test("Antenna tool descriptions declare the agent and crew roles", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const registered: Array<{ name: string; description: string }> = [];
    Object.defineProperty(window, "__antennaToolDescriptions", {
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
  await page.goto("/?fast=1&sim=1&ch=4");

  const descriptions = async (): Promise<
    Array<{ name: string; description: string }>
  > =>
    page.evaluate(
      () =>
        (
          window as typeof window & {
            __antennaToolDescriptions: Array<{
              name: string;
              description: string;
            }>;
          }
        ).__antennaToolDescriptions,
    );

  expect(
    (await descriptions()).find(({ name }) => name === "read_signal_meter")
      ?.description,
  ).toBe(
    "HALCYON reads the coarse signal meter; it must wait for the crew's physical antenna alignment to reach LOCK before comms tools can operate.",
  );

  await alignDish(page);
  const registered = await descriptions();
  expect(
    registered.find(({ name }) => name === "send_distress")?.description,
  ).toBe(
    "HALCYON operates the distress transmitter only after the crew's physical antenna alignment locks comms; the crew alone aligns the dish.",
  );
  expect(
    registered.find(({ name }) => name === "tune_decoder")?.description,
  ).toBe(
    "HALCYON operates the decoder after the crew's physical antenna alignment locks comms; the crew alone aligns the dish. Set the decoder frequency offset in kHz (-50 to 50). Returns checksum_quality (0 to 1); the reply decodes at 0.95 or better.",
  );
  expect(
    registered.find(({ name }) => name === "decode_reply")?.description,
  ).toBe(
    "HALCYON operates reply decoding after the crew's physical antenna alignment locks comms; the crew alone aligns the dish. Below 0.95 checksum_quality the text is garbled.",
  );
});

test("signal meter returns the crew alignment handoff", async ({ page }) => {
  const far = await invoke(page, "read_signal_meter");
  await moveDish(page, 115, 42);
  const near = await invoke(page, "read_signal_meter");
  await alignDish(page);
  const lock = await invoke(page, "read_signal_meter");

  for (const [label, meter, band] of [
    ["FAR", far, "FAR"],
    ["NEAR", near, "NEAR"],
    ["LOCK", lock, "LOCK"],
  ] as const) {
    expect(meter.outcome.data?.band, `${label} meter band`).toBe(band);
    expect(
      meter.outcome.human_action,
      `${label} response must name the crew's physical alignment`,
    ).toBe("Crew physically aligns the antenna dish by hand.");
    expect(
      meter.outcome.wait_for,
      `${label} response must name the observable lock/comms state`,
    ).toBe("Wait for band LOCK and comms_online true.");
  }
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
  await expect(
    page.getByRole("button", {
      name: "physical control, crew hands only; HALCYON must ask the crew, not operate it",
    }),
  ).toBeVisible();
  await expect(page.getByTestId("dish-knob")).toHaveAttribute(
    "aria-label",
    "physical control, crew hands only; HALCYON must ask the crew, not operate it",
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

test("Antenna exposes a crew-only dish and unlocks dynamic tools", async ({
  page,
}) => {
  const dish = page.getByRole("button", {
    name: "physical control, crew hands only; HALCYON must ask the crew, not operate it",
  });
  await expect(dish).toBeVisible();
  expect(
    await page.evaluate(() => window.halcyonSim.listTools()),
  ).not.toContain("send_distress");

  await alignDishWithKeyboard(page);
  await expect
    .poll(() => page.evaluate(() => window.halcyonSim.listTools()))
    .toEqual(
      expect.arrayContaining(["send_distress", "tune_decoder", "decode_reply"]),
    );
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

test("Antenna broadcast and review scenario preserve cooperative evidence", async ({
  page,
}) => {
  await expect(page.getByTestId("speaker-panel")).toContainText(
    "HALCYON reads the coarse meter and operates the comms tools; crew performs the fine physical antenna alignment.",
  );

  await alignDish(page);
  await expect(page.getByTestId("speaker-panel")).toContainText(
    "My coarse meter confirms LOCK; your fine physical alignment brought us here, crew.",
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
    ({ variant }) => variant === "chapter-four-antenna",
  );

  expect(scenario?.route).toBe("/");
  expect(scenario?.state).toBe("resolved");
  expect(scenario?.viewports).toEqual([375, 1280]);
  expect(scenario?.theme).toBe("light");
  expect(scenario?.ready_selector).toBe("[data-testid=dish-readout]");
  expect(scenario?.covers.changedPaths).toEqual([
    "src/game/chapters/ch4_antenna.ts",
  ]);
  expect(Array.isArray(scenario?.covers.requirementKeys)).toBe(true);
  for (const key of scenario?.covers.requirementKeys ?? []) {
    expect(key).toMatch(/^AC\d+/);
  }
});
