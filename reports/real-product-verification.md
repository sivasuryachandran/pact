# PACT real-product verification

Date: 2026-10-18  
Scope: local account product, household onboarding, preference privacy, real
authenticated MCP access, and preservation of the existing policy/security
core.

## Assessment

PACT now has a real local-account product path in normal mode:

```text
register → login → create household or accept invite → private preferences
→ authenticated assistant → deterministic policy → approval → execution → receipt
```

The account system is intentionally hackathon-scale. It is not production
identity assurance: there is no email verification, password recovery, MFA,
OAuth/SSO, passkeys, or email delivery.

`PACT_FINAL_STRESS_TEST.md` was not modified. Existing security work was not
reset or discarded. Seeded member-ID login is disabled unless
`PACT_DEMO_MODE=1` or pytest compatibility mode is active.

## Implementation verified

- SQLite-backed users, households, memberships, sessions, invites, and profiles.
- Passwords stored as `scrypt$...` hashes; plaintext passwords are not stored.
- Persistent sessions stored as hashes with expiry and revocation.
- HttpOnly SameSite session cookie plus non-HttpOnly CSRF cookie for browser
  writes; `PACT_COOKIE_SECURE=1` enables secure cookies for HTTPS.
- Registration, login, logout, current-user endpoint, login failure handling,
  household creation, invite creation, invite acceptance, invite expiry,
  invite revocation, and single-use invite enforcement.
- Personal preferences are private to the signed-in user. Shared preferences
  appear in the household projection only after explicit consent.
- Authenticated caller identity is used by API and MCP service calls; supplied
  `member_id`, `household_id`, `created_by`, `confirmer`, `approver`, and
  `owner_id` values do not override it.
- Browser UI has login, registration, onboarding, current-user indicator,
  logout, household invite controls, personal/shared preference controls, and
  a real MCP initialize plus `tools/call get_rules` wire flow.

## Exact test results

Commands run after implementation:

```text
npm install                                      PASS; 119 packages, 0 vulnerabilities
npm run build                                    PASS; signal + UI builds
.venv/bin/python -m pytest -q                   PASS; 80 passed
.venv/bin/python -m pytest -q -s tests/test_bypass.py
                                                 PASS; 240 attempts, 0 bypasses
npm run test:signal                              PASS; 7 tests
npm run e2e:signal                               PASS; 1 Playwright test
```

The Python count is 80 total: the previous 74 plus 6 new account/product
tests. The bypass output remained:

```text
legitimate_allowed: 1
legitimate_approval_required: 1
legitimate_denied: 1
adversarial_attempts: 240
unauthorized_executions: 0
replay_failures: 18
parameter_tamper_failures: 40
bypasses: 0
```

The targeted policy/token/private/identity tests also passed. No denied or
unapproved action executed.

## Authentication and household onboarding

Normal-mode verification used a fresh server and fresh SQLite database:

```bash
env PACT_PORT=8804 \
  PACT_ALLOWED_ORIGINS=http://127.0.0.1:8804 \
  PACT_BEDROCK_ENABLED=0 \
  PACT_SQLITE_PATH=/tmp/pact-real-product-20261018-b.sqlite3 \
  .venv/bin/python -m pact.server
```

Observed API results:

| Flow | Result |
|---|---|
| `/api/demo-login` in normal mode | PASS — 404; explicitly disabled |
| Register account | PASS |
| Correct password login | PASS |
| Incorrect password | PASS — rejected |
| Current-user endpoint | PASS |
| Create household | PASS; durable household ID |
| Create four role-specific invites | PASS |
| Register and accept four invites | PASS; five-member household |
| Reuse accepted invite | PASS — rejected |
| Revoked invite | PASS — rejected |
| Expired invite | PASS — rejected |
| Server restart, existing account login, household reload | PASS |
| Logout and reuse old session | PASS — old session resolves unauthenticated |

The normal product never uses a profile dropdown or member-ID selection as
authentication. The seeded five-member path remains available only for tests
and explicitly enabled development demos.

## Five-user permission matrix

The real-account API flow created five separate accounts and joined four by
single-use invites.

| User | Role | Expected capability | Verified |
|---|---|---|---|
| Siva test account | owner/adult | manage household/rules and approve | PASS |
| Anika test account | co-parent/adult | approve permitted actions | PASS |
| Maya test account | teen | request; no approval | PASS |
| Leo test account | child | restricted requests; no paid/private/device execution | PASS |
| Nora test account | caregiver | only explicitly allowed caregiver action | PASS |

Concrete real-account results:

- Siva’s authenticated user ID became the rule creator/approver even when the
  client submitted spoofed values.
- Maya received `ask`, could request approval, and received deterministic
  denial when attempting to approve.
- Leo could not execute the restricted booking after the owner approved the
  exact request.
- Nora’s explicitly confirmed grocery-under-$20 rule returned `allow` and
  executed; an unrelated booking returned `ask` and did not execute.

The authorization decision remained in the deterministic service layer.

## Preference privacy

The previous limitation was fixed in normal product mode.

- `/api/preferences` returns the current user’s personal profile to that user.
- Household member projections omit personal profile data.
- Shared profile data is empty until the member opts in with `share_consent`.
- After opting in, only the shared profile appears to household members.
- The Settings drawer visibly separates “Personal preferences” from
  “Household-shared preferences” and labels sharing consent.
- Preference values are not used by policy authorization.

The five-account probe confirmed that personal markers remained in each
member’s own profile and never appeared in household member records, while an
explicitly shared marker did appear.

## MCP authenticated flow

The official Streamable HTTP server remains active at `/mcp`.

```text
MCP SDK: 2.3.0
Negotiated protocol: 2025-11-25
Tools: get_rules, propose_rule, confirm_rule, check_action,
       request_approval, approve, execute_action, get_receipts
Structured output: true
```

An authenticated account session was supplied to the MCP client through
`X-PACT-Session`. `get_rules` returned the authenticated account identity, and
`propose_rule` ignored a spoofed `created_by` value. Changing the authenticated
identity after transport initialization returned an MCP tool error rather than
switching users. Cross-session and cross-household token checks remained
passing.

The browser now performs a real same-origin MCP `initialize` request followed
by `tools/call` for `get_rules` after account authentication. The footer reports
“browser MCP verified” only after that wire flow succeeds. The ordinary UI
operations still use REST endpoints where that is simpler.

Normal-mode smoke reproduction requires a server-issued session:

```bash
PACT_MCP_ENDPOINT=http://127.0.0.1:8804/mcp \
PACT_MCP_SESSION=<server-issued-session-from-/api/auth/login> \
.venv/bin/python scripts/mcp_smoke.py
```

No session secret or AWS credential should be placed in source, reports, or
shell history.

## Bedrock

Real Bedrock verification used the existing AWS profile without printing
credential values:

```text
profile: pact
region: us-west-2
model: amazon.nova-lite-v1:0
catalog: text input/output; ON_DEMAND and INFERENCE_PROFILE
candidate: PASS; compiler=bedrock; valid rule JSON and read-back
candidate latency: 1396.4 ms
clarification: PASS; latency 470.1 ms
failure_count: 0
```

Bedrock proposes candidate rule data only. Confirmation, deterministic
allow/ask/deny evaluation, signed tokens, approvals, execution, and receipts
remain code-owned. Deterministic fallback remains available when Bedrock is
disabled or unavailable.

## Reproduction

```bash
npm install
npm run build
.venv/bin/python -m pytest -q
.venv/bin/python -m pytest -q -s tests/test_bypass.py
npm run test:signal
npm run e2e:signal
```

Start normal product mode:

```bash
PACT_SQLITE_PATH=pact-data.sqlite3 \
PACT_BEDROCK_ENABLED=0 \
.venv/bin/python -m pact.server
```

Then open the server URL, register, create a household, create invite codes
from Preferences, and have four separate browser contexts register and accept
their codes. For real Bedrock, set `AWS_PROFILE`, `PACT_AWS_REGION`,
`PACT_BEDROCK_ENABLED=1`, and `PACT_BEDROCK_MODEL_ID` through the environment.

## Remaining limitations

- Local account authentication is not production identity assurance.
- No email verification, password recovery, MFA, OAuth, SSO, or passkeys.
- Invite delivery is manual copy/paste; there is no email or SMS delivery.
- SQLite is the persistence layer; there is no multi-process/cloud database
  deployment claim.
- Browser microphone recognition/speech synthesis remains browser/platform
  dependent.
- Purchases, bookings, devices, add-ons, and receipts are simulated only.
- No real Alexa+ partner access, Amazon payment, booking, Fire TV, hardware,
  or production smart-home control is claimed.

## Final five-account product-demo verification

Date: 2026-10-18. This pass used normal mode only: `PACT_DEMO_MODE` was not
set, `/api/demo-login` was not used, and the server used a new SQLite database
at `/tmp/pact-final-ui-20261018-c.sqlite3` on port 8805. No existing source
changes or `PACT_FINAL_STRESS_TEST.md` were reset or discarded.

The new Playwright test is
`tests/e2e/real_household_product.spec.ts`, configured by
`playwright.real.config.ts` and runnable with `npm run test:e2e:real`.

Result: PASS — one test, five isolated browser contexts, 8.4 seconds. The
contexts registered and re-logged in as Siva, Anika, Maya, Leo, and Nora;
Siva created four single-use invite codes; all members joined the same
household; each stored a different personal marker; Maya explicitly shared
only `{"favorite":"board-games"}`; and no member’s private marker appeared
in the household projection. The test also confirmed five distinct user IDs
and one shared household ID.

Artifact:
`test-results/real_household_product-fiv-5fe6b-s-complete-the-product-flow/real-household-product-final.png`

Authorization outcomes from the authenticated browser contexts:

| Flow | Result |
|---|---|
| Maya booking request for VenueBook at $120 | `ASK`; decision returned by deterministic policy code |
| Maya attempting to approve her own request | rejected with HTTP 403 |
| Siva approval of Maya’s exact request | approved; spoofed approver argument ignored |
| Maya execution after Siva approval | executed; receipt created |
| Leo booking after adult approval | refused; `child members cannot execute...` |
| Nora groceries at $15 with confirmed explicit rule | `ALLOW`; executed; receipt created |
| Nora unrelated venue booking at $120 | `ASK`; unapproved execution refused |
| Receipt integrity | all returned integrity flags `true` |
| Maya logout and old session use | `/api/auth/current` returned `authenticated: false`; `/api/state` returned 401 |

The policy and approval flow used authenticated REST routes: `/api/propose`,
`/api/confirm`, `/api/check`, `/api/request-approval`, `/api/approve`,
`/api/execute`, `/api/receipts`, and `/api/preferences`. The browser did not
use fake profile switching. It performed a real same-origin MCP Streamable
HTTP flow after each authenticated household login: `initialize`,
`notifications/initialized`, and `tools/call` for `get_rules`. The test
asserted both the initialize and `get_rules` request bodies and the visible
“browser MCP verified” status. MCP was used for authenticated identity/rules
wire verification; REST remained the product surface for the action lifecycle.

Final regression results after the E2E pass:

```text
npm run build                                    PASS
.venv/bin/python -m pytest -q                   PASS; 80 collected/passed
.venv/bin/python -m pytest -q -s tests/test_bypass.py
                                                 PASS; 240 attempts, 0 bypasses
npm run test:signal                              PASS; 7 tests
npm run e2e:signal                               PASS; 1 test
npm run test:e2e:real                            PASS; 1 test, five contexts
```

The correct product claim remains: “PACT is a real local-account household
assistant with persistent sessions, invitations, private preferences,
role-aware authorization, authenticated MCP access, and deterministic
execution controls.” It is not a production identity system and does not
control real Alexa+, payments, bookings, devices, or household hardware.

## PACT Core sphere integration verification

Date: 2026-10-18. The existing Ask PACT hero now uses the supplied Stitch
Three.js sphere recipe through the reusable `frontend/src/PactCoreSphere.tsx`
component. The standalone HTML and CDN script were not imported; the geometry,
vertex gradient, nebula, particle cloud, deformation, and state colors were
adapted to the existing local Three.js dependency. It is not a standalone demo
page and does not create a second policy state machine.

Files changed for this integration:

- `frontend/src/PactCoreSphere.tsx` — Stitch-style 68-detail transparent
  wireframe sphere, violet/magenta/cyan vertex gradient, inner nebula, seeded
  340-particle halo, state-specific deformation/color response, orbit rings,
  pointer parallax, responsive `ResizeObserver`, reduced-motion handling,
  WebGL fallback, and renderer/resource cleanup.
- `frontend/src/App.tsx` — maps the existing assistant state to the sphere and
  removes the former firefly renderer from the Ask PACT hero. Browser wake
  phrase, push-to-talk, typed input, speech synthesis, policy, approval, and
  receipt flows remain unchanged.
- `frontend/src/styles.css` — sphere glow, floor reflection, state styling,
  responsive sizing, and reduced-motion fallback.
- `tests/e2e/real_household_product.spec.ts` — verifies the sphere after real
  login and observes the actual typed booking flow transition through
  `thinking` to `approval_required`.

Visual verification: PASS. The refreshed artifact shows a logged-in Siva
household user, PACT Core sphere, approval-required state, Dad’s approval card,
live policy trace, household chrome, and the existing birthday plan:

`test-results/real_household_product-fiv-5fe6b-s-complete-the-product-flow/real-household-product-final.png`

The visual state mapping is code-owned and reads the existing assistant state:

```text
ready              → idle
listening          → listening
thinking           → thinking
speaking           → speaking
approval           → approval_required
allowed            → approved, then idle
denied             → denied, then idle
```

Final integration commands:

```text
npm run build                                    PASS
.venv/bin/python -m pytest -q                   PASS; 80 passed
.venv/bin/python -m pytest -q -s tests/test_bypass.py
                                                 PASS; 240 attempts, 0 bypasses
npm run test:signal                              PASS; 7 tests
npm run e2e:signal                               PASS; 1 Playwright test
PACT_E2E_BASE_URL=http://127.0.0.1:8819 npm run test:e2e:real
                                                 PASS; 1 test, 5 contexts, 30.5 seconds
```

The sphere is a visual indicator only. It does not receive private member
preferences, make policy decisions, authorize actions, or replace the
authenticated backend/MCP identity boundary. Browser speech recognition and
speech synthesis remain dependent on Chrome/platform support; typed input
remains available as the reliable fallback.

## Minimal reference-style Ask PACT surface

The Ask PACT home view was simplified to follow the supplied Stitch reference:

- Plus Jakarta-style display typography and JetBrains Mono-style status labels
  are used through local-safe font stacks.
- Midnight navy background, cyan/violet radial ambience, compact status pills,
  and a larger centered Core glow are now the visual baseline.
- The side household rail, phone mockup, policy trace card, plan timeline,
  recommendation chips, and extra dashboard panels were removed from the home
  hero.
- Typed input, push-to-talk, transcript, demo launch, and the approval action
  remain available. Rules, Activity, Developer, Preferences, authenticated MCP,
  and all backend policy/security behavior remain unchanged.

Latest verification:

```text
npm run build                                    PASS
npx tsc --noEmit -p frontend/tsconfig.json       PASS
.venv/bin/python -m pytest -q                   PASS; 80 passed
npm run test:signal                              PASS; 7 tests
npm run e2e:signal                               PASS; 1 test
PACT_E2E_BASE_URL=http://127.0.0.1:8821 npm run test:e2e:real
                                                 PASS; 1 test, 5 contexts, 50.6 seconds
```

Refreshed artifact:
`test-results/real_household_product-fiv-5fe6b-s-complete-the-product-flow/real-household-product-final.png`

Viewport fit check: PASS at 1440×900. The complete Core, halo, and status pill
remain inside the initial viewport; transcript and voice/typed controls continue
below without changing the authenticated interaction flow.

## UI-wide style consistency

The Stitch-inspired typography and midnight glass treatment now apply to the
login screen, household onboarding, authenticated Rules/Activity/Developer
pages, and Preferences drawer. A fresh-browser check confirmed the shared
`Plus Jakarta Sans`, `Inter`, and system fallback stack on login, Rules, and
Preferences. The large question headline was replaced with the shorter
orientation line: “Speak naturally. PACT checks the boundary.”

The exact reference fonts are bundled locally through
`@fontsource-variable/plus-jakarta-sans` and
`@fontsource-variable/jetbrains-mono`; no external font request is required.

The final Core-only hero check places the three status badges at the visual
corners, removes the large headline, `PACT CORE · VOICE-FIRST` eyebrow, and
visible live-caption lines, and keeps the transcript as an accessible live
region. The sphere remains the primary hero interaction.

