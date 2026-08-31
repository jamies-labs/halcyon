import { describe, expect, it } from "vitest";
import { recoverDecoderFromToolResults } from "../e2e/commsRecovery";

describe("Chapter 4 result-derived decoder recovery", () => {
  it("uses an early schema-derived probe when it reaches the decode threshold", async () => {
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
        const checksum_quality = offset === -3 ? 0.96 : 0.36;
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
      "a qualifying schema-derived probe must avoid an exhaustive browser call sweep",
    ).toEqual([-9, -3]);
    expect(
      result.qualifyingTune.outcome.data?.offset_khz,
      "the qualifying tune must be the legal probe selected from the published bounds",
    ).toBe(-3);
    expect(
      result.qualifyingTune.outcome.data?.checksum_quality,
      "the helper must only decode at the documented quality threshold",
    ).toBeGreaterThanOrEqual(0.95);
    expect(
      result.decoded.outcome.ok,
      "the helper must decode after its qualifying result",
    ).toBe(true);
  });

  it("falls back from the schema-derived probe without revisiting an attempted offset", async () => {
    const attempts: number[] = [];
    await recoverDecoderFromToolResults(
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
        return {
          outcome: {
            ok: true,
            data: {
              offset_khz: offset,
              checksum_quality: offset === -2 ? 0.96 : 0.36,
            },
          },
        };
      },
    );

    expect(
      attempts,
      "fallback must continue from the successful early-probe neighborhood without repeated calls",
    ).toEqual([-9, -3, -2]);
  });
});
