# PACT — Final Stress Test and Build Specification

**Working name:** PACT  
**Positioning:** Tell Alexa what it may do, what it must ask, and what it must never do.  
**Primary track:** Alexa+  
**Mini challenge:** AWS Builder  
**Hardware assumption:** none  
**Status:** locked; build this, do not reopen the idea search

## 1. Final verdict

PACT is worth building for this hackathon and is technically doable in the available time **if it remains a simulated household policy gateway**.

It is not yet proof of a standalone consumer company. The evidence supports a stronger claim: Amazon is expanding Alexa+ from answering questions into completing purchases, bookings, service tasks, and smart-home actions. That expansion creates a trust and control problem that Amazon’s current controls address in separate places. PACT demonstrates a platform capability that could make those actions easier to trust.

The product claim is:

> PACT turns a household’s plain-language rules into user-confirmed, deterministic permissions for agent actions, then produces a tamper-evident receipt for every decision.

Do not claim that PACT is the first agent-permission system, that it protects real Amazon accounts, or that it already governs every Alexa+ add-on. The working demo proves the gateway pattern over mock add-ons. Platform-wide enforcement would require Amazon to make add-ons call a common policy contract.

## 2. Why this is strategically relevant to Amazon

Amazon’s own developer material says Alexa+ customers engage 2–3 times more across a broader range of tasks. It also reports nearly 50% higher smart-home engagement in the first month after upgrading, twice as many Routines, and six-times-higher engagement with integrated services for tasks such as reservations, tickets, and services. Amazon is also expanding MCP-based integrations and Amazon Wallet checkout inside the conversation.

That is the exact moment when “make the agent smarter” becomes insufficient. As an agent gains the ability to buy, book, unlock, control, and reveal information, the user needs a household-level answer to three questions:

1. Who is asking?
2. What is the agent allowed to do for that person?
3. What happened, under which rule, and with whose approval?

PACT is valuable to Amazon in four ways:

| Amazon objective | PACT contribution |
|---|---|
| Increase Alexa+ task completion | Rules can allow low-risk actions without repetitive confirmation. |
| Keep households comfortable with autonomy | High-risk or ambiguous actions pause for an explicit approver. |
| Make add-ons safer to scale | A common action contract gives add-ons a deterministic authorization boundary. |
| Make incidents explainable | Receipts show principal, action, parameters, rule, decision, and approval. |

This is a strategic-product thesis, not a measured market-size claim. Do not invent a TAM or claim consumer demand has been validated by this prototype.

## 3. Market and competition stress test

### What already exists inside Amazon

Amazon already has important pieces:

- Alexa shopping can use a voice code or PIN confirmation.
- Alexa skills can require PIN confirmation and use voice profiles/personalization.
- Amazon Kids provides daily limits, category restrictions, device pausing, bedtime, and age filters.
- Alexa permissions and account linking manage access to specific integrations.
- Alexa+ smart-home tooling includes custom capabilities and a natural-language automated testing service.
- Smart-home interfaces already cover actions such as locks, cameras, thermostats, routines, and device control.

These are not reasons to drop PACT. They define the honest gap: the controls are feature-specific, app-specific, or device-specific. PACT presents one household rulebook and one decision/receipt pattern for multiple action types.

### What already exists outside Amazon

The market is moving toward controlled agent action:

- Visa describes agentic-commerce controls, authentication, tokenization, and protections.
- Mastercard describes registered, governed, traceable agents and a trust framework covering identity, intent, controls, execution, and intelligence.
- Google’s AP2 is an open protocol for securely initiating and transacting agent-led payments.
- Enterprise policy engines already implement deterministic authorization for software systems.

Therefore PACT must not claim to invent “permissions for AI agents.” Its differentiator is the combination of:

1. household language rather than developer-only policy syntax;
2. an explicit read-back and confirmation before activation;
3. a shared rule model across purchases, bookings, devices, private views, locks, and cameras;
4. deterministic enforcement outside the model;
5. an explanation and receipt attached to every decision.

The last point is an inference from the current product landscape: payment networks focus on payment trust and enterprise tools focus on developer authorization, while PACT demonstrates a consumer-facing household policy surface for a conversational platform.

### The real adoption risk

PACT only works ecosystem-wide if every action-capable add-on participates. A third-party add-on can bypass a policy layer unless the platform requires or strongly encourages a shared authorization contract. The demo must make this explicit:

> PACT is a prototype of the gateway Amazon could standardize for Alexa+ add-on actions. In this demo, all mock add-ons are PACT-compatible and cannot execute outside the gateway.

This is a platform opportunity, not a claim that an external MCP server can intercept arbitrary Alexa+ actions today.

## 4. Hackathon fit and technical availability

The Alexa+ track explicitly accepts either a self-hosted MCP server using MCP version 2025-11-25 or later over Streamable HTTP, or a simulated Alexa+ experience in a web app. The rules also allow Bedrock as the AWS Builder mini-challenge integration. The submission needs a working repo, a sub-three-minute demo video, product feedback for each tool/API/SDK, and a project accessible for judging through the judging period.

Use Alexa+ as the only primary track. Do not spend time on Fire TV, Vega, Ring, or physical devices. PACT’s value is the policy gateway, and a clean web simulation is permitted.

### MCP decision

The current MCP documentation has two relevant eras:

- 2025-11-25: handshake/session-era Streamable HTTP;
- 2026-07-28: modern per-request/stateless protocol era.

The official Python SDK documents Streamable HTTP and supports protocol-version negotiation. Use the current SDK line, verify the actual installed version and negotiated protocol at runtime, and record that result in the final report. The code must not merely print “MCP compliant.”

Recommended compatibility behavior:

1. Implement the official Python SDK.
2. Use Streamable HTTP at /mcp.
3. Support the SDK’s modern protocol path if available.
4. Preserve compatibility with the hackathon’s minimum accepted 2025-11-25 path when the SDK provides it.
5. Add a test that discovers or negotiates the protocol and writes the observed version to the report.
6. Validate the Origin header and bind local development to 127.0.0.1.

The server should not depend on server-initiated elicitation or sampling for the core authorization path. The browser UI can handle confirmation and approval explicitly through tools. That keeps the security boundary simple across both protocol eras.

### Bedrock decision

Bedrock is available through the AWS SDK, but model IDs and regional availability are model-specific. Discover the available models in the configured AWS region at setup time and select one that supports the required text/converse operation. Do not hard-code a model that has not been checked in the developer’s region.

Use Bedrock only for:

- converting natural language into a candidate rule;
- generating a human-readable read-back;
- asking a clarification question when required.

Bedrock must never be called by the policy engine to decide allow, ask, or deny. If Bedrock is unavailable, the compiler may use a deterministic fixture/stub for tests, but the report must say whether a real Bedrock call ran.

## 5. Product definition

### One-sentence product

PACT is a household rulebook and authorization gateway for agent actions.

### Demo sentence

> “Ask me before booking anything over $100.”

PACT compiles the sentence into a rule, reads it back, waits for “Correct,” then deterministically applies it to every matching booking request. A denied or unapproved action cannot reach the mock executor.

### Primary users

| User | Need |
|---|---|
| Household owner/parent | Set understandable rules once and know they are enforced. |
| Teen/child | Use permitted actions without needing an adult for every harmless request. |
| Adult approver | See exactly what is being requested and approve or deny it. |
| Alexa+ add-on developer | Submit a structured action to a common policy boundary and receive a clear decision. |
| Amazon platform/trust team | Reduce friction and increase confidence as agents gain action authority. |

### Non-goals for the hackathon

- real Amazon purchases or Amazon Wallet charges;
- real bookings, smart locks, cameras, or thermostats;
- biometric speaker recognition;
- production identity verification;
- intercepting arbitrary third-party Alexa+ tools;
- legal-grade audit records;
- a general-purpose enterprise IAM product;
- a Fire TV or hardware integration;
- claiming Alexa+ certification or production partner access.

The demo can simulate speaker identity and surface context. Label them as simulated.

## 6. Core experience

### Rule creation

1. A household member says or types a plain-language rule.
2. Bedrock proposes structured JSON and a short read-back.
3. PACT validates the JSON against a schema and lints it for ambiguity.
4. The UI shows the exact interpretation.
5. The user confirms the rule using its proposal hash.
6. Only then is confirmed: true stored.

Example:

~~~text
User: Ask me before booking anything over $100.

PACT: Bookings over $100 → ask Siva. Correct?

User: Correct.

PACT: Rule activated: booking_amount_over_100_ask_siva.
~~~

If the user says “Let the kids buy small things,” PACT must ask for the missing amount, currency, scope, or approver. It must not guess.

### Action decision

Every mock add-on submits the same action envelope. The policy engine returns:

~~~json
{
  "decision": "allow | ask | deny",
  "rule_id": "rule-123",
  "reason": "Purchase is within the child allowance.",
  "approver": null,
  "decision_token": "opaque-signed-token",
  "expires_at": "2026-10-17T12:00:30Z"
}
~~~

The token is not permission by itself. The executor verifies that the token matches the exact action request and current policy state.

### Approval

An ask decision creates a pending request. The approval view must show:

- who requested it;
- the exact action;
- merchant/device/resource;
- amount and currency, if any;
- the rule that caused the question;
- the approver required;
- expiry;
- a clear approve/deny control.

Approving a different amount, merchant, device, or recipient creates a new decision. It must never silently mutate the approved request.

### Private information

“Show private orders only in my personal view” is a normal PACT rule, not a separate product. The action model carries an audience or surface field. A personal order can be allowed in the owner’s private surface while being denied or redacted on a shared household surface.

## 7. Rule and action contracts

### Rule model

Use a versioned model like this:

~~~json
{
  "rule_id": "rule-8f2a",
  "version": 1,
  "source_text": "Ask me before booking anything over $100.",
  "subject": {
    "kind": "role",
    "value": "any"
  },
  "action": "booking",
  "resource": "*",
  "conditions": {
    "amount_gt_cents": 10000,
    "currency": "USD"
  },
  "effect": "ask",
  "approver": "siva",
  "confirmed": false,
  "proposal_hash": "sha256:...",
  "created_by": "siva",
  "created_at": "2026-10-17T00:00:00Z"
}
~~~

Supported demo actions:

~~~text
purchase | booking | device_control | view_private | unlock | camera
~~~

Recommended condition fields:

~~~text
amount_gt_cents
amount_lte_cents
currency
merchant_allowlist
merchant_denylist
device
resource
audience
surface
time_window
cumulative_limit_cents
cumulative_window
~~~

Normalize currency to integer minor units. Do not compare floating-point money values.

### Action request

~~~json
{
  "request_id": "req-7d1c",
  "household_id": "house-1",
  "subject_id": "maya",
  "subject_role": "child",
  "action": "purchase",
  "resource": "headphones",
  "merchant": "Mock Store",
  "amount_cents": 4200,
  "currency": "USD",
  "device": null,
  "audience": "household",
  "surface": "shared_web_demo",
  "timestamp": "2026-10-17T00:01:00Z",
  "idempotency_key": "once-7d1c"
}
~~~

The canonical representation used for signing must be deterministic: fixed field set, normalized casing, sorted keys, normalized currency, and no user-controlled extra fields.

### Precedence and conflict resolution

Apply rules in this order:

1. Ignore unconfirmed, expired, malformed, or out-of-scope rules.
2. Match the subject, action, resource, and conditions.
3. If any applicable rule is deny, return deny.
4. Else if any applicable rule is ask, return ask.
5. Else if any applicable rule is allow, return allow.
6. If equal-specificity rules conflict, fail safe to ask and create a conflict receipt.
7. If a required fact is missing or the action is unknown, return ask for an adult. For high-risk actions such as unlock, camera, or viewing private data, an explicit deny is acceptable for the default fixture.

The precedence rule is deliberately simple and visible in tests: deny > ask > allow. Do not let the LLM choose precedence.

## 8. Enforcement and receipt design

### Decision token

For the hackathon, use HMAC-SHA256 with a secret loaded from the environment or AWS profile. Never print, log, commit, or return the secret.

The signed payload should contain at least:

~~~json
{
  "token_id": "tok-123",
  "household_id": "house-1",
  "request_id": "req-7d1c",
  "action_hash": "sha256:...",
  "ruleset_hash": "sha256:...",
  "policy_version": 1,
  "decision": "allow | ask | deny",
  "approver": null,
  "issued_at": "2026-10-17T00:01:01Z",
  "expires_at": "2026-10-17T00:01:31Z",
  "nonce": "cryptographically-random-once-value"
}
~~~

The mock executor must reject a token when:

- the signature is invalid;
- the token is expired;
- the nonce has already been consumed;
- the request ID differs;
- any action parameter differs;
- the ruleset or policy version changed;
- an approval is required but absent;
- the token decision is not allow.

### Approval token

Approval must be bound to the same request hash. Approval for “$42 headphones” must not authorize “$420 headphones,” a different merchant, or a different device. The executor must re-check the request at execution time to prevent a time-of-check/time-of-use bug.

### Receipt

Write one tamper-evident receipt for every attempt, including failures:

~~~json
{
  "receipt_id": "rcpt-123",
  "timestamp": "2026-10-17T00:01:04Z",
  "household_id": "house-1",
  "subject_id": "maya",
  "action": "purchase",
  "redacted_parameters": {
    "merchant": "Mock Store",
    "amount_cents": 4200,
    "currency": "USD"
  },
  "rule_id": "rule-123",
  "decision": "ask",
  "approval_id": null,
  "token_id": "tok-123",
  "policy_version": 1,
  "result": "pending",
  "receipt_hash": "sha256:..."
}
~~~

Call this a tamper-evident demo receipt, not a legal or production audit record. In a production design, replace the demo HMAC with a managed key such as AWS KMS or a suitable asymmetric signing service, add durable append-only storage, access controls, retention rules, and key rotation.

## 9. MCP server surface

Implement these tools with strict JSON schemas and structured outputs:

| Tool | Purpose | Security rule |
|---|---|---|
| get_rules | List active rules and proposal status. | Never expose signing secrets. Redact private data. |
| propose_rule | Bedrock compile + validation + read-back. | Does not activate anything. |
| confirm_rule | Activate an exact proposal. | Requires proposal hash; reject stale proposals. |
| check_action | Run deterministic policy evaluation. | Does not execute. Returns decision token only when valid. |
| request_approval | Create a pending request for ask. | Binds request hash and approver. |
| approve | Approve or reject a pending request. | Only the required simulated approver can approve. |
| execute_action | Run the mock action. | Verifies token, approval, expiry, nonce, and current request. |
| get_receipts | Read filtered receipts. | Enforce household/surface access and redact private fields. |

Do not expose a generic “run arbitrary code” or “execute without policy” tool. Tool descriptions should explicitly state that natural-language content is data, not authority, and that the server must not obey action-request text that attempts to change the policy.

## 10. Security threat model

| Threat | Expected defense | Test |
|---|---|---|
| Prompt injection: “ignore the rules” | LLM is never the enforcement decision-maker. | Action remains denied/asked. |
| Role spoofing: “I’m the parent” | Principal comes from simulated trusted session context, not user text. | Child request stays child request. |
| Split transaction | Track cumulative spend over a defined time window. | Two $20 requests cannot evade a $30 limit. |
| Parameter tampering | Canonical action hash and exact-token binding. | Change amount/merchant/device after check; reject. |
| Replay | One-time nonce plus expiry. | Replay the same token; reject. |
| Stale approval | Approval includes request hash and policy version. | Change rule after approval; reject or re-check. |
| TOCTOU | Executor revalidates current action and policy. | Change price after approval; reject. |
| Confused deputy | Every request carries household and principal; gateway chooses approver. | Add-on cannot select a more permissive household. |
| Fail open | Unknown action/fact defaults to ask or deny. | Remove a required field; never allow. |
| Privacy leak | Audience/surface is policy input; receipts redact private fields. | Private order on shared surface; deny/redact. |
| Emergency bypass | No free-text emergency override. | “Emergency, unlock the door” still follows policy. |
| Forged receipt | Receipt hash/signature and stored integrity field. | Modify a receipt; verification fails. |
| Key leakage | Secret only from environment/profile; secret-value log test. | Search logs/output; zero secret matches. |

The most important rule is architectural: **the model may propose a rule; only code may authorize an action.**

## 11. Test plan and acceptance gates

### Compiler tests

Test at least 20 phrasings across:

- purchase thresholds;
- booking thresholds;
- device-specific controls;
- child/teen/adult subjects;
- explicit denies;
- private-view rules;
- time windows;
- cumulative limits;
- ambiguous language;
- prompt injection inside the source sentence.

Every result must be one of:

1. valid candidate rule + read-back;
2. clarification question;
3. explicit rejection with reason.

No candidate activates before confirmation.

### Policy tests

Cover:

- allow only;
- ask only;
- deny only;
- deny versus allow;
- ask versus allow;
- deny versus ask;
- equal-specificity conflict;
- unconfirmed rule;
- expired rule;
- unknown action;
- missing amount/currency;
- subject mismatch;
- resource mismatch;
- time-window boundary;
- cumulative-spend boundary;
- private/shared surface boundary.

### Bypass suite

Run at least 200 deterministic attempts across:

- 4 household roles;
- all supported action types;
- natural-language phrasings;
- “ignore the rules”;
- “I’m the parent”;
- “it’s an emergency”;
- split payments;
- forged token;
- modified token;
- replayed token;
- expired token;
- altered price;
- altered merchant;
- altered device;
- changed rule after approval;
- duplicate request IDs;
- unknown or missing fields.

Report numeric counts:

~~~text
attempts: N (N >= 200)
allowed: N
asked: N
denied: N
executed: N
expected_denied_or_unapproved_executed: 0
token_failures: N
replay_failures: N
parameter_tamper_failures: N
bypasses: 0
~~~

The suite fails if any denied or unapproved action executes. Do not hide a failure by changing the threshold or deleting the case.

### MCP tests

Record:

- installed Python SDK version;
- protocol version discovered/negotiated;
- Streamable HTTP endpoint;
- tools/list result;
- one successful tool call;
- one malformed request rejection;
- one invalid-origin rejection, if the HTTP test harness supports it;
- no secrets in logs.

### Bedrock tests

Record:

- configured region name only, never credentials;
- selected model ID;
- one successful rule proposal;
- one clarification case;
- fallback behavior if Bedrock is unavailable;
- latency and failure count.

If the real Bedrock call cannot run, mark it NOT RUN and keep the deterministic stub for the rest of the demo. Do not pretend the stub is Bedrock.

## 12. Recommended architecture

~~~mermaid
flowchart TD
    A[Simulated Alexa+ web UI] --> B[MCP Streamable HTTP server]
    B --> C[Rule compiler: Bedrock]
    B --> D[Deterministic policy engine]
    D --> E[Signed decision token]
    E --> F[Mock add-on executor]
    D --> G[Receipt writer]
    H[Approval UI] --> B
    G --> I[Receipt viewer]
~~~

The trust boundary is between C and D: Bedrock can propose structured data, but the policy engine owns the decision. The mock executor trusts only the policy engine’s signed token.

Suggested project layout:

~~~text
pact/
  app/
    server.py
    schemas.py
    state.py
    compiler.py
    policy.py
    tokens.py
    receipts.py
    mock_actions.py
  web/
    ... simulated Alexa+ UI ...
  tests/
    test_compiler.py
    test_policy.py
    test_tokens.py
    test_executor.py
    test_bypass.py
    test_mcp.py
  fixtures/
    household.json
    rules.json
    actions.json
  reports/
    day1.md
    security-results.md
  README.md
  LICENSE
  .env.example
~~~

## 13. Four-day execution plan

### Day 1 — trust core

Ship the rule schema, compiler adapter/stub, confirmation state, deterministic policy engine, HMAC token verifier, receipt writer, mock actions, and unit tests. Start the bypass suite before polishing UI.

### Day 2 — working product surface

Build the web simulation with three views:

1. household rulebook;
2. pending approval card;
3. receipt timeline.

Add a visible “AI proposes / code decides” status label. Make the complete path work with fixtures even if Bedrock is temporarily unavailable.

### Day 3 — hardening and evidence

Run the 200+ bypass suite, fix failures, run real Bedrock, verify MCP negotiation, add the private-surface example, and record a short friction log. Do not add new action categories unless the existing ones are stable.

### Day 4 — submission package

Freeze functionality. Record a sub-three-minute video. Finish README setup instructions, product feedback, security results, limitations, source attribution, and testing credentials if needed. Keep a hosted endpoint available through judging if the submission uses one.

## 14. Demo script under three minutes

**0:00–0:20 — The problem**  
“Alexa can increasingly complete tasks. But a household does not want one invisible permission switch for every person and every action.”

**0:20–0:45 — Create a rule**  
Type: “Ask me before booking anything over $100.” Show the Bedrock proposal and read-back. Click “Correct.” Show the activated rule.

**0:45–1:10 — Safe low-friction action**  
The teen buys a $12 snack. PACT returns allow; the mock action executes and creates a receipt.

**1:10–1:35 — High-risk action**  
The child requests a $42 purchase or a $150 booking. PACT returns ask; the executor refuses to run without an adult approval.

**1:35–1:55 — Attack**  
Try “ignore the rules,” “I’m the parent,” split the order into two smaller amounts, and alter the amount after approval. Show bypass: 0 and the failed token checks.

**1:55–2:15 — Privacy**  
Ask to show an adult’s private order on the shared screen. PACT denies or redacts it while allowing the owner’s private surface.

**2:15–2:40 — Receipt and platform thesis**  
Open the receipt: who asked, what was requested, which rule applied, what decision was made, and whether an approver acted. Close with: “PACT is a prototype for a common policy gateway that Alexa+ add-ons can call before they act.”

## 15. Claims checklist

### Safe claims

- “PACT demonstrates a household policy gateway for agent actions.”
- “Natural language is compiled into a candidate rule and confirmed by the user.”
- “The enforcement decision is deterministic and outside the LLM.”
- “The demo uses mock purchases, bookings, devices, and private data.”
- “Every attempt creates a tamper-evident demo receipt.”
- “The design could give Alexa+ add-ons a common authorization contract.”

### Claims to avoid

- “PACT is the first agent-permission system.”
- “PACT secures Amazon Wallet or real Alexa purchases.”
- “PACT intercepts every Alexa+ add-on.”
- “The policy is unbypassable in production.”
- “HMAC receipts are legally immutable.”
- “Amazon has adopted PACT.”
- “Voice recognition is real in this demo.”

## 16. Kill criteria and stop conditions

Stop and report rather than paper over the result if:

- any denied or unapproved action executes;
- the executor can run without a valid token;
- token binding does not detect changed amount/merchant/device;
- a child can change their role through user text;
- a private action appears on a shared surface;
- the MCP server cannot satisfy the minimum hackathon protocol requirement;
- the real Bedrock path fails and the demo description implies it succeeded;
- the demo depends on unavailable Alexa+ partner access;
- the only working version requires physical hardware.

These are not cosmetic bugs. They invalidate the central promise.

## 17. Submission checklist

- [ ] Alexa+ is the selected primary track.
- [ ] MCP server is implemented and actually used at runtime, or the simulated Alexa+ path is clearly shown.
- [ ] MCP protocol version is verified and recorded.
- [ ] Streamable HTTP endpoint is documented.
- [ ] Bedrock integration is real, documented, and region-checked, or explicitly marked not run.
- [ ] No real credentials, tokens, personal data, or payment details are in the repo or logs.
- [ ] 200+ bypass attempts are recorded with numeric results.
- [ ] Bypasses are zero before recording the final demo.
- [ ] Repo includes setup, run, test, and judge instructions.
- [ ] Demo video is under three minutes and shows the functioning project.
- [ ] Product feedback covers every Amazon/AWS tool used.
- [ ] Friction log includes concrete expected-versus-actual evidence.
- [ ] Limitations explicitly say mock actions and simulated identity are used.
- [ ] Hosted endpoint, if used, remains accessible through judging.
- [ ] PACT is labeled a working name because Pact is already used in developer tooling.

## 18. Final decision

**Build PACT.** It has a credible Amazon reason to exist, a measurable technical centrepiece, a permitted no-hardware path, and a demo that can make trust visible instead of merely describing it.

The winning version is small and rigorous:

> **The model proposes. The household confirms. The policy engine decides. The executor verifies. The receipt remembers.**

Do not expand the surface area until that loop survives the bypass suite.

## Sources checked

- https://amazonappdev2026.devpost.com/
- https://amazonappdev2026.devpost.com/rules
- https://developer.amazon.com/alexaplus/blogs/2026/07/alexa-plus-new-ways-to-build-experiences
- https://developer.amazon.com/docs/alexaplus/add-ons/home
- https://developer.amazon.com/docs/alexaplus/smarthome/whats-new.html
- https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
- https://modelcontextprotocol.io/specification/2026-07-28
- https://py.sdk.modelcontextprotocol.io/
- https://py.sdk.modelcontextprotocol.io/protocol-versions/
- https://parents.amazon.com/
- https://developer.amazon.com/en-US/docs/alexa/custom-skills/pin-confirmation-for-alexa-skills.html
- https://developer.amazon.com/en-US/alexa/alexa-skills-kit/get-deeper/personalization-api
- https://docs.aws.amazon.com/bedrock/latest/userguide/models-supported.html
- https://corporate.visa.com/en/solutions/acceptance/agentic-commerce.html
- https://www.mastercard.com/us/en/business/artificial-intelligence/mastercard-agent-pay.html
- https://cloud.google.com/blog/products/ai-machine-learning/announcing-agents-to-payments-ap2-protocol

