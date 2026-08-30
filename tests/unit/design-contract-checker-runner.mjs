import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const repositoryRoot = resolve(
  fileURLToPath(new URL("../..", import.meta.url)),
);
const checker = resolve(repositoryRoot, "scripts/check-design-contract.mjs");

export function runDesignContractChecker(root = repositoryRoot) {
  const result = spawnSync(process.execPath, [checker], {
    cwd: root,
    encoding: "utf8",
  });
  return {
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

function copyCheckerFixtureFile(root, file) {
  const destination = resolve(root, file);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(resolve(repositoryRoot, file), destination);
}

export function createMarkerFixture(marker) {
  const root = mkdtempSync(join(tmpdir(), "halcyon-design-contract-"));
  for (const file of ["src/main.ts", "src/styles.css", "ui-review.json"])
    copyCheckerFixtureFile(root, file);
  writeFileSync(
    resolve(root, "DESIGN.md"),
    `<!-- keelen-design-contract\n${marker}\n-->`,
  );
  return {
    root,
    cleanup: () => rmSync(root, { force: true, recursive: true }),
  };
}

export function createYamlMarkerFixture() {
  return createMarkerFixture(`status: "active"
revision: 1
tokens_file: "src/styles.css"
shell_files:
  - "src/main.ts"
component_roots:
  - "src/main.ts"`);
}
