import { test, expect } from "@playwright/test";
test("mission console opens the crew briefing", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("mission-console")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "ISV HALCYON" }),
  ).toBeVisible();
  await expect(page.getByText("Crew link pending")).toBeVisible();

  await page.getByRole("button", { name: "Open crew briefing" }).click();

  await expect(page.getByTestId("crew-briefing")).toBeVisible();
  await expect(page.getByText("The ship needs two crew.")).toBeVisible();
  await expect(
    page.getByText("HALCYON listens through your agent."),
  ).toBeVisible();
});
