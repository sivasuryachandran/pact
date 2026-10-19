import { expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test';

type ApiResult<T = any> = { status: number; body: T };
type Member = {
  key: string;
  username: string;
  displayName: string;
  email: string;
  password: string;
  role?: string;
  context?: BrowserContext;
  page?: Page;
  userId?: string;
  householdId?: string;
};

const password = 'PACT e2e password 2026';
const members: Member[] = [
  { key: 'siva', username: 'siva_product_demo', displayName: 'Siva', email: 'siva_product_demo@example.test', password },
  { key: 'anika', username: 'anika_product_demo', displayName: 'Anika', email: 'anika_product_demo@example.test', password, role: 'adult' },
  { key: 'maya', username: 'maya_product_demo', displayName: 'Maya', email: 'maya_product_demo@example.test', password, role: 'teen' },
  { key: 'leo', username: 'leo_product_demo', displayName: 'Leo', email: 'leo_product_demo@example.test', password, role: 'child' },
  { key: 'nora', username: 'nora_product_demo', displayName: 'Nora', email: 'nora_product_demo@example.test', password, role: 'caregiver' },
];

async function api<T = any>(page: Page, path: string, method = 'GET', body?: unknown): Promise<ApiResult<T>> {
  return page.evaluate(async ({ path, method, body }) => {
    const csrf = document.cookie.split('; ').find((part) => part.startsWith('PACT_CSRF='))?.slice('PACT_CSRF='.length) || '';
    const response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-PACT-CSRF': csrf } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let parsed: any = text;
    try { parsed = text ? JSON.parse(text) : {}; } catch { /* preserve non-JSON error text */ }
    return { status: response.status, body: parsed };
  }, { path, method, body });
}

async function expectOk<T>(result: ApiResult<T>): Promise<T> {
  expect(result.status, JSON.stringify(result.body)).toBeGreaterThanOrEqual(200);
  expect(result.status, JSON.stringify(result.body)).toBeLessThan(300);
  return result.body;
}

async function register(page: Page, member: Member): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in to your household.' })).toBeVisible();
  await page.getByRole('button', { name: 'New here? Create an account' }).click();
  await page.getByLabel('Username or email').fill(member.username);
  await page.getByLabel('Display name').fill(member.displayName);
  await page.locator('label').filter({ hasText: 'Email' }).locator('input[type="email"]').fill(member.email);
  await page.getByLabel('Password').fill(member.password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Bring your household into PACT.' })).toBeVisible();
}

async function login(page: Page, member: Member): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in to your household.' })).toBeVisible();
  await page.getByLabel('Username or email').fill(member.username);
  await page.getByLabel('Password').fill(member.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
  await expect(page.getByLabel(/PACT Core sphere/)).toBeVisible();
  await expect(page.locator('.pact-core-sphere')).toHaveAttribute('data-core-state', 'idle');
  await expect(page.getByText('browser MCP verified')).toBeVisible({ timeout: 20_000 });
}

async function logout(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in to your household.' })).toBeVisible();
}

async function join(page: Page, code: string): Promise<void> {
  await page.getByPlaceholder('Paste invite code').fill(code);
  await page.getByRole('button', { name: 'Join household' }).click();
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
}

async function createInvite(page: Page, role: string): Promise<string> {
  await page.getByRole('button', { name: 'Preferences' }).click();
  const card = page.locator('.st-card').filter({ hasText: 'Invite someone' });
  await expect(card).toBeVisible();
  const codeLocator = card.locator('.invite-code strong');
  const previousCode = await codeLocator.count() ? await codeLocator.last().innerText() : '';
  await card.locator('select').selectOption(role);
  await card.getByRole('button', { name: 'Create invite' }).click();
  await expect(codeLocator.last()).toBeVisible();
  if (previousCode) await expect(codeLocator.last()).not.toHaveText(previousCode);
  const code = await codeLocator.last().innerText();
  expect(code.trim()).not.toBe('');
  await page.getByRole('button', { name: 'Close settings' }).click();
  return code.trim();
}

async function savePreference(page: Page, marker: string, shared: Record<string, string> = {}, consent = false): Promise<void> {
  await page.getByRole('button', { name: 'Preferences' }).click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  const fields = page.locator('.st-pref-text');
  await expect(fields).toHaveCount(2);
  // Settings may finish its one-time timezone auto-save after the drawer opens;
  // let that server response re-adopt the profile before editing preferences.
  await page.waitForTimeout(300);
  await fields.nth(0).fill(JSON.stringify({ private_marker: marker }));
  await fields.nth(1).fill(JSON.stringify(shared));
  const privacy = page.locator('.st-card').filter({ hasText: 'Preference privacy' });
  const toggle = privacy.locator('input[role="switch"]');
  if (await toggle.isChecked() !== consent) await privacy.getByText('Share this household profile', { exact: true }).click();
  await expect(toggle).toHaveJSProperty('checked', consent);
  await page.waitForTimeout(100);
  await privacy.getByRole('button', { name: 'Save preference boundary' }).click();
  await expect(page.getByRole('status')).toContainText('saved', { timeout: 10_000 });
  await page.getByRole('button', { name: 'Close settings' }).click();
}

async function current(page: Page): Promise<any> {
  return expectOk(await api(page, '/api/auth/current'));
}

test('five real household accounts complete the product flow', async ({ browser }, testInfo: TestInfo) => {
  const contexts: BrowserContext[] = [];
  const mcpRequests: string[] = [];
  try {
    for (const member of members) {
      member.context = await browser.newContext();
      member.page = await member.context.newPage();
      member.page.on('request', (request) => {
        if (new URL(request.url()).pathname === '/mcp') mcpRequests.push(`${member.key}:${request.postData() || ''}`);
      });
      contexts.push(member.context);
    }

    const siva = members[0];
    const sivaPage = siva.page!;
    await register(sivaPage, siva);
    await sivaPage.getByPlaceholder('Household name').fill('Product Demo Household');
    await sivaPage.getByRole('button', { name: 'Create household' }).click();
    await expect(sivaPage.getByRole('button', { name: 'Log out' })).toBeVisible();

    const inviteCodes: Record<string, string> = {};
    for (const member of members.slice(1)) inviteCodes[member.key] = await createInvite(sivaPage, member.role!);
    await logout(sivaPage);
    await login(sivaPage, siva);

    let delayedCommand = true;
    await sivaPage.route('**/api/command', async (route) => {
      if (delayedCommand) {
        delayedCommand = false;
        await new Promise((resolve) => setTimeout(resolve, 650));
      }
      await route.continue();
    });
    await sivaPage.getByLabel('Typed PACT command').fill('Book Funzone.');
    await sivaPage.getByRole('button', { name: 'Send' }).click();
    await expect(sivaPage.locator('.pact-core-sphere')).toHaveAttribute('data-core-state', 'thinking');
    await expect(sivaPage.locator('.pact-core-sphere')).toHaveAttribute('data-core-state', 'approval_required', { timeout: 10_000 });
    await sivaPage.unroute('**/api/command');

    for (const member of members.slice(1)) {
      const page = member.page!;
      await register(page, member);
      await join(page, inviteCodes[member.key]);
      await logout(page);
      await login(page, member);
    }

    for (const member of members) {
      const payload = await current(member.page!);
      member.userId = payload.user.user_id;
      member.householdId = payload.session.household_id;
      expect(member.householdId).toBe(siva.householdId || member.householdId);
      await savePreference(member.page!, `${member.key}-private-marker`);
    }
    siva.householdId = members[1].householdId;
    expect(new Set(members.map((member) => member.userId)).size).toBe(5);
    expect(new Set(members.map((member) => member.householdId)).size).toBe(1);

    const maya = members[2];
    await savePreference(maya.page!, 'maya-private-marker', { favorite: 'board-games' }, true);
    for (const member of members) {
      const projection = await expectOk(await api<any>(member.page!, '/api/preferences'));
      const own = projection.profile.personal;
      expect(own.private_marker).toBe(`${member.key === 'maya' ? 'maya' : member.key}-private-marker`);
      const serialized = JSON.stringify(projection.members);
      for (const other of members.filter((candidate) => candidate.key !== member.key)) {
        expect(serialized).not.toContain(`${other.key}-private-marker`);
      }
      const mayaProjection = projection.members.find((item: any) => item.id === maya.userId);
      expect(mayaProjection.personal).toBeUndefined();
      expect(mayaProjection.preferences).toBeUndefined();
      expect(mayaProjection.shared_preferences).toEqual({ favorite: 'board-games' });
    }

    const proposal = await expectOk(await api<any>(sivaPage, '/api/propose', 'POST', { source_text: 'Ask me before booking anything over $100.', created_by: 'spoofed-client' }));
    expect(proposal.rule.approver).toBe(siva.userId);
    await expectOk(await api(sivaPage, '/api/confirm', 'POST', { proposal_hash: proposal.proposal_hash, confirmer: 'spoofed-client' }));

    const booking = {
      request_id: 'real-ui-maya-booking', subject_id: maya.userId, subject_role: 'teen', action: 'booking', resource: 'venue', merchant: 'VenueBook', amount_cents: 12000, currency: 'USD', surface: 'shared_web_demo', idempotency_key: 'real-ui-maya-booking-once',
    };
    const mayaCheck = await expectOk(await api<any>(maya.page!, '/api/check', 'POST', { ...booking, member_id: 'siva', actor_role: 'adult' }));
    expect(mayaCheck.decision).toBe('ask');
    expect(mayaCheck.caller.member_id).toBe(maya.userId);
    const mayaAction = mayaCheck.action;
    const pending = await expectOk(await api<any>(maya.page!, '/api/request-approval', 'POST', { action: mayaAction, decision_token: mayaCheck.decision_token }));
    const mayaOwnApproval = await api<any>(maya.page!, '/api/approve', 'POST', { approval_id: pending.approval.approval_id, approver: maya.userId, approved: true });
    expect(mayaOwnApproval.status).toBe(403);
    const approved = await expectOk(await api<any>(sivaPage, '/api/approve', 'POST', { approval_id: pending.approval.approval_id, approver: 'spoofed-approver', approved: true }));
    expect(approved.approval.status).toBe('approved');
    const mayaExecuted = await expectOk(await api<any>(maya.page!, '/api/execute', 'POST', { action: mayaAction, decision_token: mayaCheck.decision_token, approval_token: approved.approval_token }));
    expect(mayaExecuted.executed, JSON.stringify(mayaExecuted)).toBe(true);

    const leo = members[3];
    const leoBooking = { ...booking, request_id: 'real-ui-leo-booking', subject_id: leo.userId, idempotency_key: 'real-ui-leo-booking-once' };
    const leoCheck = await expectOk(await api<any>(leo.page!, '/api/check', 'POST', leoBooking));
    expect(leoCheck.decision).toBe('ask');
    const leoAction = leoCheck.action;
    const leoPending = await expectOk(await api<any>(leo.page!, '/api/request-approval', 'POST', { action: leoAction, decision_token: leoCheck.decision_token }));
    const leoApproved = await expectOk(await api<any>(sivaPage, '/api/approve', 'POST', { approval_id: leoPending.approval.approval_id, approved: true }));
    const leoExecuted = await expectOk(await api<any>(leo.page!, '/api/execute', 'POST', { action: leoAction, decision_token: leoCheck.decision_token, approval_token: leoApproved.approval_token }));
    expect(leoExecuted.executed).toBe(false);
    expect(leoExecuted.error).toContain('child members cannot execute');

    const nora = members[4];
    const noraRule = await expectOk(await api<any>(sivaPage, '/api/propose', 'POST', { source_text: `Allow ${nora.userId} to purchase groceries under $20.`, created_by: 'spoofed-client' }));
    await expectOk(await api(sivaPage, '/api/confirm', 'POST', { proposal_hash: noraRule.proposal_hash, confirmer: 'spoofed-client' }));
    const groceries = { request_id: 'real-ui-nora-groceries', subject_id: nora.userId, subject_role: 'caregiver', action: 'purchase', resource: 'groceries', merchant: 'GroceryBox', amount_cents: 1500, currency: 'USD', surface: 'shared_web_demo', idempotency_key: 'real-ui-nora-groceries-once' };
    const noraCheck = await expectOk(await api<any>(nora.page!, '/api/check', 'POST', groceries));
    expect(noraCheck.decision).toBe('allow');
    const noraAction = noraCheck.action;
    const noraExecuted = await expectOk(await api<any>(nora.page!, '/api/execute', 'POST', { action: noraAction, decision_token: noraCheck.decision_token }));
    expect(noraExecuted.executed).toBe(true);
    const noraBooking = { ...groceries, request_id: 'real-ui-nora-booking', action: 'booking', resource: 'venue', idempotency_key: 'real-ui-nora-booking-once', amount_cents: 12000 };
    const noraBookingCheck = await expectOk(await api<any>(nora.page!, '/api/check', 'POST', noraBooking));
    expect(noraBookingCheck.decision).toBe('ask');
    const noraUnapproved = await expectOk(await api<any>(nora.page!, '/api/execute', 'POST', { action: noraBookingCheck.action, decision_token: noraBookingCheck.decision_token }));
    expect(noraUnapproved.executed).toBe(false);

    const receipts = await expectOk(await api<any>(sivaPage, '/api/receipts'));
    expect(receipts.integrity.every(Boolean)).toBe(true);
    expect(receipts.receipts.some((receipt: any) => receipt.result === 'executed' && receipt.subject_id === maya.userId)).toBe(true);
    expect(receipts.receipts.some((receipt: any) => receipt.result === 'executed' && receipt.subject_id === nora.userId)).toBe(true);
    expect(receipts.receipts.some((receipt: any) => receipt.result === 'rejected' && receipt.subject_id === leo.userId)).toBe(true);

    await sivaPage.screenshot({ path: testInfo.outputPath('real-household-product-final.png'), fullPage: true });
    expect(mcpRequests.some((request) => request.includes('"method":"initialize"'))).toBe(true);
    expect(mcpRequests.some((request) => request.includes('"method":"tools/call"') && request.includes('get_rules'))).toBe(true);

    await logout(maya.page!);
    const afterLogout = await api<any>(maya.page!, '/api/auth/current');
    expect(afterLogout.status).toBe(200);
    expect(afterLogout.body.authenticated).toBe(false);
    const oldSessionState = await api<any>(maya.page!, '/api/state');
    expect(oldSessionState.status).toBe(401);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
