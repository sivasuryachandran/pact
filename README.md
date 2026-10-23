# PACT

**PACT is a household policy assistant and a simulated Alexa+ experience.** Family members discover
products and request purchases conversationally. Deterministic rules decide who may act, who must
approve, and what exact action can execute. PACT exposes the experience through a self-hosted
**MCP server (Streamable HTTP at `/mcp`)** and demonstrates it through a **real browser MCP client**.

> The model proposes, the household decides, deterministic code enforces, and every action leaves an
> inspectable receipt.

**Demo video (2:54):** <https://youtu.be/Owxk1xhRLXw>. Voices in the video are synthesized.

This is a hackathon prototype built for the Amazon Appstore Developer Hackathon (Alexa+ track, with
the AWS Builder mini-challenge in mind). It is a **simulation**: no Alexa+ partner access, no Echo
hardware, no Amazon.com ordering, no live Amazon Pay, no live bookings and no production identity
verification. See [Verified vs simulated](#verified-vs-simulated).

## The main demo: Maya's laptop

```text
Maya: "I need a laptop for Python development, 16 GB RAM minimum, under $900,
       good battery life, and strong reviews."
→ PACT parses the requirements and applies hard filters (budget, RAM)
→ compares price, availability, review evidence and fit across several laptops
→ Maya asks to buy one
→ PACT returns ASK (an adult must approve)
→ Maya cannot approve her own request
→ Siva approves the exact request from a separate authenticated session
→ the unchanged request executes once; a receipt and order status appear
→ Trust & Activity shows the MCP trace (tool names, decisions, latency, IDs, redacted arguments)
→ Leo asks for the same purchase and receives a deterministic DENY
```

Judge walkthrough: [docs/judge-quickstart.md](docs/judge-quickstart.md). Evidence: [reports/submission-readiness-final.md](reports/submission-readiness-final.md).

## What is real

- **MCP:** an official-SDK MCP server (`mcp` 2.3.0) over Streamable HTTP at `/mcp`, protocol
  **2025-11-25**. The browser UI is an actual MCP client: it performs `initialize`, `tools/list` and
  `tools/call` and shows the results. Sessions are authenticated; the MCP identity comes from the
  server-issued login session, never from tool arguments, and cannot change after `initialize`.
- **Policy:** deterministic code owns `allow` / `ask` / `deny` (`deny > ask > allow`). Approval,
  execution, exact-token binding, order state and receipts are all code-owned.
- **Bedrock:** used for **candidate rule suggestions only** (natural language → a candidate rule that a
  person must confirm). It never decides, approves or executes. With Bedrock off or unreachable, a
  deterministic compiler is used.
- **Product discovery:** a deterministic parser turns the request into hard filters (budget, RAM, ...)
  and soft preferences (battery life, reviews). Ranking and comparison come from provider data; unknown
  availability stays *unknown* and cannot be ordered; no review text is invented.
- **Accounts:** local accounts, households, role-based invites (adult, teen, child, caregiver), sessions
  with CSRF protection, per-member private preferences and memory.
- **Receipts and trace:** tamper-evident receipts with integrity verification, and a server-recorded MCP
  trace with redacted arguments (tokens and credentials are never recorded).

## Verified vs simulated

| Area | Status |
|---|---|
| MCP Streamable HTTP server, initialize / tools/list / tools/call, authenticated browser client | **Verified** by the automated flow and the official MCP SDK client |
| Policy engine, exact-token binding, approval, one-time execution, receipts | **Verified** (unit, 240-attempt bypass suite, end-to-end flow) |
| Cross-member approval (Maya requests, Siva approves from a separate session) | **Verified** (API flow and real-browser E2E) |
| Bedrock rule suggestions (`amazon.nova-lite-v1:0`, `us-west-2`) | **Verified live on 2026-10-22**; optional, needs your own AWS credentials |
| Product catalog, prices, reviews, availability | **Simulated**: the *PACT Sandbox Catalog* mock provider (fixtures, labelled as simulated) |
| Payment and order fulfillment | **Simulated**: mock provider only; no money moves |
| Amazon Pay (sandbox adapter) | **Not live-verified**; present as an optional boundary only |
| Amazon.com retail ordering, Creators API | **Not used / not verified** |
| Alexa+ partner access, Alexa/Echo hardware, Alexa Custom Skill deployment | **Not used / not verified** (an un-deployed adapter exists in `alexa/`) |
| Amazon Polly speech | **Optional / not verified end to end**; browser speech is the default |
| Public HTTPS deployment | **Not claimed**; the server runs locally or in a local Docker container |
| Production identity | **Not claimed**; local hackathon authentication only |
| Docker | Image definition included; **not run in the latest verification** (Docker daemon unavailable) |

## Alexa+ track mapping

- **Simulated Alexa+ experience:** PACT is the household layer an Alexa+ commerce experience would call
  before acting. It is labelled "Simulated Alexa+ add-on experience" everywhere and uses no Amazon or
  Alexa branding, logos or voice.
- **Self-hosted MCP:** the experience is exposed as an MCP server (`/mcp`, Streamable HTTP, 2025-11-25).
  Tools cover product discovery (`search_catalog`, `get_product`, `compare_products`,
  `get_availability`, `get_product_reviews`, `get_product_recommendation_context`), purchase
  (`create_purchase_request`, `check_action`, `request_approval`, `approve`, `execute_action`,
  `get_order_status`, `get_receipts`), rules (`get_rules`, `propose_rule`, `confirm_rule`) and memory.
  `tools/list` is the source of truth for the exact set; `scripts/mcp_sdk_check.py` prints the live count.
- **Not claimed:** partner preview access, a live Alexa device, or a public MCP endpoint.

## AWS Builder mapping

Amazon Bedrock (Converse API, `amazon.nova-lite-v1:0` in `us-west-2`) compiles a person's natural-language
rule into a **candidate** structured rule with a plain-English read-back. Code validates the schema,
a person confirms it, and only then does it become policy. Obvious policy-changing input is rejected
by a deterministic guard before the model sees it, the rule's approver is set by code (never copied from the
model), and a per-session daily call/token cap falls back to the deterministic compiler. See [Bedrock setup](#amazon-bedrock).

## Open Source

PACT is released under the [MIT License](LICENSE) (Copyright (c) 2026 Siva Surya Chandran).

For the Open Source Mini Challenge, the separate qualifying project is
[mcp-trustcheck](https://github.com/sivasuryachandran/mcp-trustcheck), an independent MIT-licensed
Python CLI, created during the hackathon, that validates Streamable HTTP MCP servers: initialization,
protocol version 2025-11-25 or later, `tools/list` schemas, configurable `tools/call`,
`structuredContent` against `outputSchema`, JSON-RPC errors, request IDs, p95 latency and
secret/token redaction. It has its own repository, tests and CI, and contains no PACT application
code. It includes a generic example of checking an MCP server such as PACT's `/mcp` endpoint. PACT's
own MIT license is not what is submitted for this challenge.

## Reproduce a clean local run

Verified with Python 3.14.7, Node v26.10.0 and npm 11.19.1 (Python 3.11+ is declared supported;
dependencies are pinned in `requirements.lock`, with `mcp==2.3.0`). No credentials are needed.

```bash
git clone https://github.com/sivasuryachandran/pact.git && cd pact
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt     # or -r requirements.lock for exact versions
npm ci && npm ci --prefix pact-signal
npm run build
PACT_BEDROCK_ENABLED=0 PACT_PAYMENT_PROVIDER=mock .venv/bin/python -m pact.server
```

Open <http://127.0.0.1:8787>, register an account, create a household, and invite members. The MCP
endpoint is <http://127.0.0.1:8787/mcp>; health is <http://127.0.0.1:8787/health>.

**Verify everything with one command** (starts a throwaway server with a temporary SQLite database,
needs no credentials, prints PASS/FAIL per step, exits nonzero on any failure):

```bash
npx playwright install chromium        # once, for the browser suites
scripts/verify_submission.sh           # VERIFY_SKIP_BROWSER=1 skips the Playwright suites
```

Docker (local only):

```bash
docker build -t pact .
docker run --rm -p 127.0.0.1:8787:8787 -e PACT_TOKEN_SECRET="$(openssl rand -hex 32)" \
  -e PACT_ALLOWED_ORIGINS=http://127.0.0.1:8787 pact
```

## Verified results (run of 2026-10-22)

Counts come from the actual runs recorded in [reports/submission-readiness-final.md](reports/submission-readiness-final.md).

| Check | Result |
|---|---|
| `npm run build` | PASS |
| `pytest` | **129 passed** (127 when the demo video was recorded; two tests were added afterwards for the Bedrock approver fix) |
| Bypass/security suite | **240 adversarial attempts, 0 bypasses, 0 unauthorized executions** |
| Laptop purchase flow over HTTP + MCP (`scripts/submission_flow.py`) | **55 of 55 steps PASS** (five accounts, five separate sessions) |
| MCP SDK client (`scripts/mcp_sdk_check.py`) | PASS: SDK 2.3.0, protocol 2025-11-25, 22 tools listed, authenticated `tools/call` |
| Signal unit tests / signal Playwright | 7 passed / 1 passed |
| Real-account browser E2E (`npm run test:e2e:real`) | **6 passed** (invites and pairing, product discovery and ordering, MCP commerce, cross-session approval, the two-session laptop demo, five-account household) |
| Bedrock (live, `amazon.nova-lite-v1:0`, `us-west-2`) | candidate rule returned with `compiler=bedrock`; a policy-override attempt returned a clarification |

---

## Reference

The sections below document individual subsystems.

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
are in `pact-signal/reports/`. The Stitch MCP connector was not available in the
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

## Simulated wallet and household permissions

The authenticated Household and Wallet pages provide the shared dashboard,
member permission view, rule builder, approval visibility, activity timeline,
and receipt history. Payment methods are explicitly simulated:

The **Trust & Activity** page connects those surfaces into one evidence view:
the latest member request, selected catalog product, amount, matched rule,
approval event, payment outcome, order status, receipt hash chain, and a
redacted MCP tool-contract trace. The browser’s marketplace purchase button
now runs the commerce lifecycle through the authenticated Streamable HTTP MCP
surface: catalog search, product lookup, deterministic policy check, approval,
execution, order status, and receipts. REST remains the product surface for
login, preferences, household management, and settings. Activity entries are
written at the MCP request boundary and include redacted arguments, the
authenticated member and household, policy result, latency, request/receipt/
order identifiers, and timestamp.

The strongest verified journey uses three isolated normal accounts: Maya is
the requester, Siva is the approver, and Leo is denied by his child role. Maya
cannot approve herself, Siva’s approval is bound to the exact product, amount,
payment method, device, and rule version, and five parameter mutations are
refused after approval. See the cross-member section in the MCP commerce
report.

```bash
PACT_PAYMENT_PROVIDER=mock .venv/bin/python -m pact.server
```

Only masked metadata is accepted and persisted: display name, brand, last four
digits, expiry, provider reference, status, and household/member assignment.
PACT rejects PAN, card number, CVV, CVC, PIN, and other raw credentials. The
mock provider remains the default and the only provider used by the local demo;
there is no PayPal integration, PayPal credential, PayPal environment variable,
or placeholder PayPal adapter. An optional Amazon Pay Sandbox Checkout Session
adapter is available only when its server-side merchant/key configuration is
complete; it never converts an open or failed external checkout into a success.
Wallet permissions become the same deterministic allow/ask/deny rules used by
every other simulated action. Ask decisions continue through
`request_approval` → `approve` → `execute_action` and produce the existing
tamper-evident receipts.

### PACT Marketplace and payment boundary

The local PACT Marketplace is a small seeded catalog for demo products. It is
not Amazon.com retail ordering. Authenticated catalog access is available at
`GET /api/catalog/search`, `GET /api/catalog/{product_id}`, and through the
MCP tools `search_catalog` and `get_product`. Product metadata is included in
the canonical signed action (`product_id`, merchant, category, amount, currency,
payment method, provider, device, and rule version), so a changed product or
price cannot reuse an approval.

The payment path is:

```text
MCP search_catalog → MCP get_product → MCP compare/availability/reviews
→ MCP create_purchase_request → MCP check_action → MCP approval if needed
→ MCP execute_action → MCP get_order_status → MCP get_receipts
→ mock payment or Amazon Pay Sandbox checkout session → verified status → receipt
```

For the optional Sandbox provider, add names only to a private environment:

```bash
PACT_PAYMENT_PROVIDER=amazon_pay_sandbox
AMAZON_PAY_ENV=sandbox
AMAZON_PAY_REGION=na
AMAZON_PAY_MERCHANT_ID=
AMAZON_PAY_PUBLIC_KEY_ID=
AMAZON_PAY_PRIVATE_KEY_PATH=
```

`GET /api/payment/status` reports configuration without exposing secrets.
Missing configuration leaves the app fail-closed for Amazon checkout; keep
`PACT_PAYMENT_PROVIDER=mock` for the reliable local demo. No Amazon Pay
Sandbox credentials were committed or printed in this repository.

### Product discovery and controlled purchase

The Wallet surface and authenticated MCP server expose a laptop discovery
vertical slice. The default provider is `PACT Sandbox Catalog`, a deterministic
local fixture with clearly simulated prices, availability, and provider-supplied
review summaries. It is not Amazon.com retail data and does not claim a real
order.

```text
natural request → structured requirements → hard filters
→ deterministic fit score/evidence → compare/select
→ re-fetch price, availability, revision, quantity, shipping
→ check_action → adult approval → exact mock order → receipt
```

Discovery tools are `search_catalog`, `get_product`, `compare_products`,
`get_availability`, `get_product_reviews`,
`get_product_recommendation_context`, and `create_purchase_request`. The
existing authorization tools remain the only authority for `allow`, `ask`, and
`deny`. The signed action binds the authenticated requester, household,
product/provider/revision, quantity, price/currency, shipping option, masked
payment method, device, and policy version. Changing any of those values makes
the prior decision or approval unusable.

The verified local configuration is:

```bash
PRODUCT_CATALOG_PROVIDER=mock
PRODUCT_CATALOG_REGION=US
PRODUCT_CATALOG_MAX_RESULTS=20
CREATORS_API_ENABLED=0
```

Amazon Creators API is an optional provider boundary and is **not live or
verified** here. No Amazon prices, reviews, availability, or retail order
status are fetched. Review text is shown only when a configured provider
actually supplies it; otherwise the UI says it is unavailable. Keep
`PACT_PAYMENT_PROVIDER=mock` for the verified demo.

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

### Family invitations and trusted devices

Household → Members provides the normal-account invitation and device-pairing
flows. An owner or authorized adult can choose an invited role (`adult`,
`teen`, `child`, or `caregiver`), an initial permission template, and an
expiration window. PACT returns a one-time invite code and same-origin link;
the UI renders a local QR code and provides copy/revoke controls. Codes are
stored only as hashes and are single-use, expiring, and household-bound.

Trusted-device pairing is a separate approval flow. A signed-in member starts a
10-minute pairing request from the current browser. A different authorized
adult must approve it, after which the requesting session consumes the
one-time secret and creates a trusted device record. Device metadata is
limited to the device name/type, a user-agent summary, timestamps, session
hash, and revocation state. A child or unrelated household member cannot
approve or revoke another member's device. Manual code sharing and QR scanning
are supported; email/SMS delivery is intentionally out of scope.

The corresponding authenticated endpoints are `GET/POST /api/invites`,
`POST /api/invites/accept`, `DELETE /api/invites/{invite_id}`,
`POST /api/pairing/start`, `GET /api/pairing/pending`,
`POST /api/pairing/{pairing_id}/approve`,
`POST /api/pairing/{pairing_id}/consume`, `GET /api/devices`, and
`DELETE /api/devices/{device_id}`. Browser writes continue to require the
existing CSRF token; no demo-login or member-ID authentication is used by
these flows.

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
curl -c cookies.txt \
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

The **Run Maya Demo** button replays the original *secondary* birthday-plan demo (VenueBook and GiftCart mock add-ons). The primary demo is the laptop flow above.

1. “Plan Maya’s birthday under $150.”
2. “Book Funzone.” → VenueBook returns `ask` for $120.
3. “Dad: Approve.” → the exact request is approved and held.
4. “Add the decorations.” → GiftCart returns `deny` because exposure would be $160.

The three simulated surfaces are Living Room shared screen, Dad’s private
phone, and Maya’s tablet. Shared surfaces receive only safe summaries for
protected content: “That’s private.”

### Voice, context, and memory slice

The browser voice loop is a stateful conversation surface: wake phrase or
push-to-talk → listening/transcribing → deterministic command handling →
speaking/approval/denial. A new request interrupts an in-progress browser
utterance safely; if recognition or speech output is unavailable, typed input
remains available. PACT uses browser speech by default. Set
`PACT_TTS_PROVIDER=auto` or `polly` to request server-side Amazon Polly through
the authenticated `/api/tts` route. `auto` falls back to browser speech on
provider, credential, or network failure. Cache entries contain only hashed
non-personalized text keys and are stored with restrictive local permissions;
personalized responses are never cached.

Memory is explicit personalization, not authority. `remember_preference` first
returns `confirmation_required`; only a confirmed request is stored. Private
memory is visible only to its owner, shared memory requires an authorized adult
and explicit confirmation, and `forget_preference` enforces the same scope
boundary. Memory is excluded from policy inputs, budgets, approvals, tokens,
and execution decisions.

The voice-ready MCP tools are `get_memory_context`, `list_memories`,
`list_shared_memories`, `remember_preference`, and `forget_preference`. Action
tools also return safe `spoken_summary`, `visual_summary`,
`requires_approval`, and `next_step` fields without returning signing secrets.

### Optional Alexa adapter

`alexa/` is an isolated, un-deployed Custom Skill adapter. It requires an
account-link access token, never trusts a spoken member name or slot for
identity, and delegates work to the PACT client boundary rather than copying
policy logic. The handler and interaction model are testable locally, but
Alexa developer-console configuration, account-link token exchange, Lambda
deployment, and live invocation are **NOT VERIFIED**. This repository does not
claim Alexa+ integration or live Alexa hardware access.

## Tests

```bash
.venv/bin/python -m pytest                         # policy, MCP, identity, marketplace, product discovery, memory, TTS, Alexa adapter, live HTTP+MCP flow
.venv/bin/python -m pytest -q -s tests/test_bypass.py   # 240 adversarial attempts
PACT_URL=http://127.0.0.1:8787 .venv/bin/python scripts/mcp_sdk_check.py   # official MCP SDK client
PACT_URL=http://127.0.0.1:8787 .venv/bin/python scripts/submission_flow.py # laptop purchase flow, 55 steps
npm run test:signal && npm run e2e:signal
PACT_E2E_BASE_URL=http://127.0.0.1:8787 npm run test:e2e:real   # needs a fresh normal-mode server
scripts/verify_submission.sh                       # all of the above against a throwaway server
```

`tests/test_submission_flow.py` starts a normal-mode server in a subprocess (seeded demo identities
disabled) and runs the full flow, so the core suite exercises real accounts, real sessions and real MCP
calls. CI (`.github/workflows/ci.yml`) runs the build, the Python and bypass suites, the signal tests and
the full browser verification on every push and pull request, with no AWS credentials.

The identity/security regression suite covers five independent sessions, profile isolation, role denial,
cross-session and cross-household token failures, logout invalidation, approval revocation, concurrent
approval supersession and cumulative budget enforcement. Executed numbers are in the
[results table above](#verified-results-run-of-2026-10-22).

## MCP surface

The official Python MCP SDK (2.3.0) exposes these tools (`tools/list` is authoritative; the verification run reports the live count): `get_rules`, `propose_rule`,
`confirm_rule`, `check_action`, `request_approval`, `approve`,
`execute_action`, `get_receipts`, `search_catalog`, `get_product`,
`compare_products`, `get_availability`, `get_product_reviews`,
`get_product_recommendation_context`, `create_purchase_request`,
`get_order_status`, `get_memory_context`, `list_memories`,
`list_shared_memories`, `remember_preference`, and `forget_preference`. The
server uses Streamable HTTP at `/mcp`, validates local
origins, and does not expose arbitrary-code execution. The Trust & Activity
trace is explicitly labeled `SERVER-RECORDED MCP TRACE` and is populated from
persisted MCP boundary events with redacted arguments and results.

Product discovery and controlled ordering evidence is recorded in
[reports/submission-readiness-final.md](reports/submission-readiness-final.md).

## Security boundary

Bedrock/LLM output is a candidate rule only. Schema validation, confirmation,
rule precedence (`deny > ask > allow` with equal-specificity conflicts failing
safe to ask), plan budget enforcement, canonical action hashing, HMAC signing,
sandbox binding, policy-version binding, expiry, nonce replay protection,
approval binding, TOCTOU re-checks, mock execution, and receipt integrity all
happen outside the model.

## Container and deployment

`Dockerfile` and `.dockerignore` are included. An earlier build of the image ran locally under
Docker Desktop 29.8.0 (`/health`, the UI and an MCP smoke passed). **The final submission verification did
not run Docker** because the Docker daemon was not running, so the current image is untested. There is no
public HTTPS deployment and no public MCP endpoint is claimed.

Strands is `NOT RUN` because its Python package is unavailable in `.venv`.
AgentCore is `NOT RUN` because the CLI is unavailable and no resource was
created. The deterministic planner remains the honest fallback.

Voice: Chrome
155.0.8059.80 is installed and the UI wiring is present, but live microphone
capture and audible speech were not independently verified by this
non-interactive runner.

## Submission artifacts

- [docs/judge-quickstart.md](docs/judge-quickstart.md): five-minute judge walkthrough
- [docs/friction-log.md](docs/friction-log.md): problems hit while building, with workarounds and suggestions
- [reports/submission-readiness-final.md](reports/submission-readiness-final.md): exact commands, counts and claims
- [ARCHITECTURE.md](ARCHITECTURE.md)

`PACT_FINAL_STRESS_TEST.md` is the original stress-test source document and is intentionally unmodified.
