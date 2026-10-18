# PACT

PACT is a simulated Alexa+ household policy gateway: the model proposes a
rule, the household confirms it, deterministic code decides, the executor
verifies an exact signed token, and a tamper-evident demo receipt remembers the
attempt.

This is a hackathon prototype. It uses fake household members and mock
VenueBook/GiftCart add-ons. It has no Alexa+ partner access, real payments,
bookings, hardware, Fire TV, smart-home control, biometric identity, or
production Amazon integration.

## Run locally

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
cp .env.example .env                 # optional; never put credentials in it
PACT_BEDROCK_ENABLED=0 .venv/bin/python -m pact.server
```

Open <http://127.0.0.1:8787>. Health is <http://127.0.0.1:8787/health> and
the MCP Streamable HTTP endpoint is <http://127.0.0.1:8787/mcp>.

## Premium UI and pact-signal

The React/Vite/Tailwind/Motion source lives in `frontend/` and builds into the
existing Python server's `web/` directory. `pact-signal/` is the local typed
three.js particle renderer used by the PACT Core firefly; it is not fetched from
an external CDN or npm at runtime.

```bash
npm install
npm run build              # build pact-signal, then build frontend into web/
npm run test:signal        # renderer-free Vitest tests
npm run e2e:signal         # Playwright demo states, flight, morphs, screenshots
```

The local demo screenshots, performance measurements, and browser verification
are in [reports/ui-verification.md](reports/ui-verification.md) and
`pact-signal/reports/`. The Stitch MCP connector was not available in the
implementation session, so no Stitch response or supplied API key was used.

The browser experience uses a cryptographically random HttpOnly sandbox cookie
and SQLite state (`PACT_SQLITE_PATH`, default `pact-data.sqlite3`). Rules,
plans, approvals, receipts, conversations, and trust history are isolated per
sandbox. **Reset sandbox** deletes the current demo state and starts clean.

## Real Bedrock

Use the normal AWS SDK profile/environment credential chain. The overnight
verification used the requested profile, region, and model:

```bash
AWS_PROFILE=pact \
AWS_EC2_METADATA_DISABLED=true \
PACT_AWS_REGION=us-west-2 \
PACT_BEDROCK_ENABLED=1 \
PACT_BEDROCK_MODEL_ID=amazon.nova-lite-v1:0 \
.venv/bin/python -m pact.server
```

Observed real status: `amazon.nova-lite-v1:0` in `us-west-2`, candidate
proposal `compiler=bedrock`, valid rule JSON, read-back, and failure count 0.
The application never prints or logs credential values. If Bedrock is disabled,
unavailable, or a per-sandbox daily call/token cap is reached, PACT uses a
clearly labeled deterministic fallback (`deterministic-cap-fallback`) and
exposes the reason in `/api/status`.

The compiler uses Bedrock Converse with explicit `maxTokens` and adaptive SDK
retries. Obvious empty or policy-changing input is rejected by a deterministic
preflight guard; valid natural language remains model-proposed data only.

## Voice-first demo

Use Chrome for browser speech recognition. Press **Push to talk** to request
microphone access; PACT speaks responses with the browser’s neutral system
voice. Mute, stop speaking, replay, and typed fallback controls are available.
If recognition is unsupported, the page says so and typed commands remain fully
usable.

The voice centerpiece is a PACT-native **PACT Core** sphere with idle,
listening, thinking, speaking, approval-required, approved, and denied states.
It uses CSS/HTML radial light, glass depth, a floor reflection, and a speaking
waveform only; it does not imitate Alexa’s voice or use Amazon/Echo branding or
copied assets.

The **Run Maya Demo** button replays:

1. “Plan Maya’s birthday under $150.”
2. “Book Funzone.” → VenueBook returns `ask` for $120.
3. “Dad: Approve.” → the exact request is approved and held.
4. “Add the decorations.” → GiftCart returns `deny` because exposure would be $160.

The three simulated surfaces are Living Room shared screen, Dad’s private
phone, and Maya’s tablet. Shared surfaces receive only safe summaries for
protected content: “That’s private.”

## Tests

```bash
caffeinate -dimsu .venv/bin/pytest -ra
caffeinate -dimsu .venv/bin/pytest -q -s tests/test_bypass.py
.venv/bin/python scripts/mcp_smoke.py
```

Current local evidence:

```text
pytest: 23 passed
legitimate decisions: allow 1, approval-required 1, deny 1
adversarial suite: 240 attempts, 0 bypasses, 0 unauthorized executions
MCP SDK: 2.3.0
negotiated protocol: 2025-11-25
```

The suite covers compiler phrasings, confirmation, precedence, fail-safe
defaults, private surfaces, HMAC tampering/expiry/replay, exact approval
binding, concurrent one-time execution, SQLite isolation, plan budgets,
synthetic Policy Preview, MCP tool registration, and the 240-attempt bypass
suite. The executor refuses every missing, forged, expired, replayed,
parameter-modified, stale, denied, or unapproved token.

## MCP surface

The official Python MCP SDK exposes exactly these tools: `get_rules`,
`propose_rule`, `confirm_rule`, `check_action`, `request_approval`, `approve`,
`execute_action`, and `get_receipts`. The server uses Streamable HTTP at
`/mcp`, validates local origins, and does not expose arbitrary-code execution.
The trace shown in the UI is explicitly labeled a local PACT tool trace, not an
MCP wire trace.

## Security boundary

Bedrock/LLM output is a candidate rule only. Schema validation, confirmation,
rule precedence (`deny > ask > allow` with equal-specificity conflicts failing
safe to ask), plan budget enforcement, canonical action hashing, HMAC signing,
sandbox binding, policy-version binding, expiry, nonce replay protection,
approval binding, TOCTOU re-checks, mock execution, and receipt integrity all
happen outside the model.

## Container and deployment

`Dockerfile` and `.dockerignore` are included. Docker Desktop 29.8.0 built and
ran the image locally; `/health`, the UI, and container MCP smoke passed. See
[reports/deployment-status.md](reports/deployment-status.md) for the public
HTTPS blocker and exact commands.

Strands is `NOT RUN` because its Python package is unavailable in `.venv`.
AgentCore is `NOT RUN` because the CLI is unavailable and no resource was
created. The deterministic planner remains the honest fallback.

Voice QA is documented in [reports/voice-qa.md](reports/voice-qa.md). Chrome
155.0.8059.80 is installed and the UI wiring is present, but live microphone
capture and audible speech were not independently verified by this
non-interactive runner.

## Submission artifacts

- [reports/security-results.md](reports/security-results.md)
- [reports/mcp-bedrock.md](reports/mcp-bedrock.md)
- [reports/overnight-status.md](reports/overnight-status.md)
- [reports/deployment-status.md](reports/deployment-status.md)
- [reports/product-feedback.md](reports/product-feedback.md)
- [reports/friction-log.md](reports/friction-log.md)
- [demo/final-story.md](demo/final-story.md)
- [demo/demo-script.md](demo/demo-script.md)

See [PACT_FINAL_STRESS_TEST.md](PACT_FINAL_STRESS_TEST.md) for the source of
truth. It was not modified.
