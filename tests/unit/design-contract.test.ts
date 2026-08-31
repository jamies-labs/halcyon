import { describe, expect, it } from "vitest";
import {
  createMarkerFixture,
  createYamlMarkerFixture,
  runDesignContractChecker,
} from "./design-contract-checker-runner.mjs";

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
  it("parses_schema_one_json_marker", () => {
    const design = designFiles["/DESIGN.md"];
    expect(
      design,
      "DESIGN.md must be present at the repository root",
    ).toBeTypeOf("string");

    const marker = design?.match(
      /<!--\s*keelen-design-contract\s*([\s\S]*?)-->/,
    )?.[1];
    expect(marker, "DESIGN.md must contain the contract marker").toBeDefined();
    const contract = JSON.parse(marker!.trim()) as {
      schema: number;
      status: string;
      revision: number;
      tokens_file: string;
      shell_files: string[];
      component_roots: string[];
    };

    expect(contract.schema).toBe(1);
    expect(contract.status).toBe("active");
    expect(contract.revision).toBeGreaterThanOrEqual(1);
    expect(contract.tokens_file).toBe("src/styles.css");
    expect(contract.shell_files).toEqual(
      expect.arrayContaining(["src/main.ts"]),
    );
    expect(contract.component_roots).toEqual(
      expect.arrayContaining(["src/main.ts"]),
    );
    expect(design).not.toContain("UNSET");
    expect(design).toContain("## Product brief");
    expect(design).toContain("## Visual direction");
    expect(design).toContain("## Implementation system");
  });

  it("runs_json_contract_checker", () => {
    const validResult = runDesignContractChecker();
    expect(validResult.status).toBe(0);
    expect(validResult.stdout).toContain(
      "active contract and review coverage verified",
    );

    const fixture = createYamlMarkerFixture();
    try {
      const malformedResult = runDesignContractChecker(fixture.root);
      expect(malformedResult.status).not.toBe(0);
      expect(malformedResult.stderr).toContain(
        "design-contract: marker must contain valid JSON",
      );
    } finally {
      fixture.cleanup();
    }
  }, 15_000);

  it("rejects_superficial_active_status_marker", () => {
    const malformedMarker = `status: "active"\nrevision: 1`;
    expect(() => JSON.parse(malformedMarker)).toThrow(SyntaxError);
  });

  it("rejects JSON contracts with invalid field types and declared paths", () => {
    const invalidTokenField = createMarkerFixture(
      JSON.stringify({
        schema: 1,
        status: "active",
        revision: 1,
        tokens_file: [],
        shell_files: ["src/main.ts"],
        component_roots: ["src/main.ts"],
      }),
    );
    const missingShellFile = createMarkerFixture(
      JSON.stringify({
        schema: 1,
        status: "active",
        revision: 1,
        tokens_file: "src/styles.css",
        shell_files: ["src/missing-shell.ts"],
        component_roots: ["src/main.ts"],
      }),
    );

    try {
      const invalidFieldResult = runDesignContractChecker(
        invalidTokenField.root,
      );
      expect(invalidFieldResult.status).not.toBe(0);
      expect(invalidFieldResult.stderr).toContain(
        "design-contract: marker tokens_file must be a non-empty string",
      );

      const missingPathResult = runDesignContractChecker(missingShellFile.root);
      expect(missingPathResult.status).not.toBe(0);
      expect(missingPathResult.stderr).toContain(
        "design-contract: missing src/missing-shell.ts",
      );
    } finally {
      invalidTokenField.cleanup();
      missingShellFile.cleanup();
    }
  });

  it("runs declared-path regressions from an isolated checker fixture", () => {
    const undeclaredFixturePath = "src/game/chapters/ch6_burn.ts";
    const fixture = createMarkerFixture(
      JSON.stringify({
        schema: 1,
        status: "active",
        revision: 1,
        tokens_file: "src/styles.css",
        shell_files: [undeclaredFixturePath],
        component_roots: ["src/main.ts"],
      }),
    );

    try {
      const result = runDesignContractChecker(fixture.root);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(
        `design-contract: missing ${undeclaredFixturePath}`,
      );
    } finally {
      fixture.cleanup();
    }
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

  it("chapter one crew handoff evidence conforms", () => {
    const review = reviewFiles["/ui-review.json"];
    expect(review, "ui-review.json must be present").toBeTypeOf("string");

    const parsed = JSON.parse(review!) as {
      scenarios: Array<{
        route: string;
        state: string;
        variant?: string;
        viewports: number[];
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
      "chapter-one-contact scenario must be present",
    ).toBeDefined();
    expect(chapter?.route).toBe("/");
    expect(chapter?.state).toBe("resolved");
    expect(chapter?.viewports).toEqual([375, 1280]);
    expect(chapter?.ready_selector).toBe("[data-testid=crew-action-ch1]");
    expect(chapter?.setup?.settled_selector).toBe(
      "[data-testid=crew-action-ch1]",
    );
    expect(
      recorder,
      "recorder interaction scenario must be present",
    ).toBeDefined();
    expect(recorder?.ready_selector).toBe("[data-testid=recorder-toggle]");
    expect(recorder?.setup?.settled_selector).toBe(
      "[data-testid=sim-tool-details]",
    );
  });

  it("declares tokenized recorder docking evidence for both closed and open states", () => {
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
      expect(scenario?.ready_selector).toBe("[data-testid=recorder-toggle]");
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
    expect(opened?.setup?.interactions).toEqual([
      { action: "click", selector: "[data-testid=recorder-toggle]" },
    ]);
    expect(opened?.setup?.settled_selector).toBe(
      "[data-testid=sim-tool-details]",
    );
  });

  it("declares closed live-tool and retry evidence for the recorder outcomes", () => {
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

    for (const scenario of [liveTools, failures]) {
      expect(
        scenario,
        "recorder evidence scenario must be present",
      ).toBeDefined();
      expect(scenario?.route).toBe("/");
      expect(scenario?.state).toBe("resolved");
      expect(scenario?.theme).toBe("light");
      expect(scenario?.viewports).toEqual([375, 768, 1280]);
      expect(scenario?.ready_selector).toBe("[data-testid=recorder-toggle]");
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

    expect(liveTools?.setup?.settled_selector).toBe(
      "[data-testid=sim-tool-details]",
    );
    expect(failures?.setup?.settled_selector).toBe("[data-testid=sim-result]");
    expect(liveTools?.covers.changedPaths).toContain("src/webmcp/registry.ts");
    expect(failures?.covers.changedPaths).toContain("src/ui/speaker.ts");
  });

  it("declares closed simulator detail and outcome evidence", () => {
    const review = reviewFiles["/ui-review.json"];
    expect(review, "ui-review.json must be present").toBeTypeOf("string");

    const parsed = JSON.parse(review!) as {
      scenarios: Array<{
        route: string;
        state: string;
        variant?: string;
        ready_selector: string;
        setup?: {
          interactions?: Array<{ action: string; selector: string }>;
          settled_selector?: string;
        };
        covers: { changedPaths: string[]; requirementKeys: unknown };
      }>;
    };
    const recorderOpen = parsed.scenarios.find(
      (scenario) => scenario.variant === "recorder-open",
    );
    const liveTools = parsed.scenarios.find(
      (scenario) => scenario.variant === "recorder-live-tools",
    );
    const failures = parsed.scenarios.find(
      (scenario) => scenario.variant === "recorder-failure-retry",
    );

    for (const scenario of [recorderOpen, liveTools, failures]) {
      expect(
        scenario,
        "each recorder evidence variant must remain present",
      ).toBeDefined();
      expect(scenario?.route).toBe("/");
      expect(scenario?.state).toBe("resolved");
      expect(scenario?.setup?.interactions).toBeDefined();
      expect(scenario?.covers.changedPaths).toContain("src/ui/recorder.ts");
      const requirementKeys = scenario?.covers.requirementKeys;
      expect(Array.isArray(requirementKeys)).toBe(true);
      if (!Array.isArray(requirementKeys)) {
        throw new Error("recorder evidence requirement keys must be an array");
      }
      for (const key of requirementKeys) expect(key).toMatch(/^AC\d+/);
    }

    expect(recorderOpen?.setup?.settled_selector).toBe(
      "[data-testid=sim-tool-details]",
    );
    expect(liveTools?.setup?.settled_selector).toBe(
      "[data-testid=sim-tool-details]",
    );
    expect(failures?.setup?.settled_selector).toBe("[data-testid=sim-result]");
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

  it("keeps the independent evidence matrix within the screenshot budget", () => {
    const review = reviewFiles["/ui-review.json"];
    expect(review, "ui-review.json must be present").toBeTypeOf("string");

    const parsed = JSON.parse(review!) as {
      scenarios: Array<{ viewports: number[] }>;
    };
    const captureCount = parsed.scenarios.reduce(
      (total, scenario) => total + scenario.viewports.length,
      0,
    );

    expect(
      captureCount,
      "review evidence must not exceed the 27-capture gate budget",
    ).toBeLessThanOrEqual(27);
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

  it("seeds the fully completed Chapter Six state for the training-victory capture", () => {
    const review = reviewFiles["/ui-review.json"];
    expect(review, "ui-review.json must be present").toBeTypeOf("string");

    const parsed = JSON.parse(review!) as {
      scenarios: Array<{
        variant?: string;
        setup?: { local_storage?: Record<string, string> };
      }>;
    };
    const savedState = parsed.scenarios.find(
      (scenario) => scenario.variant === "training-victory",
    )?.setup?.local_storage?.["halcyon.save.v1"];

    expect(
      savedState,
      "training-victory must seed the persisted campaign state",
    ).toBeTypeOf("string");
    expect(JSON.parse(savedState ?? "null")).toEqual({
      chapter: 6,
      chapterDone: {
        1: true,
        2: true,
        3: true,
        4: true,
        5: true,
        6: true,
      },
    });
  });
});
