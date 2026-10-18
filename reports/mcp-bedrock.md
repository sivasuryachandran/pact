# MCP and Bedrock runtime evidence

## MCP

Observed from the installed environment and an official MCP Python client against the running server:

```text
installed mcp SDK: 2.3.0
server Streamable HTTP endpoint: http://127.0.0.1:8787/mcp
negotiated protocol: 2025-11-25
SDK latest supported protocol: 2026-07-28
```

The installed SDK advertises the hackathon minimum handshake version `2025-11-25` and the newer modern protocol `2026-07-28`. `scripts/mcp_smoke.py` performs `initialize`, `tools/list`, and a successful `get_rules` call. The observed tool list is:

```text
get_rules, propose_rule, confirm_rule, check_action, request_approval,
approve, execute_action, get_receipts
```

## Bedrock

Overnight runtime verification used the requested profile `pact`, region
`us-west-2`, and model `amazon.nova-lite-v1:0`. A fresh SQLite sandbox made a
real `/api/propose` request and returned a `candidate` from `compiler=bedrock`
with valid rule JSON, a read-back, and a proposal hash. No credentials were
printed or persisted by the application.

```text
current profile: pact
current PACT region: us-west-2
current model: amazon.nova-lite-v1:0
real proposal: PASSED
compiler: bedrock
failure count: 0
```

Final activation probe on 2026-10-17 used `PACT_BEDROCK_ENABLED=1`, AWS profile `siva-surya-chandran`, and disabled EC2 metadata lookup. No credentials or credential values were printed.

```text
aws CLI: 2.38.1
AWS profile: siva-surya-chandran
configured/default PACT region: us-east-2
credentials: verified through aws sts get-caller-identity; values not printed
catalog models discovered: 96
selected model: amazon.nova-lite-v1:0
selected model inference types: ON_DEMAND, INFERENCE_PROFILE
real Bedrock candidate call: PASSED
candidate latency: 1005.6 ms
clarification call: PASSED with deterministic ambiguity guard
clarification latency: 871.5 ms
Bedrock failure count: 0
```

The runtime path is real: `BedrockCompiler` uses the AWS SDK profile/environment credential chain, discovers a text model with supported deployment modes in the configured region, calls `bedrock-runtime.converse`, validates the returned candidate JSON, and never logs credential values. The project now includes `boto3[crt]` because AWS CLI login credentials require the AWS CRT provider dependency in botocore.

With Bedrock enabled, the observed real outputs were:

```text
proposal compiler: bedrock
proposal status: candidate
candidate rule: booking / ask / amount_gt_cents=10000 / USD / confirmed=false
read-back: Ask me before booking anything over $100.
ambiguous input: clarification
clarification: What maximum amount, currency, scope, and approver should apply?
clarification compiler: bedrock+deterministic-ambiguity-guard
```

Fallback remains available when AWS is unavailable or disabled. The earlier fallback probe reported a valid candidate and clarification with a 0.2 ms deterministic proposal latency. For the local web demo run, `PACT_BEDROCK_ENABLED=0` was set explicitly and `/api/status` reported `available: false`, `model_id: null`, `region: null`, and `reason: disabled by PACT_BEDROCK_ENABLED`.

## Final QA evidence

```text
pytest: 23 passed
balanced bypass reporting: legitimate allow 1; approval-required 1; deny 1
adversarial attempts: 240; unauthorized executions 0; bypasses 0
MCP smoke: passed; negotiated 2025-11-25; SDK 2.3.0
UI flow with Bedrock enabled: propose → confirm → check ask → approve → execute → receipt: passed; receipt integrity: valid
invalid origin: HTTP 403
malformed MCP JSON: HTTP 400
Agent Toolkit: 24 default skills installed; 114-skill catalog verified
overnight SQLite sandbox/isolation/reset: passed
overnight P0 voice/command API path: passed by API harness; Chrome speech recognition remains browser-dependent
Maya four-turn plan: passed; VenueBook ask at $120; GiftCart deny at $160 exposure against $150 budget
Strands: NOT RUN; `ModuleNotFoundError: No module named 'strands'`
AgentCore: NOT RUN; `agentcore: command not found`
deployment: local Docker PASS; public HTTPS NOT RUN because App Runner/ECR permissions were denied by the account boundary
```

