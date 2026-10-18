import * as THREE from 'three-morpho';
import { EffectComposer } from 'three-morpho/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three-morpho/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three-morpho/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three-morpho/examples/jsm/postprocessing/OutputPass.js';
import { foreOutline, hindOutline, wingMesh, wingTexture } from './wings';

/**
 * The PACT firefly. It only *shows* state: it never decides anything.
 * `respond()` must be called with the decision the policy engine returned.
 */
export type Decision = 'allowed' | 'approval' | 'denied' | 'private';
export type SignalMode = 'roam' | 'arrive' | 'listen' | 'think' | 'respond';

export interface SignalOptions {
  /** Multiplier on the base fly scale (default 1). */
  size?: number;
  /** Multiplier on flight speed (default 1). */
  speed?: number;
  /** Slow hover and no trail. Defaults to the `prefers-reduced-motion` media query. */
  reducedMotion?: boolean;
  /** Called whenever the mode changes. */
  onMode?: (mode: SignalMode) => void;
  /** Disable the render loop; drive frames with `advance()`. For screenshots and tests. */
  manual?: boolean;
}

export interface SignalInstance {
  wake(): void;
  think(): void;
  respond(decision: Decision): void;
  idle(): void;
  setSpeed(n: number): void;
  setSize(n: number): void;
  getMode(): SignalMode;
  /** Advance the simulation by `seconds` in 1/60 s steps and render once. */
  advance(seconds: number): void;
  dispose(): void;
}

// ---- tuning -------------------------------------------------------------
/** Global scale on the fly group. Trail, rings, halo and motes scale with it. */
const BASE_SCALE = 0.4;
const CAMERA_Z = 9;
const FOV = 38;
/** Hover depth (z). Further from the camera than the prototype (2.2). */
const HOVER_Z = 1.0;
/** Roam depth range: far..near. The near limit keeps the wingspan <= ~10% of viewport height. */
const ROAM_Z_FAR = -14;
const ROAM_Z_NEAR = -6;
const HOLD_RESPOND = 3.2;
const MAX_LISTEN = 20;
const MAX_THINK = 30;

const STATE_COLORS = {
  idle: [1.0, 0.82, 0.52], listening: [0.58, 0.50, 1.0],
  allowed: [0.20, 0.83, 0.60], approval: [0.98, 0.75, 0.14], denied: [0.98, 0.44, 0.52], private: [0.55, 0.55, 0.62],
} as const;

const PALETTE = [[1.0, 0.86, 0.55], [1.0, 0.96, 0.88], [0.45, 0.95, 0.92], [0.62, 0.55, 1.0], [0.45, 0.65, 1.0], [1.0, 0.75, 0.92]];
const MAX_DUST = 6000;

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.2, 'rgba(255,255,255,.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function noopSignal(): SignalInstance {
  return { wake() {}, think() {}, respond() {}, idle() {}, setSpeed() {}, setSize() {}, getMode: () => 'roam', advance() {}, dispose() {} };
}

export function createSignal(container: HTMLElement, opts: SignalOptions = {}): SignalInstance {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch {
    return noopSignal(); // no WebGL: render nothing, the rest of the UI keeps working
  }

  const reduceQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  let reduced = opts.reducedMotion ?? reduceQuery?.matches ?? false;
  const onReduce = (e: MediaQueryListEvent) => { if (opts.reducedMotion === undefined) reduced = e.matches; };
  reduceQuery?.addEventListener?.('change', onReduce);

  let seed = 21;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;

  let width = Math.max(1, container.clientWidth), height = Math.max(1, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.9;
  renderer.setClearColor(0x000000, 0); // transparent: the page owns the #050507 canvas
  renderer.domElement.style.display = 'block';
  renderer.domElement.setAttribute('aria-hidden', 'true');
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, width / height, 0.1, 100);
  camera.position.set(0, 0, CAMERA_Z);
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(FOV / 2));

  // The addon typings resolve `three` to the app's other three version; the runtime classes are 0.169.0.
  const composer = new EffectComposer(renderer as never);
  composer.addPass(new RenderPass(scene as never, camera as never));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(width, height) as never, 0.75, 0.5, 0.82));
  composer.addPass(new OutputPass());

  let sizeMul = opts.size ?? 1;
  let speedMul = opts.speed ?? 1;
  const scale = () => BASE_SCALE * sizeMul;

  // ---- the creature ---------------------------------------------------------
  const stateCol = new THREE.Color(...STATE_COLORS.idle);
  const targetCol = stateCol.clone();
  const IDLE = new THREE.Color(...STATE_COLORS.idle), LISTEN = new THREE.Color(...STATE_COLORS.listening);

  const fly = new THREE.Group(); scene.add(fly);
  const tilt = new THREE.Group(); fly.add(tilt);
  const foreTex = wingTexture('fore', rnd), hindTex = wingTexture('hind', rnd);
  const hingesR: THREE.Group[] = [], hingesL: THREE.Group[] = [];
  const wingMaterials: THREE.ShaderMaterial[] = [];
  for (const side of [1, -1]) {
    const hinge = new THREE.Group(); tilt.add(hinge); hinge.position.set(0.02 * side, 0.05, 0);
    const fore = wingMesh(foreOutline, foreTex, 1.55); fore.rotation.z = 0.18; fore.position.y = 0.02;
    const hind = wingMesh(hindOutline, hindTex, 1.10); hind.rotation.z = -0.05; hind.position.y = -0.22; hind.position.z = -0.01;
    hinge.add(hind); hinge.add(fore);
    wingMaterials.push(fore.material as THREE.ShaderMaterial, hind.material as THREE.ShaderMaterial);
    if (side < 0) hinge.scale.x = -1;
    (side > 0 ? hingesR : hingesL).push(hinge);
  }
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1b1640, roughness: 0.35, metalness: 0.2, emissive: 0x120e30 });
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.075, 24, 16), bodyMat); head.position.y = 0.30; tilt.add(head);
  const thorax = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.20, 8, 16), bodyMat); thorax.position.y = 0.10; tilt.add(thorax);
  const lanternMat = new THREE.MeshBasicMaterial({ color: stateCol.clone().multiplyScalar(3.0) });
  const lantern = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.42, 8, 20), lanternMat); lantern.position.y = -0.30; tilt.add(lantern);
  const antMat = new THREE.MeshBasicMaterial({ color: 0x9d93e8 });
  const tipMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.85, 0.5).multiplyScalar(1.4) });
  for (const s of [1, -1]) {
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0.03 * s, 0.35, 0), new THREE.Vector3(0.14 * s, 0.62, 0.03), new THREE.Vector3(0.30 * s, 0.78, 0.05));
    tilt.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 20, 0.008, 6), antMat));
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), tipMat); tip.position.copy(curve.getPoint(1)); tilt.add(tip);
  }
  scene.add(new THREE.AmbientLight(0x8080ff, 0.6));
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.2); keyLight.position.set(2, 3, 5); scene.add(keyLight);

  const glow = glowTexture();
  const haloMat = new THREE.SpriteMaterial({ map: glow, color: stateCol.clone(), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
  const halo = new THREE.Sprite(haloMat); halo.scale.set(2.4, 2.4, 1); halo.position.y = -0.42; halo.renderOrder = -1; tilt.add(halo);
  const bigHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0x6a58ff, transparent: true, opacity: 0.035, blending: THREE.AdditiveBlending, depthWrite: false }));
  bigHalo.renderOrder = -2; bigHalo.scale.set(9, 9, 1); tilt.add(bigHalo);

  // ---- pixie-dust trail (GPU points, CPU sim) -----------------------------------
  const pPos = new Float32Array(MAX_DUST * 3), pCol = new Float32Array(MAX_DUST * 3), pSize = new Float32Array(MAX_DUST);
  const pAlpha = new Float32Array(MAX_DUST), pKind = new Float32Array(MAX_DUST), pVel = new Float32Array(MAX_DUST * 3);
  const pLife = new Float32Array(MAX_DUST), pMax = new Float32Array(MAX_DUST), pTw = new Float32Array(MAX_DUST), pBase = new Float32Array(MAX_DUST);
  let dustHead = 0;
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  pGeo.setAttribute('size', new THREE.BufferAttribute(pSize, 1));
  pGeo.setAttribute('alpha', new THREE.BufferAttribute(pAlpha, 1));
  pGeo.setAttribute('kind', new THREE.BufferAttribute(pKind, 1));
  const pMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { pxScale: { value: 1 } },
    vertexShader: `
      attribute float size; attribute float alpha; attribute float kind; attribute vec3 color;
      varying vec3 vC; varying float vA; varying float vK; uniform float pxScale;
      void main(){ vC=color; vA=alpha; vK=kind; vec4 mv=modelViewMatrix*vec4(position,1.);
        gl_PointSize=size*pxScale*(9./-mv.z); gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `
      varying vec3 vC; varying float vA; varying float vK;
      void main(){ vec2 p=gl_PointCoord-.5; float d=length(p);
        float core=exp(-d*d*60.); float soft=exp(-d*d*10.)*0.35;
        float a=core+soft;
        if(vK>0.5){
          float sx=exp(-abs(p.y)*70.)*smoothstep(.5,0.,abs(p.x));
          float sy=exp(-abs(p.x)*70.)*smoothstep(.5,0.,abs(p.y));
          a=core*1.2+ (sx+sy)*0.9 + soft*0.5; }
        vec3 c=mix(vC, vec3(1.), core*0.7);
        gl_FragColor=vec4(c*a*vA, a*vA); }`,
  });
  const points = new THREE.Points(pGeo, pMat); points.frustumCulled = false; scene.add(points);

  function emit(origin: THREE.Vector3, vx: number, vy: number, n: number) {
    const S = scale();
    for (let k = 0; k < n; k++) {
      const i = dustHead; dustHead = (dustHead + 1) % MAX_DUST;
      const s = (0.10 + rnd() * 0.18) * S;
      pPos[i * 3] = origin.x + (rnd() - 0.5) * s; pPos[i * 3 + 1] = origin.y + (rnd() - 0.5) * s; pPos[i * 3 + 2] = origin.z + (rnd() - 0.5) * s;
      pVel[i * 3] = (-vx * 0.05 + (rnd() - 0.5) * 0.45) * S; pVel[i * 3 + 1] = (-vy * 0.05 + (rnd() - 0.5) * 0.45) * S; pVel[i * 3 + 2] = (rnd() - 0.5) * 0.3 * S;
      const star = rnd() < 0.12;
      pKind[i] = star ? 1 : 0;
      pBase[i] = star ? 34 + rnd() * 40 : 7 + rnd() * 12;
      pMax[i] = star ? 1.6 + rnd() * 2.0 : 1.2 + rnd() * 2.6; pLife[i] = 0; pTw[i] = rnd() * 20;
      const c = rnd() < 0.55 ? PALETTE[rnd() < 0.5 ? 0 : 1] : PALETTE[2 + Math.floor(rnd() * 4)];
      pCol[i * 3] = c[0] * 0.85 + stateCol.r * 0.15; pCol[i * 3 + 1] = c[1] * 0.85 + stateCol.g * 0.15; pCol[i * 3 + 2] = c[2] * 0.85 + stateCol.b * 0.15;
    }
  }
  function updateDust(dt: number, t: number) {
    const damp = Math.pow(0.4, dt), g = 0.12 * dt * scale();
    for (let i = 0; i < MAX_DUST; i++) {
      if (pMax[i] === 0) continue;
      pLife[i] += dt; const k = pLife[i] / pMax[i];
      if (k >= 1) { pAlpha[i] = 0; pMax[i] = 0; continue; }
      pVel[i * 3] *= damp; pVel[i * 3 + 1] = pVel[i * 3 + 1] * damp - g; pVel[i * 3 + 2] *= damp;
      pPos[i * 3] += pVel[i * 3] * dt; pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt; pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
      const fade = k < 0.08 ? k / 0.08 : Math.pow(1 - k, 1.5);
      const tw = 0.55 + 0.45 * Math.sin(t * (7 + pTw[i] * 0.4) + pTw[i]);
      pAlpha[i] = fade * (pKind[i] ? 1.0 : 0.55 + 0.45 * tw);
      pSize[i] = pBase[i] * (0.6 + 0.5 * tw);
    }
    pGeo.attributes.position.needsUpdate = true; pGeo.attributes.color.needsUpdate = true;
    pGeo.attributes.size.needsUpdate = true; pGeo.attributes.alpha.needsUpdate = true; pGeo.attributes.kind.needsUpdate = true;
  }

  // ---- listening waves ----------------------------------------------------------
  const ringGeo = new THREE.PlaneGeometry(1, 1);
  const makeRingMat = () => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { k: { value: 0 }, col: { value: new THREE.Color() } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: `uniform float k; uniform vec3 col; varying vec2 vUv;
      void main(){ float d=length(vUv-.5)*2.; float r=k; float w=0.035+0.05*k;
        float a=exp(-pow((d-r)/w,2.))*(1.-k)*(1.-k);
        a+=exp(-pow((d-r)/(w*3.),2.))*0.25*(1.-k);
        gl_FragColor=vec4(col*a*2.4, a); }`,
  });
  const rings: { m: THREE.Mesh; t: number; dur: number; size: number }[] = [];
  for (let i = 0; i < 5; i++) {
    const m = new THREE.Mesh(ringGeo, makeRingMat()); m.visible = false; m.renderOrder = -3; fly.add(m);
    rings.push({ m, t: -1, dur: 1.8, size: 7.5 });
  }
  let ringClock = 0;
  function spawnRing(col: THREE.Color, size = 7.5, dur = 1.8) {
    let r = rings[0];
    for (let i = 0; i < rings.length; i++) if (rings[i].t < 0) { r = rings[i]; break; }
    r.t = 0; r.dur = dur; r.size = size;
    (r.m.material as THREE.ShaderMaterial).uniforms.col.value.copy(col); r.m.visible = true;
  }
  function updateRings(dt: number) {
    for (let i = 0; i < rings.length; i++) {
      const r = rings[i]; if (r.t < 0) continue;
      r.t += dt; const k = r.t / r.dur;
      if (k >= 1) { r.t = -1; r.m.visible = false; continue; }
      (r.m.material as THREE.ShaderMaterial).uniforms.k.value = k;
      const s = r.size * (0.25 + 0.75 * k); r.m.scale.set(s, s, 1); r.m.position.set(0, -0.1, -0.05);
    }
  }

  // ---- thinking energy: motes rising lantern -> head ---------------------------------
  const energy: THREE.Sprite[] = [];
  for (let i = 0; i < 10; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0x9fe8ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
    s.scale.set(0.26, 0.26, 1); tilt.add(s); energy.push(s);
  }
  const coreBand = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xe9e4ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
  coreBand.scale.set(0.7, 0.32, 1); tilt.add(coreBand);
  let energyLevel = 0;

  // ---- behaviour --------------------------------------------------------------------
  let mode: SignalMode = 'roam', modeT = 0, simT = 0, flapPhase = 0;
  let decisionColor: THREE.Color | null = null;
  let cruise = 1.6, cruiseTarget = 1.6, nextCruiseChange = 0;
  const pos = new THREE.Vector3(0, 0, ROAM_Z_FAR), vel = new THREE.Vector3(0.5, 0.2, 0);
  const target = new THREE.Vector3(), center = new THREE.Vector3(0, 0, HOVER_Z);
  const tmp = new THREE.Vector3(), desired = new THREE.Vector3(), tipV = new THREE.Vector3(), burstV = new THREE.Vector3();
  const burstCol = new THREE.Color();

  /** Half the visible extents at depth z, written into the shared scratch pair. */
  const ext = { x: 0, y: 0 };
  function halfExtents(z: number) {
    ext.y = tanHalf * (CAMERA_Z - z); ext.x = ext.y * camera.aspect;
  }
  /** Hover point: right two thirds of the screen, so the clock block on the left stays clear. */
  function placeCenter() {
    halfExtents(HOVER_Z);
    center.set(camera.aspect > 1.2 ? ext.x * 0.34 : 0, ext.y * 0.04, HOVER_Z);
  }
  function pickTarget() {
    const z = ROAM_Z_FAR + rnd() * (ROAM_Z_NEAR - ROAM_Z_FAR);
    halfExtents(z);
    target.set((rnd() * 2 - 1) * ext.x * 0.78, (rnd() * 2 - 1) * ext.y * 0.62, z);
  }
  /** Roam speeds are authored for ~9 units of depth; scale so on-screen speed stays constant. */
  const depthK = () => Math.max(0.5, (CAMERA_Z - pos.z) / CAMERA_Z);
  placeCenter(); pickTarget();
  pos.set(target.x * 0.5, target.y * 0.5, ROAM_Z_FAR * 0.6);

  function setMode(m: SignalMode) { mode = m; modeT = 0; opts.onMode?.(m); }

  function step(dt: number) {
    simT += dt; modeT += dt;
    const S = scale(), k = depthK(), sm = speedMul * (reduced ? 0.4 : 1);

    if (mode === 'roam') {
      if (simT > nextCruiseChange) { cruiseTarget = 0.7 + rnd() * 2.8; nextCruiseChange = simT + 2 + rnd() * 3.5; }
      cruise += (cruiseTarget - cruise) * Math.min(1, dt * 0.8);
      if (pos.distanceTo(target) < 0.9 * k) pickTarget();
      desired.copy(target).sub(pos).normalize().multiplyScalar(cruise * sm * k);
      desired.x += Math.sin(simT * 1.3) * 0.35 * k * (reduced ? 0.4 : 1); desired.y += Math.cos(simT * 1.7) * 0.25 * k * (reduced ? 0.4 : 1);
      vel.lerp(desired, Math.min(1, dt * 1.4));
    } else if (mode === 'arrive') {
      const d = pos.distanceTo(center);
      const sp = Math.min(4.5 * k, d * 2.2) * Math.max(1, speedMul);
      desired.copy(center).sub(pos).normalize().multiplyScalar(sp);
      vel.lerp(desired, Math.min(1, dt * 2.5));
      targetCol.copy(LISTEN);
      if (d < 0.12 * k) setMode('listen');
    } else {
      const bobAmt = reduced ? 0.3 : 1;
      tmp.copy(center); tmp.y += Math.sin(simT * 1.6) * 0.06 * bobAmt; tmp.x += Math.sin(simT * 0.9) * 0.04 * bobAmt;
      desired.copy(tmp).sub(pos).multiplyScalar(3.0);
      vel.lerp(desired, Math.min(1, dt * 3));
      if (mode === 'listen') {
        targetCol.copy(LISTEN);
        ringClock -= dt; if (ringClock <= 0) { spawnRing(LISTEN); ringClock = 0.6; }
        if (modeT > MAX_LISTEN) api.idle(); // nobody spoke: give the stage back
      } else if (mode === 'think') {
        targetCol.copy(LISTEN).lerp(IDLE, 0.35);
        if (modeT > MAX_THINK) api.idle(); // engine never answered
      } else if (modeT > HOLD_RESPOND) {
        targetCol.copy(IDLE); decisionColor = null; setMode('roam'); pickTarget();
      }
    }
    pos.addScaledVector(vel, dt);
    fly.position.copy(pos);
    fly.scale.setScalar(S);

    const calm = mode === 'think';
    tilt.rotation.z = THREE.MathUtils.clamp(-vel.x / k * 0.12, -0.55, 0.55) * (calm ? 0.3 : 1);
    tilt.rotation.x = -0.55 + THREE.MathUtils.clamp(vel.z / k * 0.10, -0.35, 0.35) + Math.sin(simT * 2.0) * 0.05;
    tilt.rotation.y = THREE.MathUtils.clamp(vel.x / k * 0.06, -0.35, 0.35);

    const speed = vel.length() / k;
    let freq: number, amp: number, base: number;
    if (mode === 'think') { freq = 2.6; amp = 0.22; base = 0.30; }
    else if (mode === 'listen') { freq = 7.5; amp = 0.60; base = 0.20; }
    else { freq = 7 + speed * 1.6; amp = 0.80; base = 0.15; }
    if (reduced) { freq *= 0.5; amp *= 0.6; }
    flapPhase += freq * dt;
    const ang = base + amp * (0.5 + 0.5 * Math.sin(flapPhase));
    for (let i = 0; i < hingesR.length; i++) { hingesR[i].rotation.y = -ang; hingesL[i].rotation.y = ang; }

    stateCol.lerp(targetCol, Math.min(1, dt * (mode === 'respond' ? 6 : 3)));
    let glowAmt = 1.7 + 0.3 * Math.sin(simT * 1.8);
    if (mode === 'think') glowAmt = 0.45 + 0.1 * Math.sin(simT * 1.2);
    if (mode === 'respond') glowAmt = 2.4 - Math.min(1, modeT) * 0.5;
    lanternMat.color.copy(stateCol).multiplyScalar(glowAmt);
    haloMat.color.copy(stateCol);
    haloMat.opacity = mode === 'respond' ? 0.55 : mode === 'think' ? 0.22 : 0.35;

    energyLevel = mode === 'think' ? Math.min(1, modeT * 2) : Math.max(0, energyLevel - dt * 3);
    for (let i = 0; i < energy.length; i++) {
      const f = (simT * 0.55 + i / energy.length) % 1, s = energy[i];
      s.position.set(Math.sin(f * 9 + i) * 0.035, -0.78 + f * 1.12, 0.05);
      s.material.opacity = energyLevel * Math.sin(Math.PI * f) * 0.9;
    }
    const band = (simT * 0.55) % 1;
    coreBand.position.set(0, -0.78 + band * 1.12, 0.06);
    coreBand.material.opacity = energyLevel * Math.sin(Math.PI * band);

    if (!reduced) {
      fly.updateMatrixWorld(true);
      tipV.set(0, -0.55, 0); tilt.localToWorld(tipV);
      emit(tipV, vel.x, vel.y, mode === 'think' ? (rnd() < 0.3 ? 1 : 0) : Math.round(1 + speed * 2.4));
    }
    updateDust(dt, simT); updateRings(dt);
    for (let i = 0; i < wingMaterials.length; i++) wingMaterials[i].uniforms.time.value = simT;
  }

  function burst(col: THREE.Color, n: number) {
    const S = scale();
    fly.updateMatrixWorld(true);
    burstV.set(0, -0.3, 0); tilt.localToWorld(burstV);
    for (let k = 0; k < n; k++) {
      const i = dustHead; emit(burstV, 0, 0, 1);
      const a = rnd() * Math.PI * 2, sp = (0.8 + rnd() * 1.8) * S;
      pVel[i * 3] = Math.cos(a) * sp; pVel[i * 3 + 1] = Math.sin(a) * sp; pVel[i * 3 + 2] = (rnd() - 0.5) * 0.6 * S;
      pCol[i * 3] = col.r * 0.8 + 0.2; pCol[i * 3 + 1] = col.g * 0.8 + 0.2; pCol[i * 3 + 2] = col.b * 0.8 + 0.2;
    }
  }

  // ---- public API ---------------------------------------------------------------------
  const api: SignalInstance = {
    wake() {
      if (disposed || mode === 'arrive' || mode === 'listen') return;
      decisionColor = null; setMode('arrive');
    },
    think() {
      if (disposed || mode === 'think') return;
      targetCol.copy(LISTEN).lerp(IDLE, 0.35); decisionColor = null; setMode('think');
    },
    respond(decision) {
      if (disposed) return;
      // Timing is driven by modeT, not setTimeout: a newer respond() restarts the hold, so an
      // older decision can never revert the lantern late.
      decisionColor = new THREE.Color(...STATE_COLORS[decision]);
      targetCol.copy(decisionColor); setMode('respond');
      burstCol.copy(decisionColor);
      spawnRing(burstCol, 5.5, 1.4);
      if (!reduced) burst(burstCol, 160);
    },
    idle() {
      if (disposed) return;
      targetCol.copy(IDLE); decisionColor = null; setMode('roam'); pickTarget();
    },
    setSpeed(n) { speedMul = Math.max(0.1, n); },
    setSize(n) { sizeMul = Math.max(0.1, n); updatePx(); },
    getMode: () => mode,
    advance(seconds) {
      const n = Math.round(seconds * 60);
      for (let i = 0; i < n; i++) step(1 / 60);
      composer.render();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      renderer.setAnimationLoop(null);
      document.removeEventListener('visibilitychange', onVisibility);
      reduceQuery?.removeEventListener?.('change', onReduce);
      observer?.disconnect(); window.removeEventListener('resize', onResize);
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose?.();
        const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
        for (const mat of mats) {
          const u = (mat as THREE.ShaderMaterial).uniforms;
          if (u?.map?.value) u.map.value.dispose?.();
          (mat as THREE.SpriteMaterial).map?.dispose?.();
          mat.dispose();
        }
      });
      glow.dispose(); ringGeo.dispose(); composer.dispose(); renderer.dispose(); renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
  let disposed = false;

  // ---- sizing, visibility, loop ---------------------------------------------------------
  function updatePx() {
    pMat.uniforms.pxScale.value = renderer.getPixelRatio() * scale() * (height / 900);
  }
  function resize() {
    const w = Math.max(1, container.clientWidth), h = Math.max(1, container.clientHeight);
    if (w === width && h === height) return;
    width = w; height = h;
    camera.aspect = w / h; camera.updateProjectionMatrix();
    renderer.setSize(w, h); composer.setSize(w, h);
    placeCenter(); updatePx();
  }
  const onResize = () => resize();
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  observer?.observe(container);
  if (!observer) window.addEventListener('resize', onResize);
  updatePx();

  let last = 0;
  const frame = (now: number) => {
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now;
    step(dt); composer.render();
  };
  const run = () => { last = performance.now(); renderer.setAnimationLoop(frame); };
  function onVisibility() { if (document.hidden) renderer.setAnimationLoop(null); else if (!disposed && !opts.manual) run(); }
  document.addEventListener('visibilitychange', onVisibility);
  if (!opts.manual && !document.hidden) run();

  return api;
}
