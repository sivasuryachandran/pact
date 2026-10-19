import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three-morpho';

export type PactCoreState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'approval_required'
  | 'approved'
  | 'denied';

type Props = { state: PactCoreState };

type VisualConfig = {
  core: string;
  halo: string;
  waveSpeed: number;
  waveAmplitude: number;
  waveFrequency: number;
  wireOpacity: number;
};

// Reference state hook imported from the downloaded Stitch Three.js scene.
// The mesh keeps its vivid violet/magenta/cyan vertex gradient; state changes
// the inner core, wire opacity, and deformation only.
const VISUALS: Record<PactCoreState, VisualConfig> = {
  idle: { core: '#4f46e5', halo: '#4f46e5', waveSpeed: 2.2, waveAmplitude: 0.14, waveFrequency: 3.4, wireOpacity: 0.92 },
  listening: { core: '#06b6d4', halo: '#22d3ee', waveSpeed: 4.4, waveAmplitude: 0.24, waveFrequency: 4.6, wireOpacity: 1 },
  thinking: { core: '#8b5cf6', halo: '#a78bfa', waveSpeed: 3, waveAmplitude: 0.18, waveFrequency: 3.8, wireOpacity: 0.95 },
  speaking: { core: '#3b82f6', halo: '#38bdf8', waveSpeed: 5.2, waveAmplitude: 0.32, waveFrequency: 5.2, wireOpacity: 1 },
  approval_required: { core: '#f59e0b', halo: '#fbbf24', waveSpeed: 2.2, waveAmplitude: 0.14, waveFrequency: 3.4, wireOpacity: 1 },
  approved: { core: '#10b981', halo: '#34d399', waveSpeed: 2.2, waveAmplitude: 0.14, waveFrequency: 3.4, wireOpacity: 1 },
  denied: { core: '#f43f5e', halo: '#fb7185', waveSpeed: 6.2, waveAmplitude: 0.28, waveFrequency: 6, wireOpacity: 1 },
};

const stateLabel = (state: PactCoreState) => state.replace('_', ' ');

/** The PACT Core is a visual renderer only; the application owns all decisions. */
export function PactCoreSphere({ state }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef(state);
  const renderOnceRef = useRef<(() => void) | null>(null);
  const [webglAvailable, setWebglAvailable] = useState(true);
  stateRef.current = state;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
    } catch {
      setWebglAvailable(false);
      return undefined;
    }
    setWebglAvailable(true);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.className = 'pact-core-canvas';
    renderer.domElement.setAttribute('aria-hidden', 'true');
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    camera.position.z = 4.8;
    const mainGroup = new THREE.Group();
    scene.add(mainGroup);

    // Adapted from the supplied Stitch implementation: high-detail organic mesh.
    const radius = 1.45;
    const detail = 68;
    const sphereGeometry = new THREE.SphereGeometry(radius, detail, detail);
    const position = sphereGeometry.attributes.position as THREE.BufferAttribute;
    const originalPosition = new Float32Array(position.array as ArrayLike<number>);
    const vertexColors = new Float32Array(position.count * 3);
    const violet = new THREE.Color('#8b5cf6');
    const magenta = new THREE.Color('#d946ef');
    const cyan = new THREE.Color('#06b6d4');
    const mixed = new THREE.Color();
    for (let index = 0; index < position.count; index += 1) {
      const y = (originalPosition[index * 3 + 1] / radius + 1) * 0.5;
      const x = (originalPosition[index * 3] / radius + 1) * 0.5;
      mixed.lerpColors(violet, magenta, y);
      if (x > 0.45) mixed.lerp(cyan, (x - 0.45) * 0.95);
      vertexColors[index * 3] = mixed.r;
      vertexColors[index * 3 + 1] = mixed.g;
      vertexColors[index * 3 + 2] = mixed.b;
    }
    sphereGeometry.setAttribute('color', new THREE.BufferAttribute(vertexColors, 3));

    const wireMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, wireframe: true, transparent: true, opacity: 0.92, blending: THREE.AdditiveBlending, depthWrite: false });
    const wireMesh = new THREE.Mesh(sphereGeometry, wireMaterial);
    mainGroup.add(wireMesh);

    const coreGeometry = new THREE.SphereGeometry(1.26, 32, 32);
    const coreMaterial = new THREE.MeshBasicMaterial({ color: VISUALS[stateRef.current].core, transparent: true, opacity: 0.38, blending: THREE.AdditiveBlending, depthWrite: false });
    const coreMesh = new THREE.Mesh(coreGeometry, coreMaterial);
    mainGroup.add(coreMesh);

    const nebulaGeometry = new THREE.SphereGeometry(1.38, 24, 24);
    const nebulaMaterial = new THREE.MeshBasicMaterial({ color: VISUALS[stateRef.current].halo, transparent: true, opacity: 0.055, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide });
    const nebulaMesh = new THREE.Mesh(nebulaGeometry, nebulaMaterial);
    mainGroup.add(nebulaMesh);

    const particleCount = 340;
    const particleGeometry = new THREE.BufferGeometry();
    const particlePositions = new Float32Array(particleCount * 3);
    const particleColors = new Float32Array(particleCount * 3);
    let seed = 0x5eedc0de;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let index = 0; index < particleCount; index += 1) {
      const particleRadius = 1.62 + random() * 0.52;
      const theta = random() * Math.PI * 2;
      const phi = Math.acos(random() * 2 - 1);
      particlePositions[index * 3] = particleRadius * Math.sin(phi) * Math.cos(theta);
      particlePositions[index * 3 + 1] = particleRadius * Math.sin(phi) * Math.sin(theta);
      particlePositions[index * 3 + 2] = particleRadius * Math.cos(phi);
      const particleColor = random() > 0.6 ? violet : random() > 0.3 ? magenta : cyan;
      particleColors[index * 3] = particleColor.r;
      particleColors[index * 3 + 1] = particleColor.g;
      particleColors[index * 3 + 2] = particleColor.b;
    }
    particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
    particleGeometry.setAttribute('color', new THREE.BufferAttribute(particleColors, 3));
    const particleMaterial = new THREE.PointsMaterial({ size: 0.042, vertexColors: true, transparent: true, opacity: 0.88, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true });
    const particles = new THREE.Points(particleGeometry, particleMaterial);
    mainGroup.add(particles);

    let reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const reduceQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    const onReduceMotion = (event: MediaQueryListEvent) => { reducedMotion = event.matches; };
    reduceQuery?.addEventListener?.('change', onReduceMotion);

    let width = 1;
    let height = 1;
    const resize = () => {
      width = Math.max(1, host.clientWidth);
      height = Math.max(1, host.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    let pointerX = 0;
    let pointerY = 0;
    const onPointerMove = (event: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      pointerX = ((event.clientX - rect.left) / Math.max(1, rect.width) - 0.5) * 0.45;
      pointerY = ((event.clientY - rect.top) / Math.max(1, rect.height) - 0.5) * 0.45;
    };
    const onPointerLeave = () => { pointerX = 0; pointerY = 0; };
    host.addEventListener('pointermove', onPointerMove, { passive: true });
    host.addEventListener('pointerleave', onPointerLeave, { passive: true });

    const clock = new THREE.Clock();
    let animationFrame = 0;
    const render = () => {
      const visual = VISUALS[stateRef.current];
      const elapsed = clock.getElapsedTime();
      coreMaterial.color.set(visual.core);
      nebulaMaterial.color.set(visual.halo);
      particleMaterial.opacity = stateRef.current === 'denied' ? 1 : 0.88;
      wireMaterial.opacity = visual.wireOpacity;
      coreMaterial.opacity = 0.38;
      nebulaMaterial.opacity = stateRef.current === 'thinking' ? 0.08 : 0.055;

      if (!reducedMotion) {
        const positions = position.array as Float32Array;
        for (let index = 0; index < position.count; index += 1) {
          const offset = index * 3;
          const x = originalPosition[offset];
          const y = originalPosition[offset + 1];
          const z = originalPosition[offset + 2];
          const wave = Math.sin(x * visual.waveFrequency + elapsed * visual.waveSpeed)
            * Math.cos(y * visual.waveFrequency + elapsed * visual.waveSpeed * 0.85)
            * Math.sin(z * visual.waveFrequency + elapsed * 1.25);
          const normal = Math.sqrt(x * x + y * y + z * z) || 1;
          const displacement = 1 + wave * visual.waveAmplitude;
          positions[offset] = (x / normal) * (radius * displacement);
          positions[offset + 1] = (y / normal) * (radius * displacement);
          positions[offset + 2] = (z / normal) * (radius * displacement);
        }
        position.needsUpdate = true;
        mainGroup.rotation.y = elapsed * 0.22 + pointerX;
        mainGroup.rotation.x = Math.sin(elapsed * 0.16) * 0.18 + pointerY;
        particles.rotation.y = -elapsed * 0.14;
      }
      renderer.render(scene, camera);
    };
    renderOnceRef.current = render;

    const animate = () => {
      render();
      if (!reducedMotion) animationFrame = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      cancelAnimationFrame(animationFrame);
      renderOnceRef.current = null;
      observer.disconnect();
      host.removeEventListener('pointermove', onPointerMove);
      host.removeEventListener('pointerleave', onPointerLeave);
      reduceQuery?.removeEventListener?.('change', onReduceMotion);
      sphereGeometry.dispose();
      coreGeometry.dispose();
      nebulaGeometry.dispose();
      particleGeometry.dispose();
      wireMaterial.dispose();
      coreMaterial.dispose();
      nebulaMaterial.dispose();
      particleMaterial.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  useEffect(() => {
    hostRef.current?.style.setProperty('--core-primary', VISUALS[state].core);
    hostRef.current?.style.setProperty('--core-secondary', VISUALS[state].core);
    hostRef.current?.style.setProperty('--core-halo', VISUALS[state].halo);
    renderOnceRef.current?.();
  }, [state]);

  return (
    <div
      ref={hostRef}
      className={`pact-core-sphere pact-core-${state}`}
      data-core-state={state}
      role="img"
      aria-label={`PACT Core sphere, ${stateLabel(state)} state`}
    >
      <span className="pact-core-fallback" aria-hidden="true" />
      {!webglAvailable && <span className="pact-core-fallback-label">PACT Core · {stateLabel(state)}</span>}
      <span className="pact-core-floor" aria-hidden="true" />
    </div>
  );
}
