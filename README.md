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

## Setup after cloning

You must provide your own credentials. None are included in this repository, and
PACT runs fully without any of them (local mode).

```bash
git clone https://github.com/sivasuryachandran/pact.git && cd pact
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
npm install && npm run build                 # builds the UI into web/
cp .env.example .env                         # then edit .env with YOUR values
set -a; source .env; set +a                  # the server reads environment variables, not .env itself
.venv/bin/python -m pact.server              # http://127.0.0.1:8787
```

`.env` is git-ignored. Never paste keys into source files, issues or chat.

| Provider | Purpose | Required | Fallback |
|---|---|---|---|
| Bedrock | Rule compilation | Recommended | Deterministic compiler |
| Qloo | Personalization | Optional | Local recommendations |
| NVIDIA Nemotron | Comparison only | Optional | No comparison mode |
| AWS credentials | Bedrock access | Optional for fallback mode | Local mode |

### Amazon Bedrock
Configure AWS credentials with the normal SDK chain (for example `aws configure --profile pact`
or SSO), then set `AWS_PROFILE`, `PACT_AWS_REGION` (for example `us-west-2`),
`PACT_BEDROCK_ENABLED=1` and `PACT_BEDROCK_MODEL_ID` (for example `amazon.nova-lite-v1:0`) and
make sure the model is enabled for your account in that Region. Bedrock only compiles rule wording; it
never decides policy.

### Qloo (optional)
Get a key from Qloo and set `QLOO_API_KEY`. Qloo ranks movies, music, restaurants and activities only.
It is never used for authentication, policy, approvals, time or facts. The client uses `GET /search` to resolve a seed taste and `GET /v2/insights` with `signal.interests.entities`
(host `https://hackathon.api.qloo.com`, header `X-Api-Key`), as verified in the Qrowd project's live spike for brand and
artist types. Movie, music and place types were then checked live (places use `filter.location.query` for the city). For another host set `QLOO_API_BASE_URL`. Without a key, on a timeout or on an invalid response, PACT
shows **Demo recommendations** from a built-in local list.

### Activity recommendations (location-aware)

PACT supports location-aware activity recommendations through Qloo. The first live validation used amusement parks, but amusement parks are only one supported category—not the definition of activities. The integration is designed to support museums, parks, zoos, theaters, bowling, golf, concerts, escape rooms, classes, family attractions, and other verified Qloo categories. Each category must be validated against the live API before being described as supported.

Ask for a category ("museums near me") or leave it open ("what is there to do near me?"), which searches a mixed set
(museums, parks, theaters, bowling, outdoor recreation, amusement parks). An unverified category such as cooking
classes never guesses a tag: PACT says it can't verify it yet and shows **Demo recommendations**.

Live check against the Qloo hackathon API, location "San Jose" (one request per tag, `take=10`, one shared seed
taste; "located" = at least two thirds of results are in the Bay Area):

| Category | Qloo tag | San Jose live status | Example results |
|---|---|---|---|
| Museums | `urn:tag:category:place:museum` | VERIFIED LIVE | Winchester Mystery House; Rosicrucian Egyptian Museum; San Jose Museum of Quilts & Textiles |
| Parks | `urn:tag:category:place:park` | VERIFIED LIVE | Monopoly in the Park; Calero County Park; Alviso Marina County Park |
| Zoos | `urn:tag:category:place:zoo` | VERIFIED LIVE (1 result) | Happy Hollow Park & Zoo |
| Theaters (performing arts) | `urn:tag:category:place:performing_arts_theater` | VERIFIED LIVE | San Jose Center for the Performing Arts; Montgomery Theater; San Jose Stage |
| Movie theaters | `urn:tag:category:place:movie_theater` | VERIFIED LIVE (mixed quality: returns malls) | Westfield Valley Fair; Eastridge Center; AMC Saratoga 14 |
| Bowling | `urn:tag:category:place:bowling_alley` | VERIFIED LIVE | 4th Street Bowl; San Pedro Social; Bowlmor Cupertino |
| Golf | `urn:tag:category:place:golf_course` | VERIFIED LIVE | Topgolf; Boulder Ridge Golf Club; Los Lagos Golf Course |
| Concerts (concert hall) | `urn:tag:category:place:concert_hall` | VERIFIED LIVE (1 result) | San Jose Center for the Performing Arts |
| Music venues | `urn:tag:setting:qloo:music_venue` | NOT VERIFIED (a setting tag, not a place category; 1 result) | PETE BE Center |
| Escape rooms | `urn:tag:category:place:escape_room_center` | VERIFIED LIVE (1 result) | Beat The Lock Escape Room |
| Tourist attractions | `urn:tag:category:place:tourist_attraction` | VERIFIED LIVE (not family-specific; returned a casino) | Casino M8trix; Winchester Mystery House; Monopoly in the Park |
| Family attractions | none | NOT VERIFIED (no family-specific tag tested) | none |
| Art studios | `urn:tag:category:place:art_studio` | VERIFIED LIVE (1 result) | MACLA/Movimiento de Arte y Cultura Latino Americana |
| Classes (cooking) | `urn:tag:category:place:cooking_class` | NOT VERIFIED (0 results) | none |
| Workshops | `urn:tag:category:place:workshop` | NOT VERIFIED (0 results) | none |
| Outdoor recreation (hiking areas) | `urn:tag:category:place:hiking_area` | VERIFIED LIVE | Calero County Park; Alviso Marina County Park; Rancho Cañada del Oro Open Space Preserve |
| Nature preserves | `urn:tag:category:place:nature_preserve` | VERIFIED LIVE (1 result) | Rancho Cañada del Oro Open Space Preserve |
| Aquariums | `urn:tag:category:place:aquarium` | NOT VERIFIED (0 results) | none |
| Playgrounds | `urn:tag:category:place:playground` | VERIFIED LIVE (1 result) | Rotary PlayGarden |
| Amusement parks | `urn:tag:category:place:amusement_park` | VERIFIED LIVE | California's Great America; Happy Hollow Park & Zoo; Golfland San Jose |
| Any category when Qloo is off, keyless or failing | n/a | DEMO FALLBACK | Funzone Arcade; Riverside Mini Golf; City Science Museum |

Results are live samples from one run, not a guarantee; Qloo data changes. Only VERIFIED LIVE categories are enabled in code.

Qloo only provides optional personalization. Qloo never makes allow/ask/deny decisions. PACT policy enforcement
always runs after recommendations: "Book this for us" calls the same `check_action` path as any other booking.
QROWD code, data, scoring, and catalog are not used by PACT. The only thing carried over is the checked-in knowledge
of which Qloo endpoints and parameters work.

### NVIDIA Nemotron (optional, comparison only)
Set `NVIDIA_API_KEY`, `NVIDIA_MODEL_ID` and (if needed) `NVIDIA_API_BASE_URL` (an OpenAI-compatible
endpoint; the default is NVIDIA's hosted API). Nemotron is an NVIDIA model, not an Amazon model. It can answer a
question you send to `POST /api/compare` for side-by-side reading and is never part of any PACT decision.

### Privacy and data flow
- Settings (name, location, timezone, language, toggles) are stored in your browser session's local SQLite sandbox only.
- "What time is it?" is answered from your saved timezone, locally. No provider is involved.
- Qloo receives recommendation context only: a category (and your city for places). Coordinates are sent
  only if you turn on "Share coordinates". It never receives PACT rules, approvals, tokens or receipts.
- Bedrock receives the rule wording you type. Nemotron receives only what you explicitly send to compare.
- Location is never read from your device unless you press "Use my location" and allow the browser prompt.
- Keys are read from the environment, never returned by the API, shown in the UI or written to logs.

### Demo account limits
The Settings "Demo account" is a name stored in a local sandbox session. It is not production
authentication: there are no passwords, no verified identity, and signing out simply gives the browser a
fresh sandbox. Do not enter real personal data.

### Fallback behavior
No Bedrock credentials: deterministic compiler. No Qloo key or Qloo error: Demo recommendations. No NVIDIA key: no
comparison mode. Missing location or timezone: PACT asks once, then points to Settings. The UI shows which source
answered: Bedrock, Qloo, Demo recommendations, Local demo or NVIDIA Nemotron comparison.

### Troubleshooting
- `/api/status` or Settings shows **Demo mode** for Bedrock: check `PACT_BEDROCK_ENABLED=1`, the profile, Region and model access.
- Qloo shows **Demo mode**: the key is missing or failed; press *Test connection* in Settings for the reason (never the key).
- Browser gets 403 on assets or API: the origin guard only allows `127.0.0.1:8787`/`:3000`; add others with `PACT_ALLOWED_ORIGINS`.
- Voice does nothing: use Chrome, allow the microphone, and check Voice is on in Settings. Typed input always works.

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
