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
