# Voice, memory, Polly, and Alexa verification

Date: 2026-10-19

## Status summary

| Capability | Status | Evidence / boundary |
|---|---|---|
| Browser wake phrase and push-to-talk state machine | IMPLEMENTED | `frontend/src/signal/voice.ts` and `frontend/src/App.tsx` |
| Listening, transcribing, thinking, speaking, approval, allowed, denied, interruption states | IMPLEMENTED | Browser state maps to the existing PACT Core sphere; typed fallback remains available |
| Deterministic conversation orchestration | IMPLEMENTED | `pact/conversation.py`; follow-ups never bypass tokens or approvals |
| Private/shared explicit memory | IMPLEMENTED | `pact/memory.py`, SQLite state, REST and MCP tools |
| Memory confirmation, scope, expiry, forget | VERIFIED | Focused memory tests pass; memory is not policy input |
| Amazon Polly provider | IMPLEMENTED / NOT LIVE-VERIFIED | `pact/tts.py`; uses normal boto3 credential chain when explicitly enabled |
| Polly mocked provider path | SIMULATED / VERIFIED | Injected client tests cover audio, cache, and provider failure without AWS |
| Polly safe caching | VERIFIED | Hashed keys, private cache permissions, no personalized audio caching |
| Browser TTS fallback | VERIFIED | Browser provider and auto-provider failure tests pass |
| Voice-ready MCP response fields | VERIFIED | MCP result fields include spoken/visual summary, approval and next step |
| Alexa Custom Skill adapter | IMPLEMENTED / NOT DEPLOYED | `alexa/`; account-link token required; no slot-based identity |
| Live Alexa+/Alexa hardware | NOT CLAIMED | No deployment or partner access |
| Live Polly credentials / invocation | UNAVAILABLE IN THIS PASS | No live AWS Polly call was claimed or required; browser voice is default |

## Exact test commands

```bash
.venv/bin/python -m pytest -q
.venv/bin/python -m pytest -q tests/test_memory.py tests/test_tts.py alexa/tests
npm run build
npm run test:signal
npm run e2e:signal

# fresh normal-mode browser server (the E2E suite uses four tests)
env PACT_PORT=8927 \
  PACT_ALLOWED_ORIGINS=http://127.0.0.1:8927 \
  PACT_BEDROCK_ENABLED=0 \
  PACT_PAYMENT_PROVIDER=mock \
  PACT_SQLITE_PATH=/tmp/pact-e2e-final.sqlite3 \
  .venv/bin/python -m pact.server
PACT_E2E_BASE_URL=http://127.0.0.1:8927 \
  npx playwright test --config=playwright.real.config.ts --workers=1
```

The focused slice added 13 passing tests: five memory tests, four TTS tests,
one MCP voice/tool registration test, and three Alexa adapter tests. The full
post-slice Python suite passed **111 tests**. Signal passed 7 Vitest tests and
1 Playwright test. The normal-account browser suite passed **4 tests** with
one worker on a fresh SQLite server, including the five-context household
flow, authenticated MCP commerce flow, cross-session approval, and invite /
trusted-device artifacts.

The initial parallel browser attempt was not treated as evidence: it used a
server without the required allowed-origin setting and exposed a stale UI
selector assumption. The final run used a fresh server with
`PACT_ALLOWED_ORIGINS=http://127.0.0.1:8927`, rebuilt assets, and passed all
four browser tests.

## Polly behavior

The default is `PACT_TTS_PROVIDER=browser`, so local startup requires no AWS
Polly access. `auto` attempts Polly and returns a browser-fallback result on
credential, network, or provider failure. `polly` fails closed at the API with
a generic fallback message. The server never prints credentials or raw AWS
error text. Only non-personalized normalized text may be cached, under a local
0700 directory with 0600 audio files; personalized responses use no cache.

No live Polly invocation was claimed in this pass unless the final operator
explicitly runs it with an available AWS profile. No credentials belong in this
report.

The local authenticated smoke verified registration, household creation,
`/api/voice/status`, memory confirmation-required behavior, MCP initialize,
and authenticated `get_memory_context` structured output. The unauthenticated
normal-mode smoke is intentionally rejected; normal MCP use requires a real
server-issued account session.

## Limitations

- Browser speech recognition and browser synthesis depend on Chrome/platform
  support and user microphone permission.
- The Alexa adapter has no deployed Lambda, developer-console model, or live
  account-link exchange in this repository.
- Memory values are intended for low-risk personalization; the prototype does
  not claim enterprise secret-management or production retention controls.
- PACT remains a simulated commerce and simulated Alexa+ experience.
