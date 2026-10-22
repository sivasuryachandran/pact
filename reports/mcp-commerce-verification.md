# PACT MCP commerce verification

Date: 2026-10-19  
Scope: browser-facing authenticated MCP commerce boundary and Trust & Activity
evidence. Existing authentication, policy, approval, payment, receipt, and
household behavior was preserved. `PACT_FINAL_STRESS_TEST.md` was not changed.

## Result

PASS — the marketplace purchase action is now driven by the authenticated
Streamable HTTP MCP server rather than the local commerce REST routes.

The browser sequence is:

```text
initialize
→ search_catalog
→ get_product
→ check_action
→ request_approval (when deterministic policy returns ASK)
→ approve (when the authenticated session has adult approval authority)
→ execute_action
→ get_order_status
→ get_receipts
```

The current browser session is sent through the MCP transport. The browser does
not switch profiles or put a member identity in tool arguments to impersonate
another member. The server resolves the authenticated caller from the MCP
session and ignores spoofed identity fields.

## Live smoke

The smoke used a fresh normal-mode server and SQLite database on port `8920`:

```bash
env PACT_PORT=8920 \
  PACT_ALLOWED_ORIGINS=http://127.0.0.1:8920 \
  PACT_BEDROCK_ENABLED=0 \
  PACT_PAYMENT_PROVIDER=mock \
  PACT_SQLITE_PATH=/tmp/pact-mcp-commerce-20261018.sqlite3 \
  .venv/bin/python -m pact.server
```

The product rule was chosen so the selected seeded product required approval;
this exercised the complete approval path without using a demo-login or a
fake member switch.

Observed smoke result:

```text
protocol: 2025-11-25
executed: true
receipt_result: executed
receipt_integrity: true
order_status: success
mcp_event_count: 10
events_have_latency: true
events_redact_tokens: true
```

The recorded event ledger contained the commerce calls and their server-side
results. Each event includes:

- request ID;
- authenticated member ID and household ID;
- MCP tool name;
- recursively redacted arguments and result/error;
- deterministic policy decision when present;
- latency in milliseconds;
- receipt ID and/or order ID when present;
- UTC timestamp.

Decision and approval tokens are not persisted or displayed in clear text in
the MCP event ledger. Token-like fields are replaced with `[redacted]` before
the event is saved to SQLite and returned to the UI.

## Trust & Activity behavior

The Activity page reads `mcp_events` from the authenticated server state and
labels the panel `SERVER-RECORDED MCP TRACE`. It no longer presents a locally
inferred tool list as live MCP telemetry. The redacted JSON-RPC trace and
timeline are populated from the persisted MCP boundary events.

REST remains intentionally in use for login, preferences, household
management, settings, and other non-commerce product surfaces. The marketplace
purchase path itself uses MCP tools for catalog, policy, approval, execution,
order status, and receipts.

## Cross-member approval verification

PASS — `tests/e2e/mcp_cross_session_commerce.spec.ts` completed in normal mode
with three isolated authenticated browser contexts and separate MCP
Streamable HTTP sessions:

- Maya searched the catalog, selected a product, received deterministic `ASK`,
  and requested approval through MCP.
- Maya’s attempt to approve her own request was rejected.
- Siva viewed the pending request and approved it from his separate adult
  session; the spoofed approver argument was ignored.
- Five exact-action mutations (amount, payment method, device, product, and
  rule version) were refused after approval.
- Maya executed the unchanged action once; order status was successful and the
  receipt integrity check passed.
- Leo checked the same restricted purchase and received deterministic `DENY`;
  forged execution was refused.
- The Activity page displayed server-recorded MCP rows with distinct Maya
  requester and Siva approver identities. Decision and approval tokens stayed
  redacted.

## Payment and product boundaries

The payment provider used in this verification was the deterministic mock
provider. No real purchase, Amazon.com order, booking, hardware action, or
Alexa+ integration occurred. Amazon Pay Sandbox remains an optional adapter
whose end-to-end merchant credentials and external checkout are not claimed as
verified.

The selected product, merchant, amount, currency, household, subject, device,
provider, rule version, decision token, approval token, and idempotency key
remain bound by the existing canonical action and executor checks. A denied,
unapproved, expired, replayed, or modified action is refused by code.

## Regression evidence

```text
.venv/bin/python -m pytest -q       PASS; 98 passed, including the MCP event projection assertion
npm run build                        PASS
npm run test:signal                  PASS; 7 tests
npm run e2e:signal                   PASS; 1 test
npm run test:e2e:real                PASS; 4 tests on a fresh normal-mode server,
                                    including the cross-member approval flow
npx playwright test --config=playwright.real.config.ts tests/e2e/mcp_commerce.spec.ts
                                    PASS; 1 focused live MCP commerce test
npx playwright test --config=playwright.real.config.ts tests/e2e/mcp_cross_session_commerce.spec.ts
                                    PASS; 1 focused cross-member MCP test
```

The MCP regression assertion also verifies that `get_rules` exposes an MCP
event list for the authenticated state projection. Run the current full suite
again with the commands in the README before submission.

## Reproduction

```bash
npm install
npm run build
.venv/bin/python -m pytest -q
npm run test:signal
npm run e2e:signal
```

Start the server with a fresh database, authenticate through the normal login
flow, open Wallet, and select **Run MCP purchase flow** on a seeded product.
Open Activity afterward to inspect the server-recorded trace. A separate
authenticated adult session is required to approve a different member’s
pending request; no fake profile switching is part of the product path.
