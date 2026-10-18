import * as THREE from 'three';
import { clamp, seededRandom } from './rng';
import { cubicBezier, durationForDistance, easeInOut, screenToNdc, type Vec3 } from './math';
import { createStateMachine, reducedMotionEnabled } from './stateMachine';
import { defaultTheme, mergeTheme } from './theme';
import type { FlyToOptions, SignalEventMap, SignalInstance, SignalMode, SignalOptions, SignalPoint, SignalState, SignalTarget, SignalTheme } from './types';

export * from './types';
export * from './theme';
export * from './stateMachine';
export * from './math';
export * from './rng';

const stateColors: Record<SignalState, keyof SignalTheme> = {
  idle: 'idle', wake: 'listening', listening: 'listening', thinking: 'thinking', speaking: 'speaking', approval: 'approval', allowed: 'allowed', denied: 'denied', private: 'private',
};

const vertexShader = `
  uniform float uTime;
  uniform float uAudio;
  uniform float uPulse;
  uniform float uOpacity;
  uniform float uReduced;
  uniform vec3 uStateColor;
  attribute float aSize;
  attribute float aPhase;
  attribute float aRegion;
  attribute float aTwinkle;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vRegion;
  void main() {
    vec3 p = position;
    float shimmer = sin(uTime * (1.1 + aTwinkle * 1.7) + aPhase) * 0.5 + 0.5;
    float wing = 1.0 - step(0.86, aRegion);
    float filament = step(3.5, aRegion);
    p.z += sin(uTime * 1.7 + aPhase) * (0.012 * wing + 0.006 * filament);
    p.y += sin(uTime * 1.35 + aPhase) * (0.012 + uAudio * 0.035) * wing;
    p.x += cos(uTime * 0.9 + aPhase) * (0.008 * wing + 0.004 * filament);
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    float stateMix = smoothstep(1.5, 3.0, aRegion);
    vColor = mix(color, uStateColor, stateMix * 0.64 + uPulse * 0.16);
    vRegion = aRegion;
    vAlpha = uOpacity * (0.56 + shimmer * 0.44) * (aRegion > 2.5 ? 1.0 : 0.74);
    gl_PointSize = aSize * (1.0 + uAudio * 0.42 + uPulse * 0.18) * (18.0 / max(1.0, -mvPosition.z));
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const fragmentShader = `
  uniform float uOpacity;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vRegion;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv) * 2.0;
    float soft = 1.0 - smoothstep(0.35, 1.0, d);
    float core = 1.0 - smoothstep(0.0, 0.45, d);
    vec3 colorOut = vColor * (1.0 + core * (vRegion > 2.5 ? 2.0 : 0.75));
    gl_FragColor = vec4(colorOut, soft * vAlpha * uOpacity);
  }
`;

const morphVertexShader = `
  uniform float uMorph;
  uniform float uTime;
  attribute vec3 aTarget;
  attribute float aDelay;
  attribute float aSize;
  varying float vAlpha;
  void main() {
    float progress = smoothstep(aDelay, 0.86 + aDelay * 0.12, uMorph);
    vec3 p = mix(position, aTarget, progress);
    p.z += sin(uTime * 2.0 + aDelay * 19.0) * 0.018 * progress;
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    vAlpha = smoothstep(0.0, 0.32, uMorph) * (1.0 - smoothstep(0.78, 1.0, uMorph));
    gl_PointSize = aSize * 28.0 / max(1.0, -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const morphFragmentShader = `
  varying float vAlpha;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float soft = 1.0 - smoothstep(0.28, 1.0, length(uv) * 2.0);
    gl_FragColor = vec4(0.72, 0.87, 1.0, soft * vAlpha);
  }
`;

type Listener<K extends keyof SignalEventMap> = (payload: SignalEventMap[K]) => void;

function resolveElement(target: Element | string): Element | null {
  if (typeof target !== 'string') return target;
  try { return document.querySelector(target); } catch { return null; }
}

function hexColor(value: string): THREE.Color {
  return new THREE.Color(value);
}

function makeGradientTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255,244,214,.76)');
  gradient.addColorStop(.18, 'rgba(125,230,255,.35)');
  gradient.addColorStop(.55, 'rgba(145,120,255,.12)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

function makeParticles(count: number, seed: number) {
  const random = seededRandom(seed);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  const regions = new Float32Array(count);
  const twinkles = new Float32Array(count);
  const wingStart = new THREE.Color(defaultTheme.wingStart);
  const wingEnd = new THREE.Color(defaultTheme.wingEnd);
  const head = new THREE.Color('#D8F6FF');
  const body = new THREE.Color('#8296B2');
  const lantern = new THREE.Color(defaultTheme.idle);
  const set = (index: number, x: number, y: number, z: number, color: THREE.Color, size: number, region: number) => {
    const i = index * 3;
    positions[i] = x; positions[i + 1] = y; positions[i + 2] = z;
    colors[i] = color.r; colors[i + 1] = color.g; colors[i + 2] = color.b;
    sizes[index] = size; phases[index] = random() * Math.PI * 2; regions[index] = region; twinkles[index] = random();
  };
  for (let index = 0; index < count; index += 1) {
    const ratio = index / count;
    if (ratio < .46) {
      // Broad upper wings: their sparse rims and offset veins create the
      // dotted, translucent silhouette from the supplied firefly reference.
      const side = index % 2 === 0 ? -1 : 1;
      const u = random();
      const theta = random() * Math.PI * 2;
      const outline = index % 3 === 0;
      const vein = !outline && index % 7 === 0;
      const length = .26 + u * 1.35;
      const width = (.08 + Math.sin(u * Math.PI) * .33) * (outline ? 1 : random() * .34 + .04);
      const x = side * (0.17 + length);
      const veinOffset = ((index % 5) - 2) * .075 * Math.sin(u * Math.PI);
      const y = .12 + u * .94 + (vein ? veinOffset : Math.sin(theta) * width);
      const z = Math.cos(theta) * width * .52 + (random() - .5) * .06;
      const mix = new THREE.Color().lerpColors(wingStart, wingEnd, Math.min(1, u * .86 + (side > 0 ? .06 : 0)));
      set(index, x, y, z, mix, outline ? 1.55 : .8 + random() * .85, 0);
    } else if (ratio < .61) {
      // Smaller lower wings sit behind the body and curve down from the same
      // shoulder, making the silhouette read as four wings instead of a pair.
      const side = index % 2 === 0 ? -1 : 1;
      const u = random();
      const theta = random() * Math.PI * 2;
      const outline = index % 3 === 0;
      const vein = !outline && index % 5 === 0;
      const length = .16 + u * .72;
      const width = (.07 + Math.sin(u * Math.PI) * .22) * (outline ? 1 : random() * .34 + .06);
      const x = side * (.13 + length);
      const veinOffset = ((index % 3) - 1) * .045 * Math.sin(u * Math.PI);
      const y = .08 - u * .42 + (vein ? veinOffset : Math.sin(theta) * width);
      const z = .065 + Math.cos(theta) * width * .42 + (random() - .5) * .04;
      const mix = new THREE.Color().lerpColors(wingStart, wingEnd, .24 + u * .66);
      set(index, x, y, z, mix, outline ? 1.3 : .62 + random() * .62, .5);
    } else if (ratio < .68) {
      const theta = random() * Math.PI * 2;
      const phi = Math.acos(2 * random() - 1);
      const radius = .15 + random() * .07;
      set(index, Math.sin(phi) * Math.cos(theta) * radius, Math.cos(phi) * radius + .04, Math.sin(phi) * Math.sin(theta) * radius, head, 1.0 + random() * .8, 1);
    } else if (ratio < .87) {
      const theta = random() * Math.PI * 2;
      const phi = Math.acos(2 * random() - 1);
      const radius = .28 + random() * .18;
      const vertical = Math.cos(phi);
      const taper = .55 + .45 * (1 - Math.abs(vertical));
      set(index, Math.sin(phi) * Math.cos(theta) * radius * .76 * taper, vertical * radius * 1.38 - .46, Math.sin(phi) * Math.sin(theta) * radius * .76, body, .68 + random() * .75, 2);
    } else if (ratio < .94) {
      const theta = random() * Math.PI * 2;
      const phi = Math.acos(2 * random() - 1);
      const radius = .13 + random() * .1;
      set(index, Math.sin(phi) * Math.cos(theta) * radius, Math.cos(phi) * radius * .82 + .05, Math.sin(phi) * Math.sin(theta) * radius, lantern, 1.05 + random() * 1.15, 3);
    } else {
      // Fine antennae above the head and four trailing abdomen filaments add
      // the delicate, sparkling motion visible in the reference model.
      const filamentRatio = (ratio - .94) / .06;
      const antenna = filamentRatio < .34;
      const line = index % (antenna ? 2 : 4);
      const t = random();
      const side = line % 2 === 0 ? -1 : 1;
      if (antenna) {
        const x = side * (.055 + t * .12 + Math.sin(t * Math.PI) * .1);
        const y = .17 + t * .78;
        const z = .06 + (random() - .5) * .05;
        const mix = new THREE.Color().lerpColors(wingEnd, new THREE.Color('#B9F7FF'), t);
        set(index, x, y, z, mix, .48 + random() * .55, 4);
      } else {
        const tailSide = line < 2 ? side : (line % 2 === 0 ? -1 : 1);
        const x = tailSide * (.02 + t * (.08 + (line % 3) * .035) + Math.sin(t * Math.PI) * .07);
        const y = -.72 - t * (.54 + (line % 3) * .12);
        const z = -.02 + (random() - .5) * .08;
        const mix = new THREE.Color().lerpColors(wingEnd, new THREE.Color('#9CEBFF'), .2 + t * .7);
        set(index, x, y, z, mix, .42 + random() * .62, 4);
      }
    }
  }
  return { positions, colors, sizes, phases, regions, twinkles };
}

function makeMorphTargets(count: number, kind: 'check' | 'lock', random: () => number): Float32Array {
  const target = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    const t = index / Math.max(1, count - 1);
    let x = 1.9; let y = .2;
    if (kind === 'check') {
      if (t < .42) { const u = t / .42; x += u * .45; y += -.28 + u * -.42; }
      else { const u = (t - .42) / .58; x += .45 + u * .8; y += -.7 + u * 1.32; }
    } else {
      const edge = Math.floor(t * 12) % 4;
      const u = (t * 12) % 1;
      if (edge === 0) { x += u * .8; y += .65; }
      if (edge === 1) { x += .8; y += .65 - u * 1.15; }
      if (edge === 2) { x += .8 - u * .8; y += -.5; }
      if (edge === 3) { x += 0; y += -.5 + u * 1.15; }
    }
    const i = index * 3;
    target[i] = x + (random() - .5) * .04; target[i + 1] = y + (random() - .5) * .04; target[i + 2] = (random() - .5) * .05;
  }
  return target;
}

function noopSignal(): SignalInstance {
  const listeners = new Map<keyof SignalEventMap, Set<Function>>();
  return {
    setState: () => undefined, getState: () => 'idle', flyTo: async () => undefined, returnHome: async () => undefined,
    setMode: () => undefined, morph: async () => undefined, setAudioLevel: () => undefined, pulse: () => undefined,
    setTheme: () => undefined, pause: () => undefined, resume: () => undefined, resize: () => undefined, dispose: () => undefined,
    on: (event, listener) => { let set = listeners.get(event); if (!set) { set = new Set(); listeners.set(event, set); } set.add(listener); return () => set?.delete(listener); },
  };
}

export function createSignal(options: SignalOptions = {}): SignalInstance {
  if (typeof window === 'undefined' || typeof document === 'undefined') return noopSignal();
  const container = typeof options.container === 'string' ? document.querySelector(options.container) : options.container;
  const host = container || document.body;
  if (!host) return noopSignal();
  const theme = mergeTheme(options.theme);
  const stateMachine = createStateMachine('idle');
  const random = seededRandom(options.seed ?? 7193);
  const count = Math.min(8000, Math.max(200, Math.floor(options.particleCount ?? 3000)));
  const reduced = reducedMotionEnabled(options.reducedMotion ?? 'auto', window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  const listeners = new Map<keyof SignalEventMap, Set<Function>>();
  const emit = <K extends keyof SignalEventMap>(event: K, payload: SignalEventMap[K]) => listeners.get(event)?.forEach((listener) => (listener as Listener<K>)(payload));
  let renderer: THREE.WebGLRenderer;
  try { renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' }); }
  catch (error) { const failure = error instanceof Error ? error : new Error('WebGL unavailable'); emit('error', failure); return noopSignal(); }
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true'); canvas.style.pointerEvents = 'none'; canvas.style.position = host === document.body ? 'fixed' : 'absolute'; canvas.style.inset = '0'; canvas.style.width = '100%'; canvas.style.height = '100%'; canvas.style.zIndex = String(options.zIndex ?? 12);
  if (host !== document.body && getComputedStyle(host).position === 'static') (host as HTMLElement).style.position = 'relative';
  host.appendChild(canvas);
  const live = document.createElement('div'); live.setAttribute('aria-live', 'polite'); live.setAttribute('aria-atomic', 'true'); live.style.position = 'absolute'; live.style.width = '1px'; live.style.height = '1px'; live.style.overflow = 'hidden'; live.style.clipPath = 'inset(50%)'; host.appendChild(live);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, .1, 100); camera.position.set(0, 0, 5.6);
  const group = new THREE.Group(); scene.add(group);
  const data = makeParticles(count, options.seed ?? 7193);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3)); geometry.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(data.sizes, 1)); geometry.setAttribute('aPhase', new THREE.BufferAttribute(data.phases, 1)); geometry.setAttribute('aRegion', new THREE.BufferAttribute(data.regions, 1)); geometry.setAttribute('aTwinkle', new THREE.BufferAttribute(data.twinkles, 1));
  const uniforms = { uTime: { value: 0 }, uAudio: { value: 0 }, uPulse: { value: 0 }, uOpacity: { value: 1 }, uReduced: { value: reduced ? 1 : 0 }, uStateColor: { value: hexColor(theme.idle) } };
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const particles = new THREE.Points(geometry, material); group.add(particles);
  const haloTexture = makeGradientTexture();
  const haloMaterial = new THREE.SpriteMaterial({ map: haloTexture || undefined, color: 0x8b7cff, transparent: true, opacity: options.bloom ? .7 : .48, depthWrite: false, blending: THREE.AdditiveBlending });
  const halo = new THREE.Sprite(haloMaterial); halo.scale.set(2.15, 2.15, 1); group.add(halo);
  const morphCount = 180; const morphGeometry = new THREE.BufferGeometry(); const morphPositions = new Float32Array(morphCount * 3); const morphSizes = new Float32Array(morphCount); const morphDelays = new Float32Array(morphCount);
  for (let i = 0; i < morphCount; i += 1) { const p = i * 3; morphPositions[p] = 1.9 + (random() - .5) * .9; morphPositions[p + 1] = .15 + (random() - .5) * .9; morphPositions[p + 2] = (random() - .5) * .2; morphSizes[i] = .9 + random() * 1.2; morphDelays[i] = random() * .2; }
  const morphCheck = makeMorphTargets(morphCount, 'check', random); const morphLock = makeMorphTargets(morphCount, 'lock', random);
  morphGeometry.setAttribute('position', new THREE.BufferAttribute(morphPositions, 3)); morphGeometry.setAttribute('aTarget', new THREE.BufferAttribute(morphCheck.slice(), 3)); morphGeometry.setAttribute('aSize', new THREE.BufferAttribute(morphSizes, 1)); morphGeometry.setAttribute('aDelay', new THREE.BufferAttribute(morphDelays, 1));
  const morphUniforms = { uMorph: { value: 0 }, uTime: { value: 0 } };
  const morphMaterial = new THREE.ShaderMaterial({ uniforms: morphUniforms, vertexShader: morphVertexShader, fragmentShader: morphFragmentShader, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const morphPoints = new THREE.Points(morphGeometry, morphMaterial); morphPoints.visible = false; group.add(morphPoints);
  const home = new THREE.Vector3(options.home?.x ?? 0, options.home?.y ?? 0, options.home?.z ?? 0); group.position.copy(home);
  const current = new THREE.Vector3().copy(home); const flyStart = new THREE.Vector3(); const flyTarget = new THREE.Vector3(); const flyControlA = new THREE.Vector3(); const flyControlB = new THREE.Vector3(); const flyOutput = { x: 0, y: 0, z: 0 };
  let mode: SignalMode = options.mode ?? 'roam'; let audioLevel = 0; let pulseLevel = 0; let paused = false; let disposed = false; let raf = 0; let lastTime = performance.now(); let stateEpoch = 0; let baseBeforePrivate: SignalState = 'idle'; let flight: { started: number; duration: number; resolve: () => void; target: SignalTarget; perch: boolean } | null = null; let morphTimer: { started: number; duration: number; resolve: () => void } | null = null;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const clearTimers = () => { timers.forEach((timer) => clearTimeout(timer)); timers.clear(); };
  const scheduleState = (state: SignalState, ms: number, epoch: number) => { const timer = setTimeout(() => { timers.delete(timer); if (!disposed && epoch === stateEpoch) setState(state); }, ms); timers.add(timer); };
  const setState = (next: SignalState) => {
    if (disposed) return;
    const normalized = next;
    const from = stateMachine.get();
    if (from === normalized) return;
    if (normalized === 'private') baseBeforePrivate = stateMachine.getBase();
    stateEpoch += 1; clearTimers(); const result = stateMachine.set(normalized); uniforms.uStateColor.value.set(theme[stateColors[normalized]]); haloMaterial.color.set(theme[stateColors[normalized]]); live.textContent = normalized === 'approval' ? 'Waiting for approval' : normalized === 'allowed' ? 'Allowed' : normalized === 'denied' ? 'Denied' : '';
    emit('stateChange', { from, to: normalized });
    if (normalized === 'wake') scheduleState('listening', 520, stateEpoch);
    if (normalized === 'allowed') scheduleState(stateMachine.getBase() === 'allowed' ? 'idle' : stateMachine.getBase(), 820, stateEpoch);
    if (normalized === 'denied') scheduleState(stateMachine.getBase() === 'denied' ? 'idle' : stateMachine.getBase(), 1050, stateEpoch);
    if (normalized === 'private') scheduleState(baseBeforePrivate, 1800, stateEpoch);
  };
  const viewport = { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  const avoidedElements = (options.avoid || []).map((item) => resolveElement(item)).filter((item): item is Element => Boolean(item));
  const projected = new THREE.Vector3();
  const resize = () => { if (disposed) return; viewport.width = window.innerWidth; viewport.height = window.innerHeight; camera.aspect = viewport.width / Math.max(1, viewport.height); camera.updateProjectionMatrix(); renderer.setPixelRatio(Math.min(options.maxDpr ?? 2, window.devicePixelRatio || 1)); renderer.setSize(viewport.width, viewport.height, false); };
  const resolveWorld = (target: SignalTarget): THREE.Vector3 => {
    if (typeof target === 'object' && 'x' in target && !('getBoundingClientRect' in target)) return flyTarget.set(target.x, target.y, target.z ?? 0);
    const element = resolveElement(target as Element | string); if (!element) return flyTarget.copy(home);
    const rect = element.getBoundingClientRect(); const ndc = screenToNdc(rect.left + rect.width / 2, rect.top + rect.height / 2, viewport); const ndcVector = new THREE.Vector3(ndc.x, ndc.y, .25).unproject(camera); const direction = ndcVector.sub(camera.position).normalize(); const distance = -camera.position.z / direction.z; return flyTarget.copy(camera.position).add(direction.multiplyScalar(distance));
  };
  const flyTo = (target: SignalTarget, flyOptions: FlyToOptions = {}) => new Promise<void>((resolve) => {
    if (disposed) { resolve(); return; }
    const destination = resolveWorld(target); flyStart.copy(current); flyTarget.copy(destination); const dx = destination.x - flyStart.x; const dy = destination.y - flyStart.y; const distance = Math.hypot(dx, dy);
    flyControlA.set(flyStart.x + dx * .25 - dy * .22, flyStart.y + dy * .25 + dx * .12, flyStart.z + .15); flyControlB.set(destination.x - dx * .24 - dy * .14, destination.y - dy * .24 + dx * .2, destination.z + .08);
    flight = { started: performance.now(), duration: flyOptions.durationMs ?? durationForDistance(distance), resolve, target, perch: Boolean(flyOptions.perch) };
    if (flyOptions.arriveState) setState(flyOptions.arriveState);
  });
  const returnHome = () => flyTo({ x: home.x, y: home.y, z: home.z }, { durationMs: 900, perch: false });
  const morph = (kind: 'check' | 'lock') => new Promise<void>((resolve) => { const targetAttribute = morphGeometry.getAttribute('aTarget') as THREE.BufferAttribute; targetAttribute.array.set(kind === 'check' ? morphCheck : morphLock); targetAttribute.needsUpdate = true; morphPoints.visible = true; morphUniforms.uMorph.value = 0; morphTimer = { started: performance.now(), duration: 1250, resolve }; });
  const setMode = (next: SignalMode) => { mode = next; };
  const setAudioLevel = (level: number) => { audioLevel = clamp(level); };
  const pulse = (strength = 1) => { pulseLevel = Math.max(pulseLevel, clamp(strength)); };
  const setTheme = (partial: Partial<SignalTheme>) => { Object.assign(theme, mergeTheme(partial, theme)); uniforms.uStateColor.value.set(theme[stateColors[stateMachine.get()]]); haloMaterial.color.set(theme[stateColors[stateMachine.get()]]); };
  const pause = () => { paused = true; cancelAnimationFrame(raf); };
  const resume = () => { if (!disposed) { paused = false; lastTime = performance.now(); raf = requestAnimationFrame(render); } };
  const avoidElements = () => (options.avoid || []).map((item) => resolveElement(item)).filter((item): item is Element => Boolean(item));
  const render = (now: number) => {
    if (disposed || paused) return;
    const delta = Math.min(.05, Math.max(0, (now - lastTime) / 1000)); lastTime = now; uniforms.uTime.value += delta; morphUniforms.uTime.value += delta; audioLevel += (0 - audioLevel) * Math.min(1, delta * 4); pulseLevel += (0 - pulseLevel) * Math.min(1, delta * 3);
    if (flight) { const progress = Math.min(1, (now - flight.started) / flight.duration); cubicBezier(flyStart, flyControlA, flyControlB, flyTarget, easeInOut(progress), flyOutput); current.set(flyOutput.x, flyOutput.y, flyOutput.z); group.rotation.z += ((flyTarget.x - flyStart.x) * .04 - group.rotation.z) * Math.min(1, delta * 4); if (progress >= 1) { const complete = flight; flight = null; current.copy(flyTarget); if (complete.perch) mode = 'hover'; emit('arrive', { target: complete.target }); complete.resolve(); } }
    else if (!reduced) {
      if (mode === 'roam' && stateMachine.get() !== 'approval' && stateMachine.get() !== 'private') { const t = now * .00018; const desiredX = home.x + Math.sin(t * 1.7 + (options.seed ?? 1)) * 1.1; const desiredY = home.y + Math.cos(t * 1.33 + (options.seed ?? 1) * .3) * .58; current.x += (desiredX - current.x) * Math.min(1, delta * .38); current.y += (desiredY - current.y) * Math.min(1, delta * .38); projected.copy(current).project(camera); const screenX = (projected.x + 1) * .5 * viewport.width; const screenY = (1 - projected.y) * .5 * viewport.height; for (const element of avoidedElements) { const rect = element.getBoundingClientRect(); if (screenX > rect.left - 36 && screenX < rect.right + 36 && screenY > rect.top - 36 && screenY < rect.bottom + 36) current.y += screenY < viewport.height * .5 ? -.16 : .16; } }
      else if (mode === 'hover') { current.x += (home.x - current.x) * Math.min(1, delta * .85); current.y += (home.y - current.y) * Math.min(1, delta * .85); }
    }
    group.position.lerp(current, Math.min(1, delta * 12)); if (options.cursor && stateMachine.get() !== 'speaking' && !reduced) group.rotation.y += (Math.sin(now * .0006) * .035 - group.rotation.y) * Math.min(1, delta * 2); uniforms.uAudio.value = audioLevel; uniforms.uPulse.value = pulseLevel; uniforms.uOpacity.value = stateMachine.get() === 'private' ? .3 : 1;
    if (morphTimer) { const active = morphTimer; const progress = Math.min(1, (now - active.started) / active.duration); morphUniforms.uMorph.value = progress; if (progress >= 1) { morphTimer = null; morphPoints.visible = false; active.resolve(); } }
    renderer.render(scene, camera); raf = requestAnimationFrame(render);
  };
  const onVisibility = () => { if (document.hidden) pause(); else resume(); };
  window.addEventListener('resize', resize); document.addEventListener('visibilitychange', onVisibility); resize(); resume();
  const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null; if (observer) observer.observe(host);
  const onPointerMove = (event: PointerEvent) => { if (options.cursor && !reduced) { const x = (event.clientX / Math.max(1, window.innerWidth) - .5) * .08; const y = (event.clientY / Math.max(1, window.innerHeight) - .5) * .06; group.rotation.y += (x - group.rotation.y) * .08; group.rotation.x += (y - group.rotation.x) * .08; } };
  if (options.cursor) window.addEventListener('pointermove', onPointerMove, { passive: true });
  const signal: SignalInstance = { setState, getState: () => stateMachine.get(), flyTo, returnHome, setMode, morph, setAudioLevel, pulse, setTheme, pause, resume, resize, dispose: () => { if (disposed) return; disposed = true; stateEpoch += 1; clearTimers(); cancelAnimationFrame(raf); window.removeEventListener('resize', resize); document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('pointermove', onPointerMove); observer?.disconnect(); geometry.dispose(); material.dispose(); morphGeometry.dispose(); morphMaterial.dispose(); haloTexture?.dispose(); haloMaterial.dispose(); renderer.dispose(); canvas.remove(); live.remove(); listeners.clear(); }, on: (event, listener) => { let set = listeners.get(event); if (!set) { set = new Set(); listeners.set(event, set); } set.add(listener); return () => set?.delete(listener); }, canvas };
  return signal;
}

