import { expect, test } from '@playwright/test';

async function api(page: import('@playwright/test').Page, path: string, method = 'GET', body?: unknown): Promise<any> {
  return page.evaluate(async ({ path, method, body }) => {
    const csrf = document.cookie.split('; ').find((part) => part.startsWith('PACT_CSRF='))?.slice('PACT_CSRF='.length) || '';
    const response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-PACT-CSRF': csrf } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let parsed: any = {};
    try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { error: text }; }
    if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(parsed)}`);
    return parsed;
  }, { path, method, body });
}

test('authenticated browser marketplace purchase records a live MCP commerce trace', async ({ page }) => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const username = `mcp_browser_${suffix}`;
  const password = 'PACT MCP browser password 2026';

  await page.goto('/');
  await page.getByRole('button', { name: 'New here? Create an account' }).click();
  await page.getByLabel('Username or email').fill(username);
  await page.getByLabel('Display name').fill('MCP Browser Owner');
  await page.locator('input[type="email"]').fill(`${username}@example.test`);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByPlaceholder('Household name').fill(`MCP Commerce ${suffix}`);
  await page.getByRole('button', { name: 'Create household' }).click();
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
  await expect(page.getByText('browser MCP verified')).toBeVisible({ timeout: 20_000 });

  const proposal = await api(page, '/api/propose', 'POST', { source_text: 'Ask me before purchases over $1.', created_by: 'ignored-client-value' });
  await api(page, '/api/confirm', 'POST', { proposal_hash: proposal.proposal_hash, confirmer: 'ignored-client-value' });

  await page.getByRole('button', { name: 'Wallet', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose a product, then let PACT decide.' })).toBeVisible();
  await page.getByRole('button', { name: 'Run MCP purchase flow' }).first().click();
  await expect.poll(async () => {
    const state = await api(page, '/api/state');
    const execution = state.mcp_events.find((event: any) => event.tool === 'execute_action' && event.receipt_id && event.order_id);
    return execution?.policy_decision || '';
  }, { timeout: 20_000 }).toBe('success');

  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  await expect(page.getByText('SERVER-RECORDED MCP TRACE')).toBeVisible();
  for (const tool of ['search_catalog', 'get_product', 'check_action', 'request_approval', 'approve', 'execute_action', 'get_order_status', 'get_receipts']) {
    await expect(page.getByText(tool, { exact: false }).first()).toBeVisible();
  }
  await expect(page.getByText('success').first()).toBeVisible();

  const state = await api(page, '/api/state');
  expect(state.mcp_events.some((event: any) => event.tool === 'execute_action' && event.receipt_id && event.order_id)).toBe(true);
  expect(state.mcp_events.every((event: any) => event.arguments?.decision_token === undefined || event.arguments.decision_token === '[redacted]')).toBe(true);
  expect(state.mcp_events.every((event: any) => event.arguments?.approval_token === undefined || event.arguments.approval_token === '[redacted]')).toBe(true);
});
