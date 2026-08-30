import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

const root = process.cwd();

function fail(message) {
  console.error(`design-contract: ${message}`);
  process.exit(1);
}

function readProjectFile(file) {
  const path = resolve(root, file);
  const relativePath = relative(root, path);
  if (
    isAbsolute(file) ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`)
  ) {
    fail(`path must stay within the repository: ${file}`);
  }
  if (!existsSync(path)) fail(`missing ${file}`);
  return readFileSync(path, "utf8");
}

function readString(contract, field) {
  const value = contract[field];
  if (typeof value !== "string" || value.length === 0)
    fail(`marker ${field} must be a non-empty string`);
  return value;
}

function readPathList(contract, field) {
  const value = contract[field];
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((path) => typeof path !== "string" || path.length === 0)
  ) {
    fail(`marker ${field} must be a non-empty array of paths`);
  }
  return value;
}

const design = readProjectFile("DESIGN.md");
if (design.includes("UNSET")) fail("DESIGN.md contains an unresolved field");

const marker = design.match(
  /<!--\s*keelen-design-contract\s*([\s\S]*?)-->/,
)?.[1];
if (!marker) fail("DESIGN.md is missing the keelen-design-contract marker");
let contract;
try {
  contract = JSON.parse(marker.trim());
} catch {
  fail("marker must contain valid JSON");
}
if (
  typeof contract !== "object" ||
  contract === null ||
  Array.isArray(contract)
)
  fail("marker must contain a JSON object");
if (contract.schema !== 1) fail("marker schema must be 1");
if (contract.status !== "active") fail("marker status must be active");
if (!Number.isInteger(contract.revision) || contract.revision < 1)
  fail("marker revision must be an integer of at least 1");

const tokenPath = readString(contract, "tokens_file");
const shellFiles = readPathList(contract, "shell_files");
const componentRoots = readPathList(contract, "component_roots");
const tokens = readProjectFile(tokenPath);

const dishStyles =
  tokens
    .match(/\.dish-(?:pad|knob|readout)[\s\S]*?(?=\n\.|\n@|$)/g)
    ?.join("\n") ?? "";
if (!dishStyles.includes(".dish-pad"))
  fail("Antenna dish styles must be present in the canonical token source");
for (const token of [
  "var(--color-surface)",
  "var(--color-border)",
  "var(--size-hit-target)",
  "var(--radius-control)",
]) {
  if (!dishStyles.includes(token))
    fail(`Antenna dish styles must use ${token}`);
}
if (/#|\brgb\(|\bhsl\(|border-radius:\s*\d/.test(dishStyles))
  fail("Antenna dish styles must not introduce raw color or radius values");

const recorderStart = tokens.indexOf(".recorder-dock");
if (recorderStart === -1)
  fail(
    "Flight recorder must use a docked region in the canonical token source",
  );
const recorderStyles = tokens.slice(recorderStart);
for (const token of [
  "var(--color-surface)",
  "var(--color-border)",
  "var(--radius-surface)",
]) {
  if (!recorderStyles.includes(token))
    fail(`Flight recorder docking must use ${token}`);
}
if (recorderStyles.includes("position: fixed"))
  fail("Flight recorder docking must not use a fixed overlay");
if (
  !tokens.includes(".recorder-close:focus-visible") ||
  !tokens.includes("var(--focus-width)")
) {
  fail(
    "Flight recorder close control must reuse the canonical focus treatment",
  );
}

for (const path of [...shellFiles, ...componentRoots]) readProjectFile(path);

let review;
try {
  review = JSON.parse(readProjectFile("ui-review.json"));
} catch {
  fail("ui-review.json must contain valid JSON");
}

const activationScenario = review.scenarios?.find(
  (scenario) =>
    scenario.covers?.triggerOnlyPaths?.includes("DESIGN.md") &&
    scenario.covers?.changedPaths?.includes(tokenPath),
);

if (!activationScenario)
  fail(
    "ui-review.json needs an activation scenario covering DESIGN.md and the token source",
  );
if (activationScenario.route !== "/")
  fail("activation scenario must use the current rendered route");
if (
  !activationScenario.viewports?.includes(375) ||
  !activationScenario.viewports?.includes(1280)
) {
  fail("activation scenario must cover mobile and desktop viewports");
}

console.log("design-contract: active contract and review coverage verified");
