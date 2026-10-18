# Overnight build status

Baseline captured before the overnight P0–P5 expansion on 2026-10-17.

```text
pytest: 16 passed in 0.36s
bypass suite: 240 attempts; 0 bypasses; 0 denied/unapproved executions
MCP SDK: 2.3.0
negotiated protocol: 2025-11-25
MCP endpoint: http://127.0.0.1:8787/mcp
MCP smoke: passed; 8 tools; structured output true
```

The existing deterministic policy engine, Bedrock compiler, HMAC tokens,
approval flow, receipts, Streamable HTTP endpoint, and `PACT_FINAL_STRESS_TEST.md`
are preserved. AWS credentials are never included in this report.

## Final overnight evidence

```text
pytest: 23 passed in 0.44s
legitimate: allow 1; approval-required 1; deny 1
adversarial: 240 attempts; allowed 0; asked 120; denied 120
unauthorized_executions: 0
replay_failures: 18; parameter_tamper_failures: 40
bypasses: 0
MCP smoke: passed; SDK 2.3.0; negotiated 2025-11-25; structured output true
Bedrock: 50/50 real candidate proposals; 0 fallback; 0 failures
Bedrock latency: min 696.0 ms; median 875.85 ms; max 1445.2 ms
Maya plan: VenueBook ask at $120; Dad approval; GiftCart deny at $160/$150 budget
SQLite sandbox isolation/reset: passed
per-sandbox rate limit: passed (HTTP 429 after configured threshold)
Bedrock cap fallback: passed (`deterministic-cap-fallback`)
Mock add-ons: VenueBook and GiftCart emit exact PACT-bound action envelopes; focused test passed
Exact-token QA: changed price refused; replay refused; split purchase denied; shared private view denied
Docker image/local container: build passed; health/UI/MCP smoke passed
Chrome live microphone/audio: NOT RUN; installed Chrome and UI wiring verified
Strands planner: NOT RUN; `ModuleNotFoundError: No module named 'strands'`
AgentCore: NOT RUN; `agentcore: command not found`
Public deployment: NOT RUN; App Runner/ECR permissions denied by account boundary
```

No denied or unapproved action executed. Approved mock flows executed only
when the exact approval and exact decision token were supplied.

Final QA stopped the stale listener and restarted the current process on
`8787`; its health, Bedrock API flow, UI/API flow, and MCP smoke all passed.
