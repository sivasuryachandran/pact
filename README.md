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

The browser experience uses local account authentication with scrypt password
hashes, persistent hashed sessions, HttpOnly SameSite cookies, a CSRF
double-submit token for browser writes, and SQLite state
(`PACT_SQLITE_PATH`, default `pact-data.sqlite3`). Rules, plans, approvals,
receipts, conversations, memberships, invites, and trust history survive a
process restart. The normal product path is registration → household creation
or invite join → authenticated assistant use.

**Reset sandbox** is a development convenience. It does not replace logout,
session revocation, household membership, or account deletion.

## Local account and household onboarding

The first user registers at `/api/auth/register`, signs in at
`/api/auth/login`, then creates a household at `/api/households/create`. An
owner or co-parent can create a single-use, expiring invite at
`/api/invites`; a logged-in user accepts it at `/api/invites/accept`.
`/api/auth/current` returns the authenticated user and household memberships;
`/api/auth/logout` revokes the persistent session. Passwords are never stored
in plaintext. The local account system is suitable for this hackathon, but it
is not production identity assurance: there is no email verification, recovery,
OAuth, SSO, passkeys, or MFA.

Personal preferences are returned only to the current user. A member may opt
specific shared preferences into the household projection; shared preferences
are never used as authorization input. The Settings drawer labels personal and
household-shared data separately.

## Development-only seeded demo mode

PACT includes five seeded demo members in one shared household, each with a
separate server-issued session and personal preference profile:

| Member | Role | Authorization boundary |
|---|---|---|
| Siva | adult owner | manages rules and approves actions |
| Anika | co-parent | approves permitted actions; no owner-only rule administration |
| Maya | teen | requests actions and uses only permitted allowance paths |
| Leo | child | limited requests; cannot approve or execute paid/private/device actions |
| Nora | caregiver | only explicitly allowed actions; no unrelated private receipts |

This mode is disabled by default and must be explicitly enabled with
`PACT_DEMO_MODE=1` (pytest also enables the compatibility fixture). It is
seeded demo authentication, not production OAuth, and must not be presented as
real identity verification. The normal product mode does not expose
`/api/demo-accounts`, `/api/demo-login`, or member-ID-only login.

For deterministic development/test fixtures only:

```bash
curl -c /tmp/pact-cookies.txt \
  -H 'Content-Type: application/json' \
  -d '{"member_id":"maya"}' \
  http://127.0.0.1:8787/api/demo-login
```

`/api/demo-accounts` is available only in this mode. Every API and MCP action
resolves household/member/role/session from server-side context; caller
supplied `member_id`, `created_by`, `confirmer`, or `approver` values cannot
override it. Logout revokes the server session. This compatibility mechanism
is not a claim of verified real-world identity.

For MCP, send the server-issued session as `X-PACT-Session`. If no header is
provided, a new isolated demo MCP transport session is assigned a simulated
adult context so the local smoke test remains runnable.

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

PACT supports location-aware activity recommendations through Qloo. The first live validation used amusement parks, but amusement parks are only one supported category, not the definition of activities. Qloo exposes a large, dynamic taxonomy of place categories, so the lists below are not exhaustive. API taxonomy support is not the same as useful local results: a valid tag can still return nothing, malls, hotels or casinos for a given city. Each category is therefore validated against the live API before PACT describes it as supported.

**How a search works.** PACT resolves a seed taste with `GET /search`, then calls `GET /v2/insights` with `filter.type=urn:entity:place`, `signal.interests.entities`, `filter.tags` (comma-separated tags are an OR) and **`filter.location.query=<plain city name>`**. The location parameter was re-probed live: `filter.location.query` (and `filter.location` with a point and radius) restricts results to San Jose and nearby cities, while `signal.location.query` and `signal.location` do not (they returned New York, Las Vegas and others). The city must be plain: "San Jose, CA" returns zero results, so PACT strips the state.

**Public categories** (what people see; raw tag ids are never shown): Museums & culture, Parks & outdoors, Sports & games, Family activities, Movies & theaters, Classes & workshops. Each group searches only its VERIFIED tags. With no category, PACT searches a reliable mix (museums, theaters, parks, hiking, bowling, golf), never amusement parks alone. THIN categories (zoos, playgrounds, escape rooms, art studios and galleries, nature preserves, concerts) work only when asked for explicitly and PACT says local availability is limited. Hidden categories (Live events, tourist attractions, cooking classes, workshops, pottery, aquariums, trail heads) answer: "I couldn’t verify enough nearby results for that category. Try another activity type or enable demo recommendations." and show Demo recommendations.

Quality filter: results whose own category tags show a mall, department or clothing store, casino or hotel are dropped unless that is the category being searched. This is what makes Movies & theaters usable.

Classification: VERIFIED = at least 3 relevant local results; THIN = 1 or 2; IRRELEVANT = results include malls, hotels, casinos or unrelated places; NOT VERIFIED = no usable result or tag not confirmed. Live run on 2026-10-18, location "San Jose", `take=10`:

| Category tested | Public group | Qloo tag | San Jose result | First results |
|---|---|---|---|---|
| museums | Museums & culture | `urn:tag:category:place:museum` | VERIFIED: 4 relevant | Winchester Mystery House; Rosicrucian Egyptian Museum; San Jose Museum of Quilts & Textiles |
| art studios | Museums & culture | `urn:tag:category:place:art_studio` | THIN: 1 result | MACLA/Movimiento de Arte y Cultura Latino Americana |
| art galleries | Museums & culture | `urn:tag:category:place:art_gallery` | THIN: 2 results | Empire Seven Studios; MACLA/Movimiento de Arte y Cultura Latino Americana |
| theaters | Museums & culture | `urn:tag:category:place:performing_arts_theater` | VERIFIED: 6 relevant | San Jose Center for the Performing Arts; Montgomery Theater; San Jose Stage |
| theaters (alt) | Museums & culture | `urn:tag:category:place:performing_arts` | NOT VERIFIED: 0 results (performing_arts tag) | none |
| movie theaters | Movies & theaters | `urn:tag:category:place:movie_theater` | VERIFIED with quality filter: 7 raw, 2 malls removed, 5 cinemas; raw result set was IRRELEVANT | Pruneyard Cinemas; AMC Saratoga 14; Cinemark CinéArts Santana Row (malls Westfield Valley Fair and Eastridge Center filtered out) |
| parks | Parks & outdoors | `urn:tag:category:place:park` | VERIFIED: 10 relevant | Monopoly in the Park; Calero County Park; Alviso Marina County Park |
| nature preserves | Parks & outdoors | `urn:tag:category:place:nature_preserve` | THIN: 1 result | Rancho Cañada del Oro Open Space Preserve |
| hiking | Parks & outdoors | `urn:tag:category:place:hiking_area` | VERIFIED: 3 relevant | Calero County Park; Alviso Marina County Park; Rancho Cañada del Oro Open Space Preserve |
| trail heads | Parks & outdoors | `urn:tag:category:place:trail_head` | NOT VERIFIED: 0 results | none |
| bowling | Sports & games | `urn:tag:category:place:bowling_alley` | VERIFIED: 6 relevant | 4th Street Bowl; San Pedro Social; Bowlmor Cupertino |
| golf | Sports & games | `urn:tag:category:place:golf_course` | VERIFIED: 9 relevant | Topgolf; Boulder Ridge Golf Club; Los Lagos Golf Course |
| escape rooms | Sports & games | `urn:tag:category:place:escape_room_center` | THIN: 1 result | Beat The Lock Escape Room |
| zoos | Family activities | `urn:tag:category:place:zoo` | THIN: 1 result | Happy Hollow Park & Zoo |
| playgrounds | Family activities | `urn:tag:category:place:playground` | THIN: 1 result | Rotary PlayGarden |
| amusement parks | Family activities | `urn:tag:category:place:amusement_park` | VERIFIED: 3 relevant | California's Great America; Happy Hollow Park & Zoo; Golfland San Jose |
| aquariums | Family activities | `urn:tag:category:place:aquarium` | NOT VERIFIED: 0 results | none |
| concerts | Live events | `urn:tag:category:place:concert_hall` | THIN: 1 result | San Jose Center for the Performing Arts |
| music venues | Live events | `urn:tag:category:place:live_music_venue` | IRRELEVANT: 10 results were bars, restaurants and a market | ENSO Bar & Nightclub; Tessora's Barra di Vino.. As of Jan 16, 2025 Tessoras is under new management; San Pedro Square Market |
| cooking classes | Classes & workshops | `urn:tag:category:place:cooking_class` | NOT VERIFIED: 0 results | none |
| workshops | Classes & workshops | `urn:tag:category:place:workshop` | NOT VERIFIED: 0 results | none |
| pottery classes | Classes & workshops | `urn:tag:category:place:pottery_classes` | NOT VERIFIED: 0 results | none |
| dance schools | Classes & workshops | `urn:tag:category:place:dance_school` | VERIFIED: 3 relevant | On One Studios; Purdance; Nor Cal Dance Arts |
| craft | Classes & workshops | `urn:tag:category:place:craft` | NOT VERIFIED: 0 results | none |
| tourist attractions | Attractions | `urn:tag:category:place:tourist_attraction` | IRRELEVANT: 10 results included a casino | Casino M8trix; Winchester Mystery House; Monopoly in the Park |

Notes: "Classes & workshops" currently means dance schools only (cooking classes, workshops, pottery and craft returned nothing; yoga and martial arts returned gyms and a school and were not adopted). Results are one live sample, not a guarantee; Qloo data changes, so re-validate a category (and the other cities you care about) before relying on it. Other cities were not tested.

The UI shows category chips only for groups with VERIFIED results (Museums & culture, Parks & outdoors, Sports & games, Family activities, Classes & workshops; Live events stays hidden). Each result shows the category searched, the location searched, **Qloo-powered** or **Demo recommendation**, a "Limited local results" note when applicable, and, if you then ask to book, the PACT policy decision.

Qloo is only a personalization and recommendation provider. Qloo never decides allow, ask or deny, and PACT policy enforcement always runs after a recommendation ("Book this for us" calls the same `check_action` path as any other booking). QROWD is a separate, unrelated project: no QROWD code, data, scoring or catalog is used by PACT.

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
Demo sessions are server-issued and role-enforced, but they are not production
authentication: there are no passwords, no verified identity, no OAuth, and no
external identity provider. Do not enter real personal data.

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

The identity/security regression suite covers five independent sessions,
profile isolation, role denial, cross-session and cross-household token
failures, logout invalidation, approval revocation, concurrent approval
supersession, and cumulative budget enforcement. The latest run passed 74 Python tests, 240 adversarial
attempts with 0 bypasses, and 7 signal tests.

Current local evidence:

```text
pytest: 74 passed
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
