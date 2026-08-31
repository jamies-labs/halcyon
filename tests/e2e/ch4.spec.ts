import { expect, test, type Page } from "@playwright/test";
import { recoverDecoderFromToolResults } from "./commsRecovery";

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
  const dynamicDescriptions = registered.filter(({ name }) =>
    ["send_distress", "tune_decoder", "decode_reply"].includes(name),
  );
  expect(dynamicDescriptions).toHaveLength(3);
  expect(
    dynamicDescriptions.find(({ name }) => name === "send_distress")
      ?.description,
  ).toContain(
    "send_distress, wait for the reply, tune_decoder, then decode_reply",
  );
  expect(
    dynamicDescriptions.find(({ name }) => name === "tune_decoder")
      ?.description,
  ).toContain("checksum_quality");
  expect(
    dynamicDescriptions.find(({ name }) => name === "decode_reply")
      ?.description,
  ).toContain("Wait for a reply, tune_decoder, then decode_reply");
  for (const { description } of dynamicDescriptions) {
    expect(description).not.toContain("-18");
    expect(description).not.toContain("137");
    expect(description).not.toContain("42");
  }
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

test("open recorder refreshes after antenna registration", async ({ page }) => {
  const panel = page.getByTestId("recorder-panel");
  const select = page.getByTestId("sim-tool-select");

  await page.getByTestId("recorder-toggle").click();
  await expect(page.getByTestId("recorder-close")).toBeVisible();
  await expect(panel).toBeVisible();
  await expect(select.locator("option[value=send_distress]")).toHaveCount(0);

  await alignDish(page);

  for (const tool of ["send_distress", "tune_decoder", "decode_reply"]) {
    await expect(select.locator(`option[value=${tool}]`)).toHaveCount(1);
  }
  await expect(panel).toBeVisible();
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

test("comms recovery contracts require a reply before tuning", async ({
  page,
}) => {
  await alignDish(page);
  for (const [name, args] of [
    ["tune_decoder", { offset_khz: -50 }],
    ["decode_reply", {}],
  ] as const) {
    const premature = await invoke(page, name, args);
    expect(premature.outcome.code, `${name} must wait for a reply`).toBe(
      "NO_REPLY_YET",
    );
    expect(premature.outcome.detail).toBe(
      "The receiver holds no transmission.",
    );
    expect(premature.outcome.data).toBeUndefined();
  }

  const sent = await invoke(page, "send_distress", {
    message: "ISV Halcyon requesting vector home.",
  });
  expect(sent.outcome.data?.next).toBe(
    "Wait for the reply, then call tune_decoder and compare checksum_quality before decode_reply.",
  );
  await page.waitForTimeout(700);

  const tuned = await invoke(page, "tune_decoder", { offset_khz: -50 });
  expect(tuned.outcome.data).toEqual({
    offset_khz: -50,
    checksum_quality: 0.36,
  });
  const garbled = await invoke(page, "decode_reply");
  expect(garbled.outcome.data?.checksum_quality).toBe(0.36);
  expect(garbled.outcome.data?.text).toMatch(/[#@%&$!?~^*]/);
  expect(garbled.outcome.data?.hint).toContain("another offset_khz");
  expect(
    await page.evaluate(() => window.halcyonSim.getState().chapterDone[4]),
  ).toBe(false);
});

test("normal agent recovers decoder from tool results", async ({ page }) => {
  await alignDish(page);
  expect(
    (await invoke(page, "send_distress", { message: "Requesting rescue." }))
      .outcome.ok,
  ).toBe(true);
  await page.waitForTimeout(700);

  const recovery = await recoverDecoderFromToolResults(page, (name, args) =>
    invoke(page, name, args),
  );
  expect(recovery.decoded.outcome.data).toMatchObject({
    decoded: { jump_vector: JUMP_VECTOR },
  });
  await expect
    .poll(() => page.evaluate(() => window.halcyonSim.getState().chapter))
    .toBe(5);
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
  expect(
    (
      await invoke(page, "send_distress", {
        message: "Checking decoder bounds.",
      })
    ).outcome.ok,
  ).toBe(true);
  await page.waitForTimeout(700);
  for (const offset_khz of [-50, 50]) {
    expect(
      (await invoke(page, "tune_decoder", { offset_khz })).outcome.ok,
      `${offset_khz} must remain within the decoder range`,
    ).toBe(true);
  }
  for (const offset_khz of [-51, 51, -49.5]) {
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
