import { expect, test } from '@playwright/test';

test('normal account household page creates invite and pairing QR artifacts', async ({ page }) => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  await page.goto('/');
  await page.getByRole('button', { name: 'New here? Create an account' }).click();
  await page.getByLabel('Username or email').fill(`owner_${suffix}`);
  await page.getByLabel('Display name').fill('Household Owner');
  await page.locator('input[type="email"]').fill(`owner_${suffix}@example.test`);
  await page.getByLabel('Password').fill('PACT secure password 2026');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByPlaceholder('Household name').fill(`Invite Home ${suffix}`);
  await page.getByRole('button', { name: 'Create household' }).click();
  await page.getByRole('button', { name: 'Household', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Invite a family member' })).toBeVisible();
  await page.getByLabel('Role').selectOption('child');
  await page.getByLabel('Initial permission').selectOption('request_only');
  await page.getByRole('button', { name: 'Generate invite' }).click();
  await expect(page.getByText('SHARE THIS INVITE')).toBeVisible();
  await expect(page.getByLabel('QR code for family invite')).toBeVisible();
  await expect(page.locator('.generated-invite').first().getByText('child · request_only')).toBeVisible();

  await page.getByLabel('Device name').fill('Owner browser');
  await page.getByRole('button', { name: 'Start pairing' }).click();
  await expect(page.getByText('PAIRING REQUEST')).toBeVisible();
  await expect(page.getByLabel('QR code for trusted device pairing')).toBeVisible();
});
