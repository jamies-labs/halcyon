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
  });

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
});
