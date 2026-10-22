import { expect, test, type Page } from '@playwright/test';

type McpClient = { sessionId: string; protocol: string };

async function api(page: Page, path: string, method = 'GET', body?: unknown): Promise<any> {
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
    return { status: response.status, body: parsed };
  }, { path, method, body });
}

async function ok(page: Page, path: string, method = 'GET', body?: unknown): Promise<any> {
  const result = await api(page, path, method, body);
  expect(result.status, JSON.stringify(result.body)).toBeGreaterThanOrEqual(200);
  expect(result.status, JSON.stringify(result.body)).toBeLessThan(300);
  return result.body;
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

async function login(page: Page, username: string, password: string): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Username or email').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
  await expect(page.getByText('browser MCP verified')).toBeVisible({ timeout: 20_000 });
}

async function logout(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page.getByRole('button', { name: 'New here? Create an account' })).toBeVisible();
}

async function invite(page: Page, role: string, permission: string): Promise<string> {
  await page.getByRole('button', { name: 'Household', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Invite a family member' })).toBeVisible();
  await page.getByLabel('Role').selectOption(role);
  await page.getByLabel('Initial permission').selectOption(permission);
  const code = page.locator('.generated-invite .share-value code').first();
  const previousCode = await code.count() ? await code.innerText() : '';
  await page.getByRole('button', { name: 'Generate invite' }).click();
  await expect(code).toBeVisible();
  if (previousCode) await expect(code).not.toHaveText(previousCode);
  return code.innerText();
}

async function join(page: Page, code: string): Promise<void> {
  await page.getByPlaceholder('Paste invite code').fill(code);
  await page.getByRole('button', { name: 'Join household' }).click();
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible({ timeout: 20_000 });
}

function parseWire(text: string): any {
  const line = text.split('\n').find((item) => item.startsWith('data:'));
  return JSON.parse(line ? line.slice(5).trim() : text || '{}');
}

async function initializeMcp(page: Page): Promise<McpClient> {
  const result = await page.evaluate(async () => {
    const parse = (text: string): any => {
      const line = text.split('\n').find((item) => item.startsWith('data:'));
      return JSON.parse(line ? line.slice(5).trim() : text || '{}');
    };
    const response = await fetch('/mcp', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json', 'MCP-Protocol-Version': '2025-11-25' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'PACT cross-session verification', version: '0.1.0' } } }),
    });
    return { sessionId: response.headers.get('Mcp-Session-Id'), payload: parse(await response.text()) };
  });
  expect(result.sessionId).toBeTruthy();
  expect(result.payload.result.protocolVersion).toBe('2025-11-25');
  await page.evaluate(async (sessionId) => {
    await fetch('/mcp', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json', 'MCP-Protocol-Version': '2025-11-25', 'Mcp-Session-Id': sessionId },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }),
    });
  }, result.sessionId);
  return { sessionId: result.sessionId, protocol: result.payload.result.protocolVersion };
}

async function mcp(page: Page, client: McpClient, name: string, args: Record<string, unknown> = {}): Promise<any> {
  return page.evaluate(async ({ client, name, args }) => {
    const parse = (text: string): any => {
      const line = text.split('\n').find((item) => item.startsWith('data:'));
      return JSON.parse(line ? line.slice(5).trim() : text || '{}');
    };
    const response = await fetch('/mcp', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json', 'MCP-Protocol-Version': client.protocol, 'Mcp-Session-Id': client.sessionId },
      body: JSON.stringify({ jsonrpc: '2.0', id: `${name}-${Date.now()}`, method: 'tools/call', params: { name, arguments: args } }),
    });
    const wire = parse(await response.text());
    if (wire.error) return { mcp_error: wire.error.message || 'MCP error', wire };
    if (wire.result?.isError) return { mcp_error: wire.result.content?.find((item: any) => item.type === 'text')?.text || 'MCP tool error', wire };
    const structured = wire.result?.structuredContent;
    if (structured) return structured;
    const text = wire.result?.content?.find((item: any) => item.type === 'text')?.text;
    return text ? JSON.parse(text) : { mcp_error: 'MCP returned no structured result', wire };
  }, { client, name, args });
}

function expectMcpSuccess(result: any): any {
  expect(result.mcp_error, JSON.stringify(result)).toBeUndefined();
  return result;
}

test('Maya requests through MCP and Siva approves from a separate authenticated session', async ({ browser }) => {
  const password = 'PACT cross session password 2026';
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const siva = await browser.newContext();
  const maya = await browser.newContext();
  const leo = await browser.newContext();
  const sivaPage = await siva.newPage();
  const mayaPage = await maya.newPage();
  const leoPage = await leo.newPage();

  try {
    const sivaUsername = `cross_siva_${suffix}`;
    const mayaUsername = `cross_maya_${suffix}`;
    const leoUsername = `cross_leo_${suffix}`;

    await register(sivaPage, sivaUsername, 'Siva Cross Session', password);
    await sivaPage.getByPlaceholder('Household name').fill(`Cross Session Home ${suffix}`);
    await sivaPage.getByRole('button', { name: 'Create household' }).click();
    const teenInvite = await invite(sivaPage, 'teen', 'limited_spending');
    const childInvite = await invite(sivaPage, 'child', 'request_only');
    const sivaIdentity = await ok(sivaPage, '/api/auth/current');
    const sivaId = sivaIdentity.user.user_id;

    const askRule = await ok(sivaPage, '/api/propose', 'POST', { source_text: 'Ask me before purchases over $1.', created_by: 'spoofed-client' });
    await ok(sivaPage, '/api/confirm', 'POST', { proposal_hash: askRule.proposal_hash, confirmer: 'spoofed-client' });
    const denyRule = await ok(sivaPage, '/api/propose', 'POST', { source_text: 'Never allow children to purchase anything.', created_by: 'spoofed-client' });
    await ok(sivaPage, '/api/confirm', 'POST', { proposal_hash: denyRule.proposal_hash, confirmer: 'spoofed-client' });

    await register(mayaPage, mayaUsername, 'Maya Cross Session', password);
    await join(mayaPage, teenInvite);
    const mayaIdentity = await ok(mayaPage, '/api/auth/current');
    const mayaId = mayaIdentity.user.user_id;
    await logout(mayaPage);
    await login(mayaPage, mayaUsername, password);

    await register(leoPage, leoUsername, 'Leo Cross Session', password);
    await join(leoPage, childInvite);
    const leoIdentity = await ok(leoPage, '/api/auth/current');
    const leoId = leoIdentity.user.user_id;
    await logout(leoPage);
    await login(leoPage, leoUsername, password);

    const card = await ok(sivaPage, '/api/wallet/cards', 'POST', { display_name: 'Maya demo card', brand: 'Visa', last4: '4242', expiry_month: 12, expiry_year: 2030, assigned_member_ids: [mayaId] });
    const paymentMethodId = card.card.payment_method_id;
    const sivaMcp = await initializeMcp(sivaPage);
    const mayaMcp = await initializeMcp(mayaPage);
    const leoMcp = await initializeMcp(leoPage);
    expect(new Set([sivaMcp.sessionId, mayaMcp.sessionId, leoMcp.sessionId]).size).toBe(3);

    const search = expectMcpSuccess(await mcp(mayaPage, mayaMcp, 'search_catalog', { query: '', limit: 6 }));
    const selected = search.products[0];
    const productResult = expectMcpSuccess(await mcp(mayaPage, mayaMcp, 'get_product', { product_id: selected.product_id }));
    const product = productResult.product;
    const requestId = `cross-mcp-${suffix}`;
    const action = {
      request_id: requestId,
      household_id: 'spoofed-household',
      member_id: 'spoofed-member',
      subject_id: mayaId,
      subject_role: 'teen',
      action: 'purchase',
      resource: product.category,
      merchant: product.merchant,
      merchant_type: product.merchant_type,
      category: product.category,
      amount_cents: product.amount_cents,
      currency: product.currency,
      payment_method_id: paymentMethodId,
      provider: 'mock',
      product_id: product.product_id,
      device_id: 'maya-browser',
      surface: 'shared_web_demo',
      audience: 'household',
      beneficiary: mayaId,
      idempotency_key: `${requestId}-once`,
      timestamp: new Date().toISOString(),
    };
    const checked = expectMcpSuccess(await mcp(mayaPage, mayaMcp, 'check_action', { action }));
    expect(checked.decision).toBe('ask');
    expect(checked.caller.member_id).toBe(mayaId);
    expect(checked.action.household_id).toBe(mayaIdentity.session.household_id);
    const pending = expectMcpSuccess(await mcp(mayaPage, mayaMcp, 'request_approval', { action: checked.action, decision_token: checked.decision_token }));
    const approvalId = pending.approval.approval_id;
    expect(pending.approval.member_id).toBe(mayaId);
    expect(pending.approval.approver).toBe(sivaId);

    const mayaOwnApproval = await mcp(mayaPage, mayaMcp, 'approve', { approval_id: approvalId, approver: mayaId, approved: true });
    expect(mayaOwnApproval.mcp_error).toBeTruthy();
    const sivaQueue = expectMcpSuccess(await mcp(sivaPage, sivaMcp, 'get_rules'));
    expect(sivaQueue.approvals.find((item: any) => item.approval_id === approvalId)?.status).toBe('pending');
    const approved = expectMcpSuccess(await mcp(sivaPage, sivaMcp, 'approve', { approval_id: approvalId, approver: 'spoofed-approver', approved: true }));
    expect(approved.approval.status).toBe('approved');
    expect(approved.approval.approved_by).toBe(sivaId);

    const tokenPair = { decision_token: checked.decision_token, approval_token: approved.approval_token };
    for (const tamperedAction of [
      { ...checked.action, amount_cents: checked.action.amount_cents + 1 },
      { ...checked.action, payment_method_id: 'pm-tampered' },
      { ...checked.action, device_id: 'leo-browser' },
      { ...checked.action, product_id: 'pact-game-22' },
      { ...checked.action, rule_version: Number(checked.action.rule_version) + 1 },
    ]) {
      const refused = await mcp(mayaPage, mayaMcp, 'execute_action', { action: tamperedAction, ...tokenPair });
      expect(refused.mcp_error || refused.executed === false).toBeTruthy();
      expect(refused.executed).not.toBe(true);
    }

    const executed = expectMcpSuccess(await mcp(mayaPage, mayaMcp, 'execute_action', { action: checked.action, ...tokenPair }));
    expect(executed.executed).toBe(true);
    const order = expectMcpSuccess(await mcp(mayaPage, mayaMcp, 'get_order_status', { order_id: executed.order.order_id }));
    expect(order.order.status).toBe('success');
    const receipts = expectMcpSuccess(await mcp(mayaPage, mayaMcp, 'get_receipts', { limit: 20 }));
    expect(receipts.integrity.every(Boolean)).toBe(true);

    const leoSearch = expectMcpSuccess(await mcp(leoPage, leoMcp, 'search_catalog', { query: product.product_id, limit: 6 }));
    expect(leoSearch.products.some((item: any) => item.product_id === product.product_id)).toBe(true);
    expectMcpSuccess(await mcp(leoPage, leoMcp, 'get_product', { product_id: product.product_id }));
    const leoAction = { ...checked.action, request_id: `leo-${requestId}`, member_id: 'spoofed-member', subject_id: leoId, subject_role: 'child', beneficiary: leoId, device_id: 'leo-browser', idempotency_key: `leo-${requestId}-once` };
    const leoCheck = expectMcpSuccess(await mcp(leoPage, leoMcp, 'check_action', { action: leoAction }));
    expect(leoCheck.decision).toBe('deny');
    const leoExecute = await mcp(leoPage, leoMcp, 'execute_action', { action: leoCheck.action, decision_token: 'forged-denied-token' });
    expect(leoExecute.mcp_error || leoExecute.executed === false).toBeTruthy();
    expect(leoExecute.executed).not.toBe(true);

    const state = await ok(mayaPage, '/api/state');
    const flow = state.mcp_events.filter((event: any) => event.request_id === requestId || event.request_id === approvalId || event.order_id === executed.order.order_id);
    expect(new Set(flow.map((event: any) => event.tool))).toEqual(new Set(['check_action', 'request_approval', 'approve', 'execute_action', 'get_order_status', 'get_receipts']));
    expect(flow.find((event: any) => event.tool === 'check_action').member_id).toBe(mayaId);
    expect(flow.find((event: any) => event.tool === 'approve' && event.policy_decision === 'approved').member_id).toBe(sivaId);
    expect(flow.find((event: any) => event.tool === 'execute_action' && event.receipt_id).member_id).toBe(mayaId);
    expect(flow.every((event: any) => event.arguments?.decision_token === undefined || event.arguments.decision_token === '[redacted]')).toBe(true);
    expect(flow.every((event: any) => event.arguments?.approval_token === undefined || event.arguments.approval_token === '[redacted]')).toBe(true);

    await mayaPage.getByRole('button', { name: 'Activity', exact: true }).click();
    await expect(mayaPage.getByText('SERVER-RECORDED MCP TRACE')).toBeVisible();
    await expect(mayaPage.locator('.activity-row').filter({ hasText: mayaId }).first()).toBeVisible();
    await expect(mayaPage.locator('.activity-row').filter({ hasText: sivaId }).first()).toBeVisible();
  } finally {
    await Promise.all([siva.close(), maya.close(), leo.close()]);
  }
});
