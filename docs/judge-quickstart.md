# Judge quickstart (about 5 minutes)

PACT is a **simulated** Alexa+ household experience. The catalog, payment and orders are simulated; no
credentials are needed.

## Fastest check: one command

```bash
git clone https://github.com/sivasuryachandran/pact.git && cd pact
python3 -m venv .venv && .venv/bin/python -m pip install -r requirements.txt
npm ci && npm ci --prefix pact-signal
npx playwright install chromium
scripts/verify_submission.sh
```

It builds the app, runs every test suite, starts a throwaway server (temporary SQLite database), and runs:

- the official MCP SDK client (initialize, tools/list, an authenticated tools/call),
- the laptop purchase flow with five accounts in separate sessions (Maya asks, Siva approves, one execution,
  tamper and duplicate attempts refused, receipt and trace checked),
- real-browser end-to-end tests.

It prints PASS or FAIL per step and exits nonzero on any failure. `VERIFY_SKIP_BROWSER=1` skips the browser suites.

## See it yourself

```bash
PACT_BEDROCK_ENABLED=0 PACT_PAYMENT_PROVIDER=mock .venv/bin/python -m pact.server
```

1. Open <http://127.0.0.1:8787> and create an account, then a household (you are the adult owner).
2. In a second browser profile, create another account and join with an invite from Household (role: teen).
3. As the owner, confirm the rule "Ask me before purchases over $1." (Rules) and add a mock card for the teen (Wallet).
4. As the teen: Wallet → type "I need a laptop for Python development, 16 GB RAM minimum, under $900, good battery
   life, and strong reviews." → Search → Compare two → "Run MCP purchase flow".
5. The teen sees ASK; "Try to approve it myself" is refused. The owner sees the exact bound request and presses
   "Approve exact request". The order completes in the teen's session.
6. Open Activity: the browser-observed MCP handshake (initialize, tools/list) and the server-recorded tools/call trace.

## What to look for

- The decision (ASK, DENY) comes from deterministic code; Bedrock only suggests candidate rules.
- Unknown availability is shown as unknown and cannot be ordered; review text is never invented.
- Tokens and credentials never appear in the trace.

## What is not claimed

No Alexa+ partner access, Alexa/Echo hardware, Amazon.com ordering, live Amazon Pay, live bookings, production
identity, or public deployment. See the "Verified vs simulated" table in [README.md](../README.md).
