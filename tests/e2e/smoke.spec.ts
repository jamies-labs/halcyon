import { test, expect } from '@playwright/test';
test('shell boots', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('boot-note')).toBeVisible();
});
