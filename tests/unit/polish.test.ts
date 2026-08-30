import { describe, expect, it } from "vitest";
import { createServer } from "vite";

const rootFiles = import.meta.glob<string>(
  "/{README.md,index.html,ui-review.json}",
  {
    eager: true,
    import: "default",
    query: "?raw",
  },
);
async function loadStyles(): Promise<string> {
  const server = await createServer({
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  try {
    const result = await server.transformRequest("/src/styles.css?raw");
    expect(
      result?.code,
      "Vite must transform the canonical stylesheet",
    ).toBeTypeOf("string");
    return JSON.parse(
      result!.code.replace(/^export default /, "").trim(),
    ) as string;
  } finally {
    await server.close();
  }
}

describe("Task 13 public polish", () => {
  it("keeps-crt-overlay-and-focus-tokenized", async () => {
    const styles = await loadStyles();

    expect(styles).toMatch(/--warn:\s*var\(--color-focus\);/);
    expect(styles).toMatch(
      /body::after\s*\{[^}]*content:\s*["']{2};[^}]*position:\s*fixed;[^}]*inset:\s*0;[^}]*pointer-events:\s*none;[^}]*z-index:\s*50;[^}]*repeating-linear-gradient/s,
    );
    expect(styles).toMatch(
      /h1,\s*h2\s*\{[^}]*letter-spacing:\s*0\.25em;[^}]*font-weight:\s*600;/s,
    );
    expect(styles).toMatch(
      /button:focus-visible,\s*select:focus-visible,\s*textarea:focus-visible\s*\{[^}]*outline:\s*var\(--focus-width\) solid var\(--warn\);/s,
    );
  });

  it("documents-play-webmcp-and-asymmetry", () => {
    const readme = rootFiles["/README.md"];
    expect(readme, "README.md must be available").toBeTypeOf("string");
    if (typeof readme !== "string") return;

    for (const heading of [
      "## Play it",
      "## How it uses WebMCP",
      "## Design: the asymmetry model",
      "## Develop",
      "## License",
    ]) {
      expect(readme).toContain(heading);
    }
    for (const capability of [
      "tool discovery",
      "read-only annotations",
      "JSON-Schema inputs and structured errors",
      "dynamic registration",
      "human confirmation",
      "orchestration and replay",
    ]) {
      expect(readme).toContain(capability);
    }
    for (const tool of ["get_ship_state", "read_boot_briefing", "broadcast"]) {
      expect(readme).toContain(tool);
    }
    expect(readme).toContain("?fast=1&sim=1&ch=N");
    expect(readme).toContain("Tool-gated state");
    expect(readme).toContain("Body-gated state");
    expect(readme).toContain("Channel-split information");
    expect(readme).toContain("MIT");
  });

  it("publishes a closed gate-visible evidence cell for the polished gate", () => {
    const review = rootFiles["/ui-review.json"];
    expect(review, "ui-review.json must be available").toBeTypeOf("string");
    if (typeof review !== "string") return;

    const manifest = JSON.parse(review) as {
      scenarios: Array<{
        route: string;
        state: string;
        variant?: string;
        viewports: number[];
        ready_selector: string;
        setup?: unknown;
        covers: { changedPaths: string[]; requirementKeys: unknown };
      }>;
    };
    const gate = manifest.scenarios.find(
      (scenario) => scenario.variant === "gate-visible",
    );

    expect(gate, "the initial gate scenario must be present").toBeDefined();
    expect(gate?.route).toBe("/");
    expect(gate?.state).toBe("resolved");
    expect(gate?.viewports).toEqual([375, 768, 1280]);
    expect(gate?.ready_selector).toBe("[data-testid=crew-link-status]");
    expect(gate?.setup).toBeUndefined();
    expect(gate?.covers.changedPaths).toEqual(
      expect.arrayContaining([
        "index.html",
        "src/styles.css",
        "src/ui/gate.ts",
      ]),
    );
    expect(Array.isArray(gate?.covers.requirementKeys)).toBe(true);
    if (!Array.isArray(gate?.covers.requirementKeys)) return;
    for (const key of gate.covers.requirementKeys) {
      expect(key).toMatch(/^AC\d+/);
    }
  });
});
