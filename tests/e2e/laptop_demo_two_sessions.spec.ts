import { expect, test, type Page } from '@playwright/test';

const QUERY = 'I need a laptop for Python development, 16 GB RAM minimum, under $900, good battery life, and strong reviews';

async function api(page: Page, path: string, method = 'GET', body?: unknown): Promise<any> {
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

async function register(page: Page, username: string, displayName: string, password: string): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'New here? Create an account' }).click();
  await page.getByLabel('Username or email').fill(username);
  await page.getByLabel('Display name').fill(displayName);
  await page.locator('input[type="email"]').fill(`${username}@example.test`);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Bring your household into PACT.' })).toBeVisible();
}

test('Maya searches for a laptop and asks to buy; Siva approves from his own session; the order runs once', async ({ browser }, testInfo) => {
  const password = 'PACT laptop demo password 2026';
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const siva = await browser.newContext();
  const maya = await browser.newContext();
  const sivaPage = await siva.newPage();
  const mayaPage = await maya.newPage();
  try {
    await register(sivaPage, `demo_siva_${suffix}`, 'Siva', password);
    await sivaPage.getByPlaceholder('Household name').fill(`Laptop Demo Home ${suffix}`);
    await sivaPage.getByRole('button', { name: 'Create household' }).click();
    await expect(sivaPage.getByText('browser MCP verified')).toBeVisible({ timeout: 20_000 });
    const invite = (await api(sivaPage, '/api/invites', 'POST', { role: 'teen', permission_template: 'limited_spending', expires_minutes: 30 })).invite.code;
    const ask = await api(sivaPage, '/api/propose', 'POST', { source_text: 'Ask me before purchases over $1.' });
    await api(sivaPage, '/api/confirm', 'POST', { proposal_hash: ask.proposal_hash });

    await register(mayaPage, `demo_maya_${suffix}`, 'Maya', password);
    await mayaPage.getByPlaceholder('Paste invite code').fill(invite);
    await mayaPage.getByRole('button', { name: 'Join household' }).click();
    await expect(mayaPage.getByRole('button', { name: 'Log out' })).toBeVisible({ timeout: 20_000 });
    const mayaId = (await api(mayaPage, '/api/auth/current')).user.user_id;
    await api(sivaPage, '/api/wallet/cards', 'POST', { display_name: 'Maya demo card', brand: 'Visa', last4: '4242', expiry_month: 12, expiry_year: 2030, assigned_member_ids: [mayaId] });
    await expect(mayaPage.getByText('browser MCP verified')).toBeVisible({ timeout: 20_000 });

    // Maya: requirements, hard filters, comparison
    await mayaPage.getByRole('button', { name: 'Wallet', exact: true }).click();
    await mayaPage.getByLabel('Product request').fill(QUERY);
    await mayaPage.getByRole('button', { name: 'Search' }).click();
    await expect.poll(async () => mayaPage.locator('.discovery-card').count()).toBeGreaterThanOrEqual(3);
    await mayaPage.locator('.discovery-card').nth(0).getByRole('button', { name: 'Compare' }).click();
    await mayaPage.locator('.discovery-card').nth(1).getByRole('button', { name: 'Compare' }).click();
    await mayaPage.getByRole('button', { name: /Compare 2/ }).click();
    await expect(mayaPage.getByText('STRUCTURED COMPARISON', { exact: true })).toBeVisible();
    await mayaPage.screenshot({ path: testInfo.outputPath('1-maya-comparison.png'), fullPage: true });

    // Maya buys: ASK, and she cannot approve herself
    await mayaPage.locator('.discovery-card').nth(0).getByRole('button', { name: /Run MCP purchase flow/ }).click();
    const waiting = mayaPage.getByLabel('Waiting for an adult to approve');
    await expect(waiting).toBeVisible({ timeout: 20_000 });
    await expect(waiting).toContainText('ASK');
    await waiting.getByRole('button', { name: 'Try to approve it myself' }).click();
    await expect(waiting.getByRole('status')).toContainText('Refused by PACT', { timeout: 10_000 });
    await mayaPage.screenshot({ path: testInfo.outputPath('2-maya-ask-self-approval-refused.png'), fullPage: true });

    // Siva, in his own session, sees the exact bound request and approves it
    const request = sivaPage.getByLabel('Approval requested');
    await expect(request).toBeVisible({ timeout: 20_000 });
    for (const label of ['Requested by', 'Payment method', 'Device', 'Product revision', 'Policy version', 'Household', 'Request hash']) await expect(request).toContainText(label);
    await expect(request).toContainText(mayaId);
    await sivaPage.screenshot({ path: testInfo.outputPath('3-siva-approval-queue.png'), fullPage: true });
    await request.getByRole('button', { name: 'Approve exact request' }).click();

    // Maya's session executes the unchanged request once
    await expect.poll(async () => (await api(mayaPage, '/api/state')).mcp_events.some((event: any) => event.tool === 'execute_action' && event.receipt_id && event.order_id), { timeout: 30_000 }).toBe(true);
    await expect(mayaPage.getByLabel('Waiting for an adult to approve')).toHaveCount(0);
    const state = await api(mayaPage, '/api/state');
    const executes = state.mcp_events.filter((event: any) => event.tool === 'execute_action' && event.receipt_id && event.order_id);
    expect(executes).toHaveLength(1);
    expect(executes[0].member_id).toBe(mayaId);
    const approve = state.mcp_events.find((event: any) => event.tool === 'approve' && event.policy_decision === 'approved');
    expect(approve.member_id).not.toBe(mayaId);
    const refused = state.mcp_events.find((event: any) => event.tool === 'approve' && event.member_id === mayaId);
    expect(refused).toBeTruthy();
    const dump = JSON.stringify(state.mcp_events);
    expect(dump).not.toMatch(/"(decision|approval)_token":"(?!\[redacted\])/);

    await mayaPage.getByRole('button', { name: 'Activity', exact: true }).click();
    await expect(mayaPage.getByText('BROWSER-OBSERVED MCP HANDSHAKE')).toBeVisible();
    await expect(mayaPage.getByText(/initialize → protocol 2025-11-25/)).toBeVisible();
    await expect(mayaPage.getByText('SERVER-RECORDED MCP TRACE')).toBeVisible();
    await mayaPage.screenshot({ path: testInfo.outputPath('4-maya-trust-activity.png'), fullPage: true });
  } finally {
    await Promise.all([siva.close(), maya.close()]);
  }
});
