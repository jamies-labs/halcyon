import { describe, expect, it } from "vitest";
import { recoverDecoderFromToolResults } from "../e2e/commsRecovery";

describe("Chapter 4 result-derived decoder recovery", () => {
  it("keeps trying schema-valid offsets until returned quality reaches the decode threshold", async () => {
    const attempts: number[] = [];
    const result = await recoverDecoderFromToolResults(
      {
        evaluate: async () => [
          {
            name: "tune_decoder",
            inputSchema: {
              properties: { offset_khz: { minimum: -9, maximum: 9 } },
            },
          },
        ],
      } as never,
      async (name, args) => {
        if (name === "decode_reply") {
          return { outcome: { ok: true, data: { decoded: true } } };
        }
        const offset = (args as { offset_khz: number }).offset_khz;
        attempts.push(offset);
        const checksum_quality = Number(((offset + 9) / 18).toFixed(2));
        return {
          outcome: {
            ok: true,
            data: { offset_khz: offset, checksum_quality },
          },
        };
      },
    );

    expect(
      attempts,
      "each legal offset must be tried in recovery order",
    ).toEqual(Array.from({ length: 19 }, (_, index) => index - 9));
    expect(
      result.qualifyingTune.outcome.data?.offset_khz,
      "the final qualifying tune must come from observed quality rather than a fixed interpolation",
    ).toBe(9);
    expect(
      result.qualifyingTune.outcome.data?.checksum_quality,
      "the helper must only decode at the documented quality threshold",
    ).toBeGreaterThanOrEqual(0.95);
    expect(
      result.decoded.outcome.ok,
      "the helper must decode after its qualifying result",
    ).toBe(true);
  });
});
