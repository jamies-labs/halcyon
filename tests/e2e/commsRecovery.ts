import { expect, type Page } from "@playwright/test";

type Invocation = {
  outcome: {
    ok: boolean;
    data?: Record<string, unknown>;
  };
};

type ToolDefinition = {
  name: string;
  inputSchema: {
    properties?: {
      offset_khz?: { minimum?: unknown; maximum?: unknown };
    };
  };
};

type Invoke = (name: string, args?: unknown) => Promise<Invocation>;

function quality(record: Invocation, label: string): number {
  const value = record.outcome.data?.checksum_quality;
  expect(value, `${label} must return checksum_quality`).toBeTypeOf("number");
  return value as number;
}

export async function recoverDecoderFromToolResults(
  page: Page,
  invoke: Invoke,
): Promise<Invocation> {
  const tools = (await page.evaluate(() =>
    window.halcyonSim.listTools(),
  )) as ToolDefinition[];
  const offsetSchema = tools.find((tool) => tool.name === "tune_decoder")
    ?.inputSchema.properties?.offset_khz;
  const minimum = offsetSchema?.minimum;
  const maximum = offsetSchema?.maximum;
  expect(
    minimum,
    "registered schema must publish the offset lower bound",
  ).toBeTypeOf("number");
  expect(
    maximum,
    "registered schema must publish the offset upper bound",
  ).toBeTypeOf("number");

  const firstOffset = minimum as number;
  const firstTune = await invoke("tune_decoder", { offset_khz: firstOffset });
  const firstQuality = quality(firstTune, "initial boundary tune");
  expect(
    firstQuality,
    "the recovery must begin with a non-optimal legal tune",
  ).toBeLessThan(0.95);
  expect(firstTune.outcome.data?.offset_khz).toBe(firstOffset);

  const nextOffset =
    (minimum as number) + Math.floor(((maximum as number) - firstOffset) / 3);
  expect(
    nextOffset,
    "the next tune must be derived from the published bounds",
  ).toBeGreaterThan(firstOffset);
  expect(nextOffset).toBeLessThanOrEqual(maximum as number);
  const nextTune = await invoke("tune_decoder", { offset_khz: nextOffset });
  const nextQuality = quality(nextTune, "result-derived follow-up tune");
  expect(nextTune.outcome.data?.offset_khz).toBe(nextOffset);
  expect(
    nextQuality,
    "the returned quality must identify the stronger tune",
  ).toBeGreaterThan(firstQuality);
  expect(
    nextQuality,
    "decode must only follow a result at the documented threshold",
  ).toBeGreaterThanOrEqual(0.95);

  const decoded = await invoke("decode_reply");
  expect(decoded.outcome.ok, "a qualifying result must decode the reply").toBe(
    true,
  );
  return decoded;
}
