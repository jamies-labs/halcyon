import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();

function fail(message) {
  console.error(`design-contract: ${message}`);
  process.exit(1);
}

function readProjectFile(file) {
  const path = resolve(root, file);
  if (!existsSync(path)) fail(`missing ${file}`);
  return readFileSync(path, "utf8");
}

function listFromMarker(marker, field) {
  const match = marker.match(
    new RegExp(`${field}:\\s*\\n((?:\\s+-\\s+[^\\n]+\\n?)+)`),
  );
  if (!match) fail(`marker must declare ${field}`);
  return match[1]
    .split("\n")
    .map((line) => line.trim().replace(/^-\s*["']?|["']$/g, ""))
    .filter(Boolean);
}

const design = readProjectFile("DESIGN.md");
if (design.includes("UNSET")) fail("DESIGN.md contains an unresolved field");

const marker = design.match(
  /<!--\s*keelen-design-contract\s*([\s\S]*?)-->/,
)?.[1];
if (!marker) fail("DESIGN.md is missing the keelen-design-contract marker");
if (!/^status:\s*["']active["']\s*$/m.test(marker))
  fail("marker status must be active");
if (!/^revision:\s*1\s*$/m.test(marker)) fail("marker revision must be 1");

const tokenPath = marker.match(/^tokens_file:\s*["']([^"']+)["']\s*$/m)?.[1];
if (!tokenPath) fail("marker must declare tokens_file");
readProjectFile(tokenPath);

for (const field of ["shell_files", "component_roots"]) {
  for (const path of listFromMarker(marker, field)) readProjectFile(path);
}

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
