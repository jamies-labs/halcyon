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

export type DecoderRecovery = {
  qualifyingTune: Invocation;
  decoded: Invocation;
};

function quality(record: Invocation, label: string): number {
  const value = record.outcome.data?.checksum_quality;
  expect(typeof value, `${label} must return checksum_quality`).toBe("number");
  return value as number;
}

function recoveryOffsets(minimum: number, maximum: number): number[] {
  const earlyProbe = minimum + Math.floor((maximum - minimum) / 3);
  const candidates = [minimum, earlyProbe];
  for (let offset = earlyProbe + 1; offset <= maximum; offset += 1) {
    candidates.push(offset);
  }
  for (let offset = minimum + 1; offset < earlyProbe; offset += 1) {
    candidates.push(offset);
  }
  return [...new Set(candidates)];
}

export async function recoverDecoderFromToolResults(
  page: Page,
  invoke: Invoke,
): Promise<DecoderRecovery> {
  const tools = (await page.evaluate(() =>
    window.halcyonSim.inspectTools(),
  )) as ToolDefinition[];
  const offsetSchema = tools.find((tool) => tool.name === "tune_decoder")
    ?.inputSchema.properties?.offset_khz;
  const minimum = offsetSchema?.minimum;
  const maximum = offsetSchema?.maximum;
  expect(
    typeof minimum,
    "registered schema must publish the offset lower bound",
  ).toBe("number");
  expect(
    typeof maximum,
    "registered schema must publish the offset upper bound",
  ).toBe("number");

  const offsets = recoveryOffsets(minimum as number, maximum as number);
  const firstOffset = offsets[0]!;
  const firstTune = await invoke("tune_decoder", { offset_khz: firstOffset });
  const firstQuality = quality(firstTune, "initial boundary tune");
  expect(
    firstQuality,
    "the recovery must begin with a non-optimal legal tune",
  ).toBeLessThan(0.95);
  expect(firstTune.outcome.data?.offset_khz).toBe(firstOffset);

  let qualifyingTune = firstTune;
  let qualifyingQuality = firstQuality;
  for (const offset of offsets.slice(1)) {
    if (qualifyingQuality >= 0.95) break;
    const nextTune = await invoke("tune_decoder", { offset_khz: offset });
    qualifyingQuality = quality(nextTune, "result-derived follow-up tune");
    expect(nextTune.outcome.data?.offset_khz).toBe(offset);
    qualifyingTune = nextTune;
  }
  expect(
    qualifyingQuality,
    "decode must only follow a result at the documented threshold",
  ).toBeGreaterThanOrEqual(0.95);

  const decoded = await invoke("decode_reply");
  expect(decoded.outcome.ok, "a qualifying result must decode the reply").toBe(
    true,
  );
  return { qualifyingTune, decoded };
}
