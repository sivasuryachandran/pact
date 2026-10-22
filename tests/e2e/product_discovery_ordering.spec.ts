import { expect, test } from '@playwright/test';

async function api(page: import('@playwright/test').Page, path: string, method = 'GET', body?: unknown): Promise<any> {
  return page.evaluate(async ({ path, method, body }) => {
    const csrf = document.cookie.split('; ').find((part) => part.startsWith('PACT_CSRF='))?.slice('PACT_CSRF='.length) || '';
    const response = await fetch(path, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-PACT-CSRF': csrf } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    let parsed: any = {};
    try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { error: text }; }
    if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(parsed)}`);
    return parsed;
  }, { path, method, body });
}

test('normal authenticated UI discovers, compares, and records a controlled laptop order', async ({ page }, testInfo) => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const username = `laptop_ui_${suffix}`;
  const password = 'PACT laptop browser password 2026';
  await page.goto('/');
  await page.getByRole('button', { name: 'New here? Create an account' }).click();
  await page.getByLabel('Username or email').fill(username);
  await page.getByLabel('Display name').fill('Laptop Demo Owner');
  await page.locator('input[type="email"]').fill(`${username}@example.test`);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByPlaceholder('Household name').fill(`Laptop Demo ${suffix}`);
  await page.getByRole('button', { name: 'Create household' }).click();
  await expect(page.getByText('browser MCP verified')).toBeVisible({ timeout: 20_000 });

  const proposal = await api(page, '/api/propose', 'POST', { source_text: 'Ask me before purchases over $1.' });
  await api(page, '/api/confirm', 'POST', { proposal_hash: proposal.proposal_hash });
  await page.getByRole('button', { name: 'Wallet', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose a product, then let PACT decide.' })).toBeVisible();
  await page.getByLabel('Product request').fill('laptop under $1500 with at least 16GB RAM');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect.poll(async () => page.locator('.discovery-card').count()).toBeGreaterThanOrEqual(3);
  await page.locator('.discovery-card').nth(0).getByRole('button', { name: 'Compare' }).click();
  await page.locator('.discovery-card').nth(1).getByRole('button', { name: 'Compare' }).click();
  await page.getByRole('button', { name: /Compare 2/ }).click();
  await expect(page.getByText('STRUCTURED COMPARISON', { exact: true })).toBeVisible();
  await page.locator('.discovery-card').nth(1).getByRole('button', { name: /Run MCP purchase flow/ }).click();
  await expect.poll(async () => {
    const state = await api(page, '/api/state');
    return Boolean(state.mcp_events.find((event: any) => event.tool === 'execute_action' && event.receipt_id && event.order_id));
  }, { timeout: 20_000 }).toBe(true);
  const state = await api(page, '/api/state');
  const tools = new Set(state.mcp_events.map((event: any) => event.tool));
  for (const tool of ['search_catalog', 'get_product', 'create_purchase_request', 'check_action', 'request_approval', 'approve', 'execute_action', 'get_order_status', 'get_receipts']) expect(tools.has(tool)).toBe(true);
  expect(state.mcp_events.every((event: any) => event.arguments?.decision_token === undefined || event.arguments.decision_token === '[redacted]')).toBe(true);
  expect(state.mcp_events.every((event: any) => event.arguments?.approval_token === undefined || event.arguments.approval_token === '[redacted]')).toBe(true);
  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  await expect(page.getByText('SERVER-RECORDED MCP TRACE')).toBeVisible();
  await expect(page.getByText('create_purchase_request', { exact: false }).first()).toBeVisible();
  const screenshot = await page.screenshot({ path: testInfo.outputPath('product-discovery-ordering.png'), fullPage: true });
  await testInfo.attach('product-discovery-ordering', { body: screenshot, contentType: 'image/png' });
});
