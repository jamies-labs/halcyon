import { describe, expect, it } from "vitest";

const documents = import.meta.glob<string>(
  "/docs/submission/{devpost,video-script,checklist}.md",
  {
    eager: true,
    import: "default",
    query: "?raw",
  },
);

function requireDocument(path: string): string {
  const document = documents[path];
  expect(document, `${path} must be present in the submission kit`).toBeTypeOf(
    "string",
  );
  return document ?? "";
}

function linksIn(document: string): string[] {
  return (document.match(/https:\/\/[^\s)]+/g) ?? []).map((link) =>
    link.replace(/[.,;:]+$/, ""),
  );
}

describe("HALCYON submission kit", () => {
  it("devpost-description-covers-the-judge-rubric", () => {
    const devpost = requireDocument("/docs/submission/devpost.md");
    const prose = devpost.replace(/\s+/g, " ");
    const words = devpost.trim().split(/\s+/).filter(Boolean);

    expect(
      words.length,
      "Devpost prose should be approximately 400 words",
    ).toBeGreaterThanOrEqual(350);
    expect(
      words.length,
      "Devpost prose should be approximately 400 words",
    ).toBeLessThanOrEqual(475);

    for (const requiredText of [
      "last awake crew member",
      "Tool-gated state",
      "Body-gated state",
      "Channel-split information",
      "tool discovery",
      "read-only annotations",
      "JSON-Schema inputs and structured errors",
      "dynamic registration and unregistration",
      "human confirmation interlock",
      "multi-tool orchestration with replay",
      "WebMCP is the game mechanic",
      "No backend",
      "zero runtime dependencies",
      "MIT",
      "Live URL",
      "Repository",
      "Video",
      "https://github.com/jamies-labs/halcyon",
    ]) {
      expect(
        prose,
        `Devpost description must include: ${requiredText}`,
      ).toContain(requiredText);
    }
    expect(
      linksIn(prose),
      "Devpost prose must not invent unpublished deployment or video URLs",
    ).toEqual(["https://github.com/jamies-labs/halcyon"]);
  });

  it("video-script-covers-every-required-demo-beat", () => {
    const script = requireDocument("/docs/submission/video-script.md");

    for (const beat of [
      "0:00",
      "0:15",
      "0:30",
      "1:00",
      "1:30",
      "2:00",
      "2:20",
      "2:40",
      "SECTION_UNREACHABLE",
      "Built on WebMCP. Neither of us could have done it alone.",
    ]) {
      expect(script, `Video script must include beat: ${beat}`).toContain(beat);
    }
    expect(script).toContain("Under three minutes");
    expect(script.match(/Narration:/g)?.length).toBeGreaterThanOrEqual(8);
  });

  it("checklist-mirrors-submission-requirements", () => {
    const checklist = requireDocument("/docs/submission/checklist.md");

    for (const requiredText of [
      "https://webmcp.devpost.com/",
      "https://github.com/jamies-labs/halcyon",
      "MIT license visible at the repository root",
      "README with run instructions and WebMCP notes",
      "OWNER PASTE-IN: deployed live URL",
      "OWNER PASTE-IN: public YouTube video URL",
      "public YouTube",
      "audio narration",
      "human-agent asymmetry story",
      "capability-per-chapter map",
      "OWNER: register",
      "OWNER: submit",
    ]) {
      expect(checklist, `Checklist must include: ${requiredText}`).toContain(
        requiredText,
      );
    }
    expect(
      linksIn(checklist),
      "Checklist must name only known Devpost and repository URLs until the owner publishes the other links",
    ).toEqual([
      "https://webmcp.devpost.com/",
      "https://github.com/jamies-labs/halcyon",
    ]);
  });
});
