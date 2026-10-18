# PACT Handoff

Date: 2026-10-17
Workspace: `/Users/sivasuryachandran/Documents/HCK/Pact`

## Product

PACT is a simulated Alexa+ add-on experience for a household policy gateway.
It demonstrates:

- AI-proposed rules with human confirmation;
- deterministic `allow` / `ask` / `deny` policy decisions;
- exact signed decision and approval tokens;
- amount, merchant, device, subject, and policy-version binding;
- expiry, nonce, replay, and tamper protection;
- budget enforcement;
- simulated adult, teen, and child household members;
- private/shared-screen routing;
- tamper-evident receipts;
- VenueBook and GiftCart sandbox add-ons using the same PACT contract;
- a local MCP Streamable HTTP server at `/mcp`;
- optional real Bedrock rule compilation with deterministic fallback.

This is not a real Alexa+ integration. It has no real purchases, bookings,
devices, Fire TV, smart-home controls, production Amazon access, or hardware.

## Current status

Core, UI, security, MCP, Bedrock, Docker, and Maya demo work is complete.
The latest visual pass updated the procedural `pact-signal` firefly model to
match the supplied visual reference: four dotted iridescent wings, tapered
body, warm lantern, antennae, and trailing filaments. The reference image is
not shipped as a runtime asset.

The latest browser Maya flow passed:

1. Plan Maya's birthday under $150.
2. VenueBook requests $120 and returns `ASK`.
3. Dad approves the exact request.
4. VenueBook executes and commits $120.
5. GiftCart requests $40 and returns `DENY` because exposure would be $160.

Changed-price, replayed-token, split-purchase, private-screen, and tampered
token paths fail safely.

## Important files

- `pact/`: Python policy, compiler, token, receipt, MCP, and server code.
- `frontend/src/App.tsx`: React UI and real backend API calls.
- `frontend/src/styles.css`: premium PACT UI styling.
- `pact-signal/src/index.ts`: procedural three.js signal renderer.
- `pact-signal/src/react.tsx`: React wrapper.
- `web/`: built UI served by the Python server.
- `tests/`: Python policy/compiler/security tests.
- `scripts/mcp_smoke.py`: MCP Streamable HTTP smoke test.
- `reports/`: security, Bedrock/MCP, UI, deployment, and voice reports.
- `demo/`: demo scripts and final story material.
- `.env.example`: variable names only; never add credentials.

## Local setup and run

Python:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
```

Build the UI:

```bash
npm install
npm run build
```

Run deterministic fallback mode:

```bash
PACT_BEDROCK_ENABLED=0 .venv/bin/python -m pact.server
```

Run with the configured Bedrock profile without printing credentials:

```bash
AWS_PROFILE=pact \
AWS_EC2_METADATA_DISABLED=true \
PACT_AWS_REGION=us-west-2 \
PACT_BEDROCK_ENABLED=1 \
PACT_BEDROCK_MODEL_ID=amazon.nova-lite-v1:0 \
PACT_PORT=8787 \
.venv/bin/python -m pact.server
```

Open:

- UI: `http://127.0.0.1:8787/`
- Health: `http://127.0.0.1:8787/health`
- MCP: `http://127.0.0.1:8787/mcp`

If port 8787 is already occupied, inspect the existing process before
starting another server. Do not kill unrelated processes blindly.

## Test and QA commands

```bash
npm run build
npm run test:signal
npm run e2e:signal

.venv/bin/python -m pytest -q
.venv/bin/python -m pytest -q -s tests/test_bypass.py
.venv/bin/python scripts/mcp_smoke.py
```

Latest results:

- Python tests: `23 passed`.
- Adversarial attempts: `240`.
- Legitimate allowed: `1`.
- Legitimate approval-required: `1`.
- Legitimate denied: `1`.
- Adversarial allowed: `0`.
- Adversarial asked: `120`.
- Adversarial denied: `120`.
- Unauthorized executions: `0`.
- Replay failures: `18`.
- Parameter-tamper failures: `40`.
- Bypasses: `0`.
- Signal tests: `7 passed`.
- Signal Playwright: `1 passed`, `0 console errors`.
- Generated JavaScript syntax checks: pass.
- Maya browser flow: pass, no browser errors.

## Bedrock and MCP facts

The last real Bedrock verification used:

- Profile: `pact`.
- Region: `us-west-2`.
- Model: `amazon.nova-lite-v1:0`.
- Status: available.
- Real compiler behavior: valid structured rule JSON, read-back text, and
  clarification behavior were verified.
- The deterministic policy engine still owns every allow/ask/deny decision.
- Credentials are obtained through the normal AWS SDK profile/environment
  chain and are never printed or logged.
- If Bedrock is unavailable, disabled, or capped, the adapter uses the clearly
  labeled deterministic fallback.

MCP:

- Python MCP SDK: `2.3.0`.
- Negotiated protocol: `2025-11-25`.
- Endpoint: `http://127.0.0.1:8787/mcp`.
- Tools: `get_rules`, `propose_rule`, `confirm_rule`, `check_action`,
  `request_approval`, `approve`, `execute_action`, `get_receipts`.
- Structured output from `get_rules`: verified.

## UI behavior

The UI is labeled `Simulated Alexa+ add-on experience` and distinguishes:
`AI proposes · code decides`.

It includes:

- PACT Core procedural signal with idle, listening, thinking, speaking,
  approval, allowed, denied, and private states;
- browser speech recognition/synthesis hooks;
- typed input fallback;
- visible transcript and policy trace;
- rule proposal/confirmation;
- household rulebook;
- approval card on Dad's private simulated surface;
- receipt/activity timeline;
- Maya birthday demo;
- reduced-motion and accessible status behavior.

Live microphone permission and physical audio were not independently tested
in the non-interactive runner. Typed input remains reliable.

## Docker

Build and run locally:

```bash
docker build --tag pact-simulated:submission .
docker run --rm -p 8787:8787 pact-simulated:submission
```

The rebuilt image previously passed `/health` and MCP initialize smoke checks.
There is no claimed public endpoint. Deployment remains blocked by available
AWS permissions; see `reports/deployment-status.md`.

## Known limitations and non-goals

- No public hosted endpoint is claimed.
- Strands and AgentCore were not successfully integrated or claimed.
- No live Alexa+ or Amazon partner integration exists.
- No real payment, booking, device, or smart-home action is possible.
- Speaker identity and household roles are simulated.
- Stitch MCP was unavailable in the implementation session; its pasted API
  key was not used or saved.
- Do not add DynamoDB or deployment infrastructure unless explicitly scoped
  and validated end-to-end.

## Handoff guardrails

- Read `PACT_FINAL_STRESS_TEST.md` before changing policy/security behavior.
- Preserve unrelated user changes.
- Do not weaken thresholds, delete failures, or hide bypass failures.
- Never let an LLM decide `allow`, `ask`, or `deny`.
- The executor must reject missing, forged, expired, replayed, modified,
  denied, or unapproved tokens.
- Never print, log, commit, push, or save AWS credentials or API keys.
- Do not use git commands unless the user explicitly requests them.
- If any denied or unapproved action executes, stop and report the failure.

## Firefly display (morpho butterfly)

- `frontend/src/signal/`: productionised prototype. `createSignal(container, opts)` with `wake/think/respond/idle/setSpeed/setSize/dispose`. Uses three 0.169.0 via the npm alias `three-morpho` (the older `pact-signal` package still uses three 0.186.1 and is no longer imported by the app).
- `frontend/src/screens/`: TV, Dad's phone and Maya's tablet, reachable at `/?screen=tv|phone|tablet` (add `&demo=fresh|asking|resolved` for fixed fake data, `&still` for deterministic frames).
- `decisionFromResult()` maps the engine response to the firefly; the firefly never decides.
- `node scripts/shoot-screens.mjs docs/screens` re-shoots everything and measures wingspan (needs a server; set `PACT_URL`, and `PACT_ALLOWED_ORIGINS` if the port is not 8787).
- Stitch exports (reference only): `design/stitch/`.

## Collaboration

- Repo: https://github.com/sivasuryachandran/pact (public). Work on a branch and open a PR; do not force-push `main`.
- Never commit credentials. `*accessKeys*.csv`, `.env`, `*.sqlite3` and `.venv/` are git-ignored. The AWS key file that sat in the project root was deliberately NOT pushed and should be rotated or deleted.
- Setup: see "Local setup and run" above. Build the UI with `npm install && npm run build`; the Python server serves `web/`.
- Stitch project for the display screens: `projects/10118988347216740244` (needs your own Stitch API key; keep it in your MCP config, not in the repo).
- Firefly work left: real-GPU fps check, voice wake-phrase test in Chrome, wire the phone "Deny" button.
