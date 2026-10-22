# PACT product discovery and controlled ordering verification

Date: 2026-10-19  
Scope: product discovery, evidence handling, deterministic recommendation,
authenticated MCP commerce, exact purchase binding, and regression safety.

## Verdict

PASS for the local simulated product vertical slice. The verified flow is:

```text
natural request → structured requirements → deterministic evidence/ranking
→ compare/select → availability/revision check → policy decision
→ approval when required → exact mock order → order status → receipt
```

The catalog and payment are simulated. This report does not claim Amazon.com
retail access, Amazon Creators API access, Amazon Pay success, or a real order.

## Implemented and verified

- `pact/product_discovery.py` defines a provider-neutral `CatalogProvider`
  boundary, a deterministic `MockCatalogProvider`, and a fail-closed
  `CreatorsApiProvider` status.
- Natural-language laptop requests are parsed into structured requirements:
  category, currency, budget, brand, OS, CPU/GPU terms, RAM, storage, screen,
  weight, battery, use case, availability, hard/soft/unknown constraints, and
  contradictions.
- Hard constraints filter before ranking. Fit scores, matched/unmet/unknown
  constraints, tradeoffs, ranking reasons, retrieval time, and provider
  evidence are visible to the UI and MCP client.
- Unknown availability is preserved as `unknown`; it is never silently treated
  as in stock. Contradictory requirements return no products and a
  clarification response.
- Product comparison is limited to two through five products and includes
  provider evidence, revision, price, availability, ratings, and specs.
- Review text is returned only when supplied by the provider. The local
  fixtures deliberately expose summary/count evidence and no invented review
  prose.
- Recommendation context may use explicit memory for discovery hints only;
  `memory_authorizes` is always false and policy remains independent.
- `create_purchase_request` creates a non-executing request and re-checks
  stock, quantity, shipping, payment method, and authenticated caller before
  calling the existing deterministic policy engine.
- Canonical action hashing now binds product ID, product revision, exact
  amount/currency, quantity, shipping option, catalog/payment providers,
  masked payment method, device, authenticated member/household, and policy
  version. Existing HMAC expiry, nonce replay protection, approval binding,
  TOCTOU re-checks, and receipt integrity remain authoritative.
- The browser Wallet surface uses the authenticated MCP boundary for search,
  product selection, purchase request, policy check, approval, execution, order
  status, and receipts. REST remains for login, household, preferences, and
  administration.
- Trust & Activity renders the server-recorded MCP sequence with redacted
  decision/approval tokens.

## Provider status

| Capability | Status | Evidence |
|---|---|---|
| PACT Sandbox Catalog | PASS | Six deterministic simulated laptop fixtures; local/offline |
| Amazon Creators API | NOT RUN / UNAVAILABLE | Optional boundary is explicit but not configured or verified; no live request made |
| Mock payment provider | PASS | Existing signed execution path; deterministic success/failure states |
| Amazon Pay Sandbox | NOT RUN / UNVERIFIED | Existing optional adapter remains outside the verified path; no credentials added |
| Real retail order | NOT CLAIMED | No scraping, real purchase, or external order is performed |

## Automated test evidence

Product-specific Python tests (`tests/test_product_discovery.py`): **7 passed**.

They cover:

- 20 natural-language phrasings;
- unit normalization and contradictory budgets;
- deterministic ranking and evidence preservation;
- comparison and product revisions;
- canonical hash binding for revision, quantity, shipping, and payment;
- cross-member approval and replay refusal;
- mutation refusal for stale revision, changed quantity/amount, shipping,
  payment method, policy version, and product ID.

Fresh normal-mode browser run on port 8935 with a new SQLite database:

```text
5 passed (1.4m)
```

The five isolated Playwright flows were:

1. household invite and trusted-device artifacts;
2. browser MCP marketplace purchase with server-recorded trace;
3. Maya request → Siva approval in a separate authenticated session;
4. laptop discovery → comparison → controlled order;
5. the existing five-account real household product flow.

The product flow screenshot from this verification is:

```text
test-results/product_discovery_ordering-f1c30-s-a-controlled-laptop-order/product-discovery-ordering.png
```

The test asserted at least three result cards,
structured comparison, live MCP events for `search_catalog`, `get_product`,
`create_purchase_request`, `check_action`, `request_approval`, `approve`,
`execute_action`, `get_order_status`, and `get_receipts`, plus redaction of
decision and approval tokens.

Full regression results after this slice:

| Command | Result |
|---|---|
| `npm run build` | PASS — signal ESM/CJS/DTS and Vite UI build |
| `.venv/bin/python -m pytest -q` | PASS — 118 collected/passed |
| `.venv/bin/python -m pytest -q -s tests/test_bypass.py` | PASS — 240 attempts, 0 bypasses, 0 unauthorized executions |
| `npm run test:signal` | PASS — 7 tests |
| `npm run e2e:signal` | PASS — 1 test |
| `PACT_E2E_BASE_URL=http://127.0.0.1:8935 npm run test:e2e:real -- --workers=1` | PASS — 5 tests, fresh normal-mode database |
| authenticated `scripts/mcp_smoke.py` | PASS — structured output true |
| `git diff --check` | PASS — no whitespace errors |

Bypass output remained:

```text
legitimate_allowed: 1
legitimate_approval_required: 1
legitimate_denied: 1
adversarial_attempts: 240
adversarial_allowed: 0
adversarial_asked: 120
adversarial_denied: 120
unauthorized_executions: 0
replay_failures: 18
parameter_tamper_failures: 40
bypasses: 0
```

No denied or unapproved product action executed.

## MCP and voice surface

The official Python MCP SDK is `2.3.0`; the authenticated Streamable HTTP
smoke negotiated protocol `2025-11-25`. The product tools are:

```text
search_catalog
get_product
compare_products
get_availability
get_product_reviews
get_product_recommendation_context
create_purchase_request
get_order_status
```

The browser also uses the existing policy, approval, execution, and receipt
tools. MCP results contain voice-ready summaries, visual summaries, and a
next-step field. The conversational voice path recognizes laptop discovery,
clarification, comparison, availability, and “order the second one” requests;
it creates an approval request when policy returns `ASK` and never lets speech
or catalog output authorize execution.

## Reproduction

```bash
cd /Users/sivasuryachandran/Documents/HCK/Pact
npm install
npm run build
.venv/bin/python -m pytest -q
.venv/bin/python -m pytest -q -s tests/test_bypass.py
npm run test:signal
npm run e2e:signal
```

Start a fresh local server for the real-account product flow:

```bash
env PACT_PORT=8935 \
  PACT_ALLOWED_ORIGINS=http://127.0.0.1:8935 \
  PACT_BEDROCK_ENABLED=0 \
  PACT_PAYMENT_PROVIDER=mock \
  PACT_SQLITE_PATH=/tmp/pact-product-discovery-20261019-latest.sqlite3 \
  .venv/bin/python -m pact.server

PACT_E2E_BASE_URL=http://127.0.0.1:8935 \
  npm run test:e2e:real -- --workers=1
```

For authenticated MCP smoke, register a normal account, create a household,
and pass the server-issued session in `PACT_MCP_SESSION`. Do not put session
values or credentials in source, reports, or shell history:

```bash
PACT_MCP_ENDPOINT=http://127.0.0.1:8935/mcp \
PACT_MCP_SESSION=<server-issued-session> \
  .venv/bin/python scripts/mcp_smoke.py
```

## Remaining limitations

- Product data, prices, availability, ratings, review summaries, payment, and
  orders are simulated local sandbox data.
- Amazon Creators API is an unconfigured optional boundary, not a verified
  live integration.
- Amazon Pay remains an optional unverified adapter; the verified path is
  `PACT_PAYMENT_PROVIDER=mock`.
- No real Amazon purchase, shipment, external order status, or merchant
  fulfillment occurs.
- The local account system and household identity are hackathon-scale, not
  production identity assurance.
- SQLite is the local persistence layer; no cloud catalog/order deployment is
  claimed.
- Browser speech recognition/synthesis and optional Polly remain platform/
  credential dependent; voice commands remain a local demo surface.
