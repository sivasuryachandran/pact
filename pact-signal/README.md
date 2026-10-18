# pact-signal

`pact-signal` is a small, open-source three.js signal renderer for assistant
state. It draws a procedural firefly from shaped particles: four dotted
iridescent wings, a rim-lit head, antennae, trailing filaments, a tapered
abdomen, and a warm lantern whose colour signals approval boundaries. It has
no face or emotion model.

## Install

```bash
npm install three pact-signal
```

`three` is a peer dependency. The package has ESM and CommonJS builds, typed
exports, no runtime dependencies besides three, and is SSR-safe until
`createSignal()` is called in a browser.

## Usage

```ts
import { createSignal } from 'pact-signal';

const signal = createSignal({
  container: document.body,
  particleCount: 3000,
  mode: 'roam',
  seed: 42,
});

signal.setState('listening');
signal.setAudioLevel(.4);
signal.on('arrive', () => signal.setState('approval'));
await signal.flyTo('[data-target="dad-phone"]', { arriveState: 'approval', perch: true });
await signal.morph('check');
```

The canvas is pointer-transparent and has an accompanying visually-hidden
status region. `dispose()` is idempotent and releases renderer resources and
listeners. If WebGL cannot be created, the instance renders nothing and emits
an `error` event.

Optional entry points are `pact-signal/react` for `<Signal />` and
`useSignal()`, and `pact-signal/audio` for `createMicLevelSource(stream)`.
The audio helper never requests a microphone; the host must pass an already
authorized `MediaStream`.

## Development

```bash
npm install
npm run build
npm test
npm run e2e
```

The demo lives in `demo/`. See `reports/` for browser screenshots and motion
measurements when a local Playwright browser is available.
