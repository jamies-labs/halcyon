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
const appFiles = import.meta.glob<string>("/src/main.ts", {
  eager: true,
  import: "default",
  query: "?raw",
});
const playwrightConfigFiles = import.meta.glob<string>(
  "/playwright.config.ts",
  {
    eager: true,
    import: "default",
    query: "?raw",
  },
);

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

  it("retains inherited desktop captures for Chapters Two and Six", () => {
    const review = reviewFiles["/ui-review.json"];
    expect(review, "ui-review.json must be present").toBeTypeOf("string");

    const parsed = JSON.parse(review!) as {
      scenarios: Array<{ variant?: string; viewports: number[] }>;
    };
    const chapterTwo = parsed.scenarios.find(
      (scenario) => scenario.variant === "chapter-two-manifest",
    );
    expect(
      chapterTwo?.viewports,
      "Chapter Two's inherited desktop capture must remain addressable",
    ).toEqual([375, 1280]);

    const chapterSix = parsed.scenarios.find(
      (scenario) => scenario.variant === "chapter-six-burn",
    );
    expect(
      chapterSix?.viewports,
      "Chapter Six's inherited desktop capture must remain addressable",
    ).toEqual([375, 1280]);
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
    expect(recorder?.ready_selector).toBe("[data-testid=test-console-panel]");
    expect(recorder?.setup?.settled_selector).toBe(
      "[data-testid=test-console-panel]",
    );
  });

  it("declares-tokenized-optional-recorder-and-console-evidence", () => {
    const review = reviewFiles["/ui-review.json"];
    expect(review, "ui-review.json must be present").toBeTypeOf("string");

    const parsed = JSON.parse(review!) as {
      scenarios: Array<{
        route: string;
        state: string;
        variant?: string;
        viewports: number[];
        theme?: string;
        ready_selector: string;
        setup?: {
          interactions?: Array<{ action: string; selector: string }>;
          settled_selector?: string;
        };
        covers: { changedPaths: string[]; requirementKeys: unknown };
      }>;
    };
    const closed = parsed.scenarios.find(
      (scenario) => scenario.variant === "recorder-closed",
    );
    const opened = parsed.scenarios.find(
      (scenario) => scenario.variant === "recorder-open",
    );

    for (const scenario of [closed, opened]) {
      expect(
        scenario,
        "recorder review scenario must be present",
      ).toBeDefined();
      expect(scenario?.route).toBe("/");
      expect(scenario?.state).toBe("resolved");
      expect(scenario?.theme).toBe("light");
      expect(scenario?.viewports).toEqual([375, 768, 1280]);
      expect(scenario?.covers.changedPaths).toEqual(
        expect.arrayContaining(["src/ui/recorder.ts", "src/styles.css"]),
      );
      const requirementKeys = scenario?.covers.requirementKeys;
      expect(Array.isArray(requirementKeys)).toBe(true);
      if (!Array.isArray(requirementKeys)) {
        throw new Error("recorder requirement keys must be an array");
      }
      for (const key of requirementKeys) {
        expect(key).toMatch(/^AC\d+/);
      }
    }

    expect(closed?.setup?.interactions).toEqual([
      { action: "click", selector: "[data-testid=gate-start]" },
    ]);
    expect(closed?.setup?.settled_selector).toBe(
      "[data-testid=recorder-toggle]",
    );
    expect(closed?.ready_selector).toBe("[data-testid=recorder-toggle]");
    expect(opened?.ready_selector).toBe("[data-testid=test-console-panel]");
    expect(opened?.setup?.interactions).toEqual([
      { action: "click", selector: "[data-testid=gate-start]" },
      { action: "click", selector: "[data-testid=recorder-toggle]" },
      { action: "click", selector: "[data-testid=test-console-toggle]" },
    ]);
    expect(opened?.setup?.settled_selector).toBe(
      "[data-testid=test-console-panel]",
    );
  });

  it("keeps supplemental recorder evidence within the review capture budget", () => {
    const review = reviewFiles["/ui-review.json"];
    expect(review, "ui-review.json must be present").toBeTypeOf("string");

    const parsed = JSON.parse(review!) as {
      scenarios: Array<{
        route: string;
        state: string;
        variant?: string;
        viewports: number[];
        theme?: string;
        ready_selector: string;
        setup?: {
          interactions?: Array<{ action: string; selector: string }>;
          settled_selector?: string;
        };
        covers: { changedPaths: string[]; requirementKeys: unknown };
      }>;
    };
    const liveTools = parsed.scenarios.find(
      (scenario) => scenario.variant === "recorder-live-tools",
    );
    const failures = parsed.scenarios.find(
      (scenario) => scenario.variant === "recorder-failure-retry",
    );

    for (const [scenario, expectedViewports] of [
      [liveTools, [375, 1280]],
      [failures, [375, 1280]],
    ] as const) {
      expect(
        scenario,
        "recorder evidence scenario must be present",
      ).toBeDefined();
      expect(scenario?.route).toBe("/");
      expect(scenario?.state).toBe("resolved");
      expect(scenario?.theme).toBe("light");
      expect(
        scenario?.viewports,
        "supplemental recorder evidence must retain both mobile and desktop captures without duplicating the primary three-viewport coverage",
      ).toEqual(expectedViewports);
      expect(scenario?.setup?.interactions).toBeDefined();
      expect(scenario?.setup?.settled_selector).toBeDefined();
      expect(scenario?.covers.changedPaths).toContain("src/ui/recorder.ts");
      const requirementKeys = scenario?.covers.requirementKeys;
      expect(Array.isArray(requirementKeys)).toBe(true);
      if (!Array.isArray(requirementKeys)) {
        throw new Error("recorder evidence requirement keys must be an array");
      }
      for (const key of requirementKeys) expect(key).toMatch(/^AC\d+/);
    }

    const captureCount = parsed.scenarios.reduce(
      (total, scenario) => total + scenario.viewports.length,
      0,
    );
    expect(
      captureCount,
      "the closed evidence matrix must not exceed the 27-screenshot review limit",
    ).toBeLessThanOrEqual(27);

    expect(liveTools?.setup?.settled_selector).toBe(
      "[data-testid=test-console-panel]",
    );
    expect(liveTools?.ready_selector).toBe("[data-testid=test-console-panel]");
    expect(failures?.ready_selector).toBe("[data-testid=recorder-toggle]");
    expect(failures?.setup?.settled_selector).toBe(
      "[data-testid=recorder-log]",
    );
    expect(liveTools?.covers.changedPaths).toContain("src/webmcp/registry.ts");
    expect(failures?.covers.changedPaths).toContain("src/ui/speaker.ts");
  });

  it("wires the live shell and E2E touch context required by the recorder dock", () => {
    const app = appFiles["/src/main.ts"];
    const playwrightConfig = playwrightConfigFiles["/playwright.config.ts"];

    expect(
      app,
      "src/main.ts must be available to the contract test",
    ).toBeTypeOf("string");
    expect(
      app,
      "the app root must carry the shell class used by the live recorder dock selectors",
    ).toContain('app.classList.add("shell")');
    expect(
      playwrightConfig,
      "Playwright must provide touchscreen support for the recorder touch path",
    ).toMatch(
      /use:\s*\{\s*baseURL:\s*"http:\/\/localhost:4173",\s*hasTouch:\s*true\s*\}/,
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

  it("retains every independent chapter and recorder evidence variant", () => {
    const review = reviewFiles["/ui-review.json"];
    expect(review, "ui-review.json must be present").toBeTypeOf("string");

    const parsed = JSON.parse(review!) as {
      scenarios: Array<{ variant?: string }>;
    };
    const variants = new Set(
      parsed.scenarios.map((scenario) => scenario.variant),
    );

    for (const variant of [
      "chapter-one-contact",
      "chapter-two-manifest",
      "chapter-three-power",
      "chapter-four-antenna",
      "chapter-five-two-man",
      "chapter-six-burn",
      "training-victory",
      "recorder-closed",
      "recorder-open",
      "recorder-live-tools",
      "recorder-failure-retry",
    ]) {
      expect(
        variants.has(variant),
        `review evidence must retain the ${variant} variant`,
      ).toBe(true);
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
