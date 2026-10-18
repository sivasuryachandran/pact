# UI verification

## Implementation

- `pact-signal` is a local TypeScript ESM/CJS package with a three.js peer.
- The PACT UI is a React/Vite/Tailwind/Motion source app built into the
  existing Python server's `web/` directory.
- No backend routes, MCP tools, policy decisions, approval token checks, or
  receipt logic were changed.
- The Stitch MCP connector was not available in this session. No Stitch output
  or secret API key was used; the UI follows the provided visual brief and the
  existing PACT-native direction.

## Verified

```text
signal build: PASS
signal pure tests: 7 passed
signal Playwright: 1 passed, 0 console errors
PACT UI browser smoke: PASS, 0 console errors
Maya browser flow: PASS — $120 approved/committed, $40 GiftCart denied, $160 exposure avoided
screenshots: idle, listening, approval, allowed, denied, mid-flight, check morph, lock morph
PACT screens: Home, Rules, Activity, Developer
video: reports/ui/maya-flow.webm
Lighthouse Home: performance 68, accessibility 100, best practices 96, SEO 90
```

The browser smoke used the running local PACT server and real `/api/command`,
`/api/reset`, `/api/trust`, and UI API calls. No decisions were driven by UI
timers; the short pauses only allow the real server responses and animations to
be observed.

## Performance

At 1440×900 in headless Chromium over 10 seconds:

```text
3,000 particles: 60.11 FPS, 0.00 long-task ms/frame
8,000 particles: 60.10 FPS, 0.00 long-task ms/frame
```

## Limitations

- Live microphone permission and physical audio were not independently
  verified in this non-interactive runner; the Chrome Web Speech and Web Audio
  hooks are present, with typed fallback always available.
- Weather is intentionally not fetched from an external runtime URL in the
  local build.
- Stitch designs were not pulled because the Stitch MCP server was not among
  the callable connectors in this session.

Lighthouse was run against the live local server with:

```bash
npx --yes lighthouse http://127.0.0.1:8787/ \
  --output=json --output-path=reports/lighthouse.json \
  --chrome-flags='--headless=new --no-sandbox' --quiet
```

Final local commands:

```bash
npm install
npm run build
npm run test:signal
npm run e2e:signal
.venv/bin/python -m pytest -q
.venv/bin/python -m pytest -q -s tests/test_bypass.py
.venv/bin/python scripts/mcp_smoke.py
docker build --tag pact-simulated:submission .
```

Docker final smoke: `/health` returned 200 and a Streamable HTTP MCP
`initialize` request returned 200 on the rebuilt image.
