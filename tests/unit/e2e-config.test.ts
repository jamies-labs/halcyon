import { expect, it } from "vitest";

const projectFiles = import.meta.glob<string>(
  "/{package.json,playwright.config.ts}",
  {
    eager: true,
    import: "default",
    query: "?raw",
  },
);

it("builds current Vite output before the E2E preview server can start", () => {
  const packageText = projectFiles["/package.json"];
  const configText = projectFiles["/playwright.config.ts"];

  expect(
    packageText,
    "package.json must be available to the E2E command",
  ).toBeTypeOf("string");
  expect(
    configText,
    "playwright.config.ts must configure the preview server",
  ).toBeTypeOf("string");
  if (typeof packageText !== "string" || typeof configText !== "string") return;

  const scripts = (
    JSON.parse(packageText) as { scripts?: Record<string, string> }
  ).scripts;
  const e2eCommand = scripts?.["test:e2e"];
  const previewCommand = scripts?.["preview:e2e"];

  expect(
    e2eCommand,
    "test:e2e must select the production Playwright config",
  ).toBe("playwright test --config=playwright.config.ts");
  expect(
    previewCommand,
    "the E2E preview command must build current source first",
  ).toBe("npm run build && npm run preview");
  expect(configText).toContain("command: 'npm run preview:e2e'");
});
