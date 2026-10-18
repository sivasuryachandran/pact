import { expect, test } from '@playwright/test';

test('cycles signal states, target flight, and both morphs without console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await expect(page.locator('h1')).toContainText('One signal');
  await page.screenshot({ path: 'reports/idle.png', fullPage: true });
  for (const state of ['listening', 'approval', 'allowed', 'denied']) {
    await page.getByRole('button', { name: state, exact: true }).click();
    await expect(page.locator('#state')).toHaveText(state);
    await page.screenshot({ path: `reports/${state}.png`, fullPage: true });
  }
  await page.getByRole('button', { name: "fly to Dad's phone" }).click();
  await page.screenshot({ path: 'reports/mid-flight.png', fullPage: true });
  await page.getByRole('button', { name: 'morph ✓' }).click();
  await page.screenshot({ path: 'reports/check-morph.png', fullPage: true });
  await page.getByRole('button', { name: 'morph lock' }).click();
  await page.screenshot({ path: 'reports/lock-morph.png', fullPage: true });
  expect(errors).toEqual([]);
});
