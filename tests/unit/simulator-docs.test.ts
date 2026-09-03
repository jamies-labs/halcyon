import { expect, it } from "vitest";

const readmes = import.meta.glob<string>("/README.md", {
  eager: true,
  import: "default",
  query: "?raw",
});

it("documents the explicit ephemeral simulator training mode", () => {
  const readme = readmes["/README.md"];
  expect(readme, "README.md must be present at the repository root").toBeTypeOf(
    "string",
  );
  expect(readme).toContain("`?sim=1&ch=N`");
  expect(readme).toContain("default campaign progression is sequential");
  expect(readme).toContain(
    "simulator sessions do not alter saved campaign progress",
  );
});

it("documents the optional view-only flight recorder", () => {
  const readme = readmes["/README.md"];
  expect(readme).toContain("Flight recorder — mission history (optional)");
  expect(readme).toContain("view-only recap");
  expect(readme).toContain("not required to complete normal crew play");
});

it("documents the separately optional test console", () => {
  const readme = readmes["/README.md"];
  expect(readme).toContain("Test console (optional — not part of normal play)");
  expect(readme).toContain("`?sim=1&ch=N`");
  expect(readme).toContain(
    "simulator sessions do not alter saved campaign progress",
  );
});
