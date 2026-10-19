# PACT independent final verification

Date: 2026-10-18  
Repository: `/Users/sivasuryachandran/Documents/HCK/Pact`  
Scope: verification only. No production code, commits, pushes, or
`PACT_FINAL_STRESS_TEST.md` changes were made in this pass.

## Verdict

The deterministic policy core, signed enforcement, role checks, approval
invalidation, budget concurrency controls, MCP transport binding, and real
Bedrock compiler path passed independent verification.

Two limitations remain and are not being represented as passes:

1. The settings payload exposes seeded preference data for all household
   members, so this is not a strict “read only your own preferences” boundary.
   Profile updates are correctly keyed to the authenticated member.
2. The browser UI calls local `/api` routes rather than `/mcp`. MCP was verified
   independently with the official Streamable HTTP client. The browser Maya
   flow visibly demonstrates plan → approval → denial; execution and receipt
   integrity were verified through the API/service tests, not claimed as a
   browser MCP flow.

## Initial repository inspection

Commands:

```text
git status --short
git log --oneline -10
git diff --stat
```

The worktree already contained user changes in `HANDOFF.md`, `README.md`,
identity/security modules, reports, screenshots, and UI/server files. Those
changes were preserved. The requested Playwright e2e command refreshed the
existing tracked screenshot artifacts; this pass added only this report as a
new file and made no source changes.

The requested stress-test specification remained untouched.

## Exact command results

| Command | Result |
|---|---|
| `npm install` | PASS — up to date; 119 packages audited; 0 vulnerabilities. npm printed install-script approval warnings only. |
| `npm run build` | PASS — signal ESM/CJS/DTS and Vite UI builds completed. Vite emitted only the existing large-chunk warning. |
| `.venv/bin/python -m pytest -q` | PASS — 74 passed. |
| `.venv/bin/python -m pytest -q -s tests/test_bypass.py` | PASS — 1 test; 240 adversarial attempts; 0 bypasses. |
| `npm run test:signal` | PASS — 1 file, 7 tests. |
| `npm run e2e:signal` | PASS — 1 Playwright test. |
| `PACT_MCP_ENDPOINT=http://127.0.0.1:8799/mcp .venv/bin/python scripts/mcp_smoke.py` | PASS — 8 tools, structured output true. |
| `.venv/bin/python -m pytest -q tests/test_policy.py tests/test_tokens.py tests/test_private_surface.py tests/test_executor.py tests/test_identity_security.py` | PASS — 21 passed. |

Bypass output:

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

No denied or unapproved action executed in the bypass suite or the
independent concurrency probes.

## Five-account session matrix

The fresh server was started on port 8799 with a new temporary SQLite path and
Bedrock disabled for deterministic local API/UI verification:

```bash
env PACT_PORT=8799 \
  PACT_ALLOWED_ORIGINS=http://127.0.0.1:8799 \
  PACT_BEDROCK_ENABLED=0 \
  PACT_SQLITE_PATH=/tmp/pact-final-verification-20261018.sqlite3 \
  .venv/bin/python -m pact.server
```

Each account used a separate `httpx` cookie jar and a fresh server-issued
`PACT_SESSION_ID`.

| Account | Role | Account role | Approval | Rule administration | Private access | Session result |
|---|---|---|---:|---:|---:|---|
| Siva | adult | owner | yes | yes | yes | PASS; distinct server session |
| Anika | adult | co-parent | yes | no | yes | PASS; distinct server session |
| Maya | teen | teen | no | no | no | PASS; distinct server session |
| Leo | child | child | no | no | no | PASS; distinct server session |
| Nora | caregiver | caregiver | no | no | no | PASS; distinct server session |

Independent results:

- Five session IDs were distinct.
- Each member’s profile update was stored under the authenticated member.
- Spoofing `member_id` in a settings update did not update another member.
- A confirmed household rule was visible to all five members of the same
  `demo-household`.
- Maya could request an action and create an approval request, but could not
  confirm rules or approve actions.
- Leo could not approve or execute a restricted paid action, even after Siva
  approved the exact request.
- Nora explicitly allowed for groceries under $20: decision `allow` and mock
  execution succeeded. Nora’s unrelated booking received `ask` and did not
  execute.
- Siva approved a Siva-targeted request; Anika approved a separate request
  whose rule explicitly named Anika as approver.
- Private receipts were hidden from Nora.
- A cross-session decision token and a cross-household decision token were
  both rejected.
- Spoofed `created_by`, `confirmer`, `approver`, `member_id`, `session_id`,
  and `actor_role` values did not override authenticated context.
- Logout revoked the old session and its associated token. Reusing the old
  cookies fell back to a new auto-demo context and the old token failed.

### Preference privacy limitation

The backend profile write path passed the ownership test, but the current
`/api/settings` response includes the household `members` list with each
member’s seeded `preferences`. Anika could therefore read Siva’s seeded
preference fields. This is a FAIL for strict per-member preference read
privacy, not a credential/session failure. It should be fixed before making a
claim that preferences are private to each member.

### Household boundary limitation

The public seeded login endpoint always issues the fixed `demo-household`.
Cross-household isolation was independently verified with two `PactService`
instances and distinct household IDs: a token from household A failed in
household B. The public demo does not provide a second household login.

## Approval, token, and concurrency verification

Independent service probes passed:

| Probe | Result |
|---|---|
| Revoked approval token | PASS — execution rejected |
| Expired approval token | PASS — execution rejected |
| Superseded approval token | PASS — old token rejected; newest approval token executed once |
| Cross-session token | PASS — rejected by exact session/action binding |
| Cross-household token | PASS — rejected by household binding |
| Two concurrent cumulative-budget executions | PASS — exactly 1 executed; budget was not exceeded |
| Two concurrent executions of one exact token | PASS — exactly 1 executed receipt |
| Receipt integrity | PASS — all returned integrity flags true |
| Policy precedence/invalid/high-risk/private tests | PASS — included in the 21 targeted tests and full suite |

The deterministic policy engine, not Bedrock, returned the allow/ask/deny
decision in every action check. Bedrock only returned candidate rule data.

## MCP identity verification

Fresh endpoint:

```text
http://127.0.0.1:8799/mcp
```

Observed values:

```text
MCP SDK: 2.3.0
Negotiated protocol: 2025-11-25
Latest SDK-supported protocol: 2026-07-28
Tools: get_rules, propose_rule, confirm_rule, check_action,
       request_approval, approve, execute_action, get_receipts
Structured get_rules output: true
```

An authenticated Maya MCP transport returned Maya as the caller. Supplying
`created_by: siva` to `propose_rule` still produced a rule created by Maya.
Changing the `X-PACT-Session` header after transport initialization produced
an MCP tool error (`MCP session identity cannot be changed`); the transport did
not switch to Anika. A no-header transport received its own isolated simulated
Siva demo context.

The browser source contains `/api` fetches and no `/mcp`, `tools/call`, or
Streamable HTTP client. Therefore the browser is not being claimed as an MCP
client. MCP is verified through the smoke script and independent MCP client
probes.

## Demo-login authentication status

`POST /api/demo-login` accepts only a seeded `member_id`; it does not require a
password, PIN, OAuth credential, or other actual credential. It issues a
server-side HttpOnly demo session and is explicitly labeled in the API and
README as seeded demo authentication. This is not production authentication
and must not be described as identity verification.

## Browser UI verification

A fresh headless Chrome run against port 8799 verified:

- the visible “SIMULATED ALEXA+ ADD-ON EXPERIENCE” label;
- all five seeded names and roles in Settings;
- typed fallback input with placeholder `Typed input remains ready…`;
- Maya flow: plan under $150 → VenueBook asks for Dad → approval card appears
  with “Maya wants to book Funzone for $120.” → Dad approval → GiftCart is
  denied because the plan would exceed budget;
- visible `check_action`, decision/approval, execute/receipt trace labels;
- no browser console errors in the run.

The seeded preference values were not visibly populated in the Settings
interest fields, so “preferences are visibly different” is NOT VERIFIED in the
current UI. The backend does expose distinct seeded preferences, but that is
not a substitute for the requested visual claim.

The browser flow visibly demonstrates approval and denial. Actual mock
execution, receipt creation, receipt integrity, and duplicate-execution
protection were verified through the API/service probes above; the browser was
not treated as an MCP wire client.

## Bedrock verification

AWS discovery was performed without printing credential values:

- available profiles: `Siva Surya Chandran`, `siva-surya-chandran`, `pact`;
- configured `pact` region: `us-west-2`;
- `amazon.nova-lite-v1:0` was present in the regional Bedrock catalog with
  text input/output and `ON_DEMAND`/`INFERENCE_PROFILE` support.

Real compiler invocation:

```bash
AWS_PROFILE=pact \
AWS_EC2_METADATA_DISABLED=true \
PACT_AWS_REGION=us-west-2 \
PACT_BEDROCK_ENABLED=1 \
PACT_BEDROCK_MODEL_ID=amazon.nova-lite-v1:0 \
.venv/bin/python <Bedrock compiler smoke>
```

Observed result:

```text
status: available=true
model: amazon.nova-lite-v1:0
region: us-west-2
candidate: PASS; compiler=bedrock; status=candidate
candidate rule: booking / ask / amount_gt_cents=10000 / USD / confirmed=false
read-back: Ask me before booking anything over $100.
candidate latency: 1042.2 ms
clarification: PASS; status=clarification; compiler=bedrock
clarification latency: 576.6 ms
failure_count: 0
```

The compiler returned valid rule JSON and read-back text for the clear phrase,
and clarification text for the ambiguous phrase. The service’s deterministic
preflight, schema validation, confirmation gate, policy engine, and executor
remain authoritative. If Bedrock is disabled or unavailable, the documented
deterministic fallback remains available; no fallback was needed in this real
probe. No AWS credentials were printed, logged, or saved.

## Reproduction commands

From the repository root:

```bash
npm install
npm run build
.venv/bin/python -m pytest -q
.venv/bin/python -m pytest -q -s tests/test_bypass.py
npm run test:signal
npm run e2e:signal
.venv/bin/python scripts/mcp_smoke.py
```

For a fresh local server and fresh MCP smoke:

```bash
env PACT_PORT=8799 \
  PACT_ALLOWED_ORIGINS=http://127.0.0.1:8799 \
  PACT_BEDROCK_ENABLED=0 \
  PACT_SQLITE_PATH=/tmp/pact-final-verification-20261018.sqlite3 \
  .venv/bin/python -m pact.server

PACT_MCP_ENDPOINT=http://127.0.0.1:8799/mcp \
  .venv/bin/python scripts/mcp_smoke.py
```

For real Bedrock, use the profile/environment credential chain without
printing its values:

```bash
AWS_PROFILE=pact \
AWS_EC2_METADATA_DISABLED=true \
PACT_AWS_REGION=us-west-2 \
PACT_BEDROCK_ENABLED=1 \
PACT_BEDROCK_MODEL_ID=amazon.nova-lite-v1:0 \
.venv/bin/python -m pact.server
```

## Remaining limitations

- `/api/demo-login` is seeded demo authentication, not credential-backed
  identity verification.
- The browser uses `/api`, not MCP wire calls.
- Preference reads are not currently private per member in the settings
  payload; profile writes are member-bound.
- Preference values are not visibly populated in the current Settings UI.
- Browser speech recognition and speech synthesis depend on Chrome/platform
  support; this pass verified the typed browser flow, not live microphone audio.
- All purchases, bookings, devices, add-ons, and receipts remain simulated;
  there is no Alexa+ integration, real payment, booking, hardware, or
  production Amazon control.
- Cross-household testing uses direct service fixtures because the seeded demo
  login exposes one household only.

