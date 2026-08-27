import { describe, expect, it } from "vitest";

const designFiles = import.meta.glob<string>("/DESIGN.md", {
  eager: true,
  import: "default",
  query: "?raw",
});
const reviewFiles = import.meta.glob<string>("/ui-review.json", {
  eager: true,
  import: "default",
  query: "?raw",
});

describe("design contract activation", () => {
  it("publishes an active, complete contract with the canonical token source", () => {
    const design = designFiles["/DESIGN.md"];
    expect(
      design,
      "DESIGN.md must be present at the repository root",
    ).toBeTypeOf("string");
    expect(design).toContain("keelen-design-contract");
    expect(design).toMatch(/status:\s*["']active["']/);
    expect(design).toMatch(/revision:\s*1\b/);
    expect(design).toMatch(/tokens_file:\s*["']src\/styles\.css["']/);
    expect(design).toMatch(/shell_files:\s*\n\s*-\s*["']src\/main\.ts["']/);
    expect(design).toMatch(/component_roots:\s*\n\s*-\s*["']src\/main\.ts["']/);
    expect(design).not.toContain("UNSET");
  });

  it("declares a responsive supplemental mission-console scenario for the contract", () => {
    const review = reviewFiles["/ui-review.json"];
    expect(review, "ui-review.json must be present").toBeTypeOf("string");

    const parsed = JSON.parse(review!) as {
      scenarios: Array<{
        route: string;
        viewports: number[];
        covers?: { changedPaths?: string[]; triggerOnlyPaths?: string[] };
      }>;
    };
    const activation = parsed.scenarios.find((scenario) =>
      scenario.covers?.triggerOnlyPaths?.includes("DESIGN.md"),
    );

    expect(
      activation,
      "an activation scenario must cover DESIGN.md",
    ).toBeDefined();
    expect(activation?.route).toBe("/");
    expect(activation?.viewports).toEqual(expect.arrayContaining([375, 1280]));
    expect(activation?.covers?.changedPaths).toContain("src/styles.css");
  });

  it("declares each post-interaction evidence selector required by the review contract", () => {
    const review = reviewFiles["/ui-review.json"];
    expect(review, "ui-review.json must be present").toBeTypeOf("string");

    const parsed = JSON.parse(review!) as {
      scenarios: Array<{
        variant?: string;
        ready_selector: string;
        setup?: { settled_selector?: string };
      }>;
    };
    const chapter = parsed.scenarios.find(
      (scenario) => scenario.variant === "chapter-one-contact",
    );
    const recorder = parsed.scenarios.find(
      (scenario) => scenario.variant === "recorder-open",
    );

    expect(
      chapter,
      "chapter post-start scenario must be present",
    ).toBeDefined();
    expect(chapter?.ready_selector).toBe("[data-testid=breaker-handle]");
    expect(chapter?.setup?.settled_selector).toBe(
      "[data-testid=breaker-handle]",
    );
    expect(
      recorder,
      "recorder interaction scenario must be present",
    ).toBeDefined();
    expect(recorder?.ready_selector).toBe("[data-testid=recorder-panel]");
    expect(recorder?.setup?.settled_selector).toBe(
      "[data-testid=recorder-panel]",
    );
  });

  it("declares the Chapter Five two-man review surface at both supported viewports", () => {
    const review = reviewFiles["/ui-review.json"];
    expect(review, "ui-review.json must be present").toBeTypeOf("string");

    const parsed = JSON.parse(review!) as {
      scenarios: Array<{
        route: string;
        variant?: string;
        viewports: number[];
        ready_selector: string;
        setup?: { settled_selector?: string };
        covers: { changedPaths: string[]; requirementKeys: unknown };
      }>;
    };
    const twoMan = parsed.scenarios.find(
      (scenario) => scenario.variant === "chapter-five-two-man",
    );

    expect(
      twoMan,
      "Chapter Five review scenario must be present",
    ).toBeDefined();
    expect(twoMan?.route).toBe("/");
    expect(twoMan?.viewports).toEqual(expect.arrayContaining([375, 1280]));
    expect(twoMan?.ready_selector).toBe("[data-testid=vent-left]");
    expect(twoMan?.setup?.settled_selector).toBe("[data-testid=vent-left]");
    expect(twoMan?.covers.changedPaths).toEqual([
      "src/game/chapters/ch5_twoman.ts",
    ]);
    const requirementKeys = twoMan?.covers.requirementKeys;
    expect(Array.isArray(requirementKeys)).toBe(true);
    if (!Array.isArray(requirementKeys)) {
      throw new Error("Chapter Five requirement keys must be an array");
    }
    for (const key of requirementKeys) {
      expect(typeof key).toBe("string");
      if (typeof key !== "string") {
        throw new Error("Chapter Five requirement key must be a string");
      }
      expect(key).toMatch(/^AC\d+/);
    }
  });

  it("declares one closed training-victory review scenario with the required marker", () => {
    const review = reviewFiles["/ui-review.json"];
    expect(review, "ui-review.json must be present").toBeTypeOf("string");

    const parsed = JSON.parse(review!) as {
      scenarios: Array<{
        route: string;
        state: string;
        variant?: string;
        ready_selector: string;
        setup?: { local_storage?: Record<string, string> };
        covers: { changedPaths: string[]; requirementKeys: unknown };
      }>;
    };
    const trainingScenarios = parsed.scenarios.filter(
      (scenario) => scenario.variant === "training-victory",
    );

    expect(
      trainingScenarios,
      "one scenario must capture the simulator victory state",
    ).toHaveLength(1);
    const training = trainingScenarios[0];
    expect(training?.route).toBe("/");
    expect(training?.state).toBe("resolved");
    expect(training?.ready_selector).toBe(
      "[data-testid=training-simulation-marker]",
    );
    expect(training?.setup?.local_storage).toBeDefined();
    expect(training?.covers.changedPaths).toEqual(
      expect.arrayContaining(["src/game/chapters/ch6_burn.ts"]),
    );
    const requirementKeys = training?.covers.requirementKeys;
    expect(Array.isArray(requirementKeys)).toBe(true);
    if (!Array.isArray(requirementKeys)) {
      throw new Error("training victory requirement keys must be an array");
    }
    for (const key of requirementKeys) {
      expect(typeof key).toBe("string");
      if (typeof key !== "string") {
        throw new Error("training victory requirement key must be a string");
      }
      expect(key).toMatch(/^AC\d+/);
    }
  });
});
