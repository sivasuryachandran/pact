# PACT household authorization and Amazon Pay Sandbox report

Date: 2026-10-18  
Repository: `/Users/sivasuryachandran/Documents/HCK/Pact`  
`PACT_FINAL_STRESS_TEST.md` was not modified.

## Executive summary

PACT’s local real-account product path is complete and regression-tested:

```text
account → household → invite/device trust → local catalog
→ deterministic policy → adult approval → provider result → receipt
```

The default provider is `MockPaymentProvider`. An optional Amazon Pay Sandbox
Checkout Session adapter is implemented, but no Sandbox merchant/key or buyer
access was available for external verification. PACT reports that provider as
unavailable and never claims an Amazon checkout succeeded.

## Positioning and architecture

> PACT lets a family decide who can spend what, on which household payment
> method, and when an adult must approve before an AI assistant commits it.

PACT Marketplace is a local simulated catalog, not Amazon.com retail ordering.
The trust flow is authenticated identity → local product/wallet context →
signed canonical action → deterministic Allow/Ask/Deny → exact adult approval
token → token/policy/budget/replay checks → mock result or Sandbox session →
verified provider result and receipt. Bedrock/LLM output is candidate data
only; it never decides authorization or calls a payment provider.

## Implemented files and state

- `pact/marketplace.py`: deterministic local product catalog and exact
  product/action matching.
- `pact/payment_providers.py`: provider boundary, mock outcomes, and optional
  Amazon Pay Sandbox Checkout v2 signing/session support.
- `pact/canonical.py`, `pact/schemas.py`: signed/validated device, provider,
  product, and rule-version action fields.
- `pact/service.py`, `pact/server.py`: catalog, provider status, guarded
  checkout preparation, order status, API routes, and MCP tools.
- `pact/state.py`: non-secret payment order persistence.
- `pact/wallet.py`: masked simulated-card behavior and provider status.
- `frontend/src/App.tsx`, `frontend/src/marketplace.css`: local marketplace
  surface inside Wallet.
- `.env.example`, `README.md`, `tests/test_marketplace_payments.py`, and
  `tests/test_mcp.py`.

SQLite stores product/order metadata, not private keys, PANs, CVVs, PINs,
invite secrets, or raw provider credentials. Existing users, memberships,
profiles, invites, devices, policies, approvals, receipts, replay state, and
wallet state remain preserved.

## API and MCP

Authenticated API routes added: `GET /api/catalog/search`,
`GET /api/catalog/{product_id}`, `GET /api/payment/status`,
`POST /api/checkout/prepare`, and `GET /api/orders/{order_id}`.
Checkout preparation verifies the exact action and approval but never marks a
pending checkout paid.

Authenticated MCP tools added: `search_catalog`, `get_product`, and
`get_order_status`. They are product/status tools; raw payment operations are
not exposed to the model.

## Policy, wallet, household, and device behavior

ALLOW reaches a provider only after current signed-action and policy checks.
ASK requires the exact adult approval token. DENY never calls a provider.
Product, merchant, category, currency, amount, payment method, device,
provider, and rule-version changes invalidate exact-token verification.
Mock declined, abandoned, and cancelled outcomes are rejected and never create
successful receipts. Provider status and references are server-generated.

The existing normal-account invite/device flow remains active: hashed,
expiring, revocable, one-time household-bound invite codes; real registration
before acceptance; short-lived session-bound pairing; different-adult approval;
and device revocation. Wallet cards accept masked metadata only and are labeled
“Simulated payment method.” Wallet permissions are deterministic PACT rules.

## Amazon Pay Sandbox status

Status: **IMPLEMENTED BUT NOT EXTERNALLY TESTED; BLOCKED FOR SANDBOX
VERIFICATION**.

The adapter follows documented Checkout Session v2 concepts: server-side
request signing, sandbox endpoint selection, idempotency, local product
amounts, and explicit pending state. It does not convert an open/failed
session into a success. References used:

- [Amazon Pay API introduction](https://developer.amazon.com/docs/amazon-pay-api-v2/introduction.html)
- [Checkout Session API](https://developer.amazon.com/docs/amazon-pay-api-v2/checkout-session.html)
- [Request signing](https://developer.amazon.com/docs/amazon-pay-api-v2/v1-signing-requests.html)
- [Sandbox testing](https://developer.amazon.com/docs/amazon-pay-checkout/test-your-integration.html)

Observed without credentials: `name=amazon_pay_sandbox`, `available=False`,
`configured=False`, `environment=sandbox`, `region=na`,
`endpoint=https://pay-api.amazon.com/sandbox/v2`,
`reason=sandbox merchant/key configuration is incomplete`, `simulated=False`.
No secret, private key, merchant credential, buyer account, or provider
response was printed, saved, or committed. No Amazon.com retail order is
claimed.

## Environment variables

```text
PACT_PAYMENT_PROVIDER=mock
AMAZON_PAY_ENV=sandbox
AMAZON_PAY_REGION=na
AMAZON_PAY_MERCHANT_ID=
AMAZON_PAY_PUBLIC_KEY_ID=
AMAZON_PAY_PRIVATE_KEY_PATH=
PACT_MOCK_PAYMENT_OUTCOME=success
```

Use `amazon_pay_sandbox` only with complete server-side configuration. Missing
configuration fails closed. No secrets belong in source, reports, browser code,
or logs.

## Exact verification results

```text
.venv/bin/python -m pytest -q                         PASS — 98 passed
.venv/bin/python -m pytest -q -s tests/test_bypass.py PASS — 240 attempts, 0 bypasses
npm run build                                         PASS
npm run test:signal                                   PASS — 7 tests
npm run e2e:signal                                    PASS — 1 test
git diff --check                                      PASS
```

Fresh normal-account browser run on `/tmp/pact-marketplace-final-clean.sqlite3`:
`PACT_E2E_BASE_URL=http://127.0.0.1:8911 npx playwright test
--config=playwright.real.config.ts --timeout=120000` → **PASS, 2 tests,
49.3 seconds**. It covered the five isolated real-account product flow and
invite/pairing QR flow; no demo-login or member-ID switching was used.

Authenticated MCP smoke: SDK `2.3.0`, negotiated protocol `2025-11-25`,
authenticated session `True`, structured `get_rules` output `True`, and tools
`get_rules`, `search_catalog`, `get_product`, `get_order_status`,
`propose_rule`, `confirm_rule`, `check_action`, `request_approval`, `approve`,
`execute_action`, and `get_receipts`.

Catalog/payment smoke: `pact-headphones-18 1800 simulated`; provider `mock`,
available `True`, simulated `True`.

Security output:

```text
legitimate_allowed=1
legitimate_approval_required=1
legitimate_denied=1
adversarial_attempts=240
unauthorized_executions=0
replay_failures=18
parameter_tamper_failures=40
bypasses=0
```

## Screenshots and demo

Existing clean artifacts remain under
`test-results/real_household_product-fiv-5fe6b-s-complete-the-product-flow/`.
The screenshot shows authenticated household chrome, five-user flow,
preferences, approval, receipt, and logout. The marketplace is visible in
Wallet after login. No Amazon checkout screenshot was created because external
Sandbox checkout was unavailable.

Demo: register Siva, create Miller Residence, invite Anika/Maya/Leo/Nora,
pair a browser with adult approval, add `Family Visa ···· 4242`, assign it to
Maya, add an electronics Ask rule up to `$25`, choose local `$18` headphones,
check/approve/execute, then show Leo’s deterministic gaming denial and the
Activity receipt. Mock is the only verified payment success. A configured
Amazon session remains pending until its official buyer flow completes.

## Limitations, scores, and final assessment

Amazon buyer redirect completion, finalization, polling, webhook/IPN
verification, and external merchant/buyer verification remain untested.
Mock is the only end-to-end provider verified. The catalog is simulated and
does not place Amazon.com orders. Authentication is hackathon-scale (no email
verification, recovery, MFA, OAuth/SSO, passkeys, or email delivery). SQLite
is local persistence; voice and all device/add-on/payment surfaces remain
simulated. No Alexa+ partner or production payment control is claimed.

Honest scores: Technical Implementation 4.5/5; Design 4/5; Potential Impact
4.5/5; Quality of Idea 4.5/5; Amazon integration 2/5; Demo readiness 4/5.
The main win risk is no verified external Amazon Pay Sandbox checkout; the
second is hackathon-scale authentication.

The local PACT household product scope is complete and verified. The strongest
truthful claim is: **PACT is a real local-account household assistant with
invitations, trusted devices, private preferences, role-aware deterministic
authorization, simulated wallet controls, authenticated MCP access, exact
approval tokens, and a local marketplace/payment boundary.** It is not
production-ready and does not claim live Alexa+, Amazon.com ordering, or
production payment control.
