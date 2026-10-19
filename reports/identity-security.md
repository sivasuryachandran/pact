# Identity and authorization QA

Observed locally on 2026-10-18 after the identity/security implementation.

## Results

```text
Python suite: 74 passed
identity HTTP tests: passed
signal tests: 7 passed
adversarial attempts: 240
unauthorized executions: 0
bypasses: 0
```

Focused coverage now includes:

- five server-issued demo sessions: Siva, Anika, Maya, Leo, and Nora;
- separate member preference profiles;
- role enforcement outside the frontend;
- child cannot approve or execute paid/private/device actions;
- teen cannot manage household rules or approve;
- caregiver cannot read unrelated private receipts;
- cross-session capability token rejection;
- cross-household token rejection;
- logout/session revocation;
- approval version binding and revoked-token rejection;
- concurrent approval updates supersede older approval tokens;
- cumulative budget recheck at execution;
- concurrent execution with one successful reservation and no duplicate spend;
- MCP identity binding that ignores spoofed `created_by`/member arguments.

## Identity model

The demo uses server-issued, short-lived HttpOnly sessions selected from a
seeded account list. It stores no plaintext passwords and does not claim
production authentication or real-world identity verification.

API sessions use `PACT_SESSION_ID`. MCP clients may send the same server-issued
session in `X-PACT-Session`; the MCP transport session is also bound to the
resolved identity and cannot be switched mid-session.

The service layer overwrites caller-controlled household/member/session fields
with the resolved context before action hashing and token issuance. Tokens are
therefore bound to household, member, session, and the exact canonical action.

## Security fixes

1. Cumulative budget enforcement now recalculates executed spending while the
   policy check, nonce/idempotency claim, plan action update, and receipt write
   hold the shared state lock. Two pre-issued tokens cannot both exceed a
   cumulative ceiling.
2. Approval tokens now carry `approval_version`, member/session identity, and
   approval ID. Execution loads the current approval record and rejects tokens
   after rejection, revocation, supersession, expiry, or identity mismatch.

## Fresh MCP wire verification

Using a fresh local server on port 8799:

```text
SDK: 2.3.0
negotiated protocol: 2025-11-25
tools: 8
get_rules structured output: true
seeded members returned: 5
MCP session without header: simulated adult context
MCP session with X-PACT-Session for Maya: caller=maya, role=teen
spoofed created_by=siva from Maya session: stored created_by=maya
```

## Remaining limitations

- This remains demo authentication, not OAuth, passkeys, SSO, or verified
  identity.
- Sessions are in-memory and expire on process restart; durable production
  identity/session storage is intentionally out of scope.
- Local SQLite is adequate for this single-process demo. A production service
  needs a transactional shared datastore, key management, audit retention,
  and operational concurrency controls.
- No public deployment, Strands, AgentCore, real Amazon action, purchase,
  booking, device, or Alexa+ integration is claimed.
