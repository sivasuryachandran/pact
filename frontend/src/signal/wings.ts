import * as THREE from 'three-morpho';

type Pt = [number, number];

// Outlines live in the unit box [0,1]²; the wing root is on the left edge.
function bez(p0: Pt, p1: Pt, p2: Pt, p3: Pt, n: number, out: Pt[]) {
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
}

export const foreOutline: Pt[] = [[0, 0.30]];
bez([0, 0.30], [0.20, 0.62], [0.60, 0.98], [0.97, 0.95], 40, foreOutline);
bez([0.97, 0.95], [1.02, 0.70], [0.92, 0.35], [0.80, 0.12], 40, foreOutline);
bez([0.80, 0.12], [0.55, 0.06], [0.22, 0.12], [0, 0.30], 40, foreOutline);

export const hindOutline: Pt[] = [[0, 0.80]];
bez([0, 0.80], [0.30, 0.98], [0.78, 0.92], [0.90, 0.66], 40, hindOutline);
bez([0.90, 0.66], [1.00, 0.40], [0.72, 0.02], [0.40, 0.03], 40, hindOutline);
bez([0.40, 0.03], [0.18, 0.06], [0.05, 0.40], [0, 0.80], 40, hindOutline);

/** Morpho-inspired wing painted in 2D. `rnd` keeps the scale streaks deterministic. */
export function wingTexture(kind: 'fore' | 'hind', rnd: () => number): THREE.CanvasTexture {
  const N = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  const P = kind === 'fore' ? foreOutline : hindOutline;
  const path = new Path2D();
  P.forEach(([x, y], i) => { const X = x * N, Y = (1 - y) * N; i ? path.lineTo(X, Y) : path.moveTo(X, Y); });
  path.closePath();
  g.save(); g.clip(path);
  const rx = 0, ry = (1 - (kind === 'fore' ? 0.30 : 0.80)) * N;
  const rg = g.createRadialGradient(rx, ry, 0, rx, ry, N);
  rg.addColorStop(0.00, '#0a1a5c');
  rg.addColorStop(0.12, '#1240d8');
  rg.addColorStop(0.40, '#2a7bff');
  rg.addColorStop(0.62, '#3fd2f0');
  rg.addColorStop(0.80, '#6d5cff');
  rg.addColorStop(1.00, '#2a1f6a');
  g.fillStyle = rg; g.fillRect(0, 0, N, N);
  g.globalAlpha = 0.10; g.strokeStyle = '#ffffff'; g.lineWidth = 1;
  for (let i = 0; i < 900; i++) {
    const a = rnd() * 1.4 - 0.7 + (kind === 'fore' ? 0.35 : -0.45), r0 = rnd() * N * 1.1;
    g.beginPath(); g.moveTo(rx + Math.cos(a) * r0, ry - Math.sin(a) * r0);
    g.lineTo(rx + Math.cos(a) * (r0 + 18), ry - Math.sin(a) * (r0 + 18)); g.stroke();
  }
  g.globalAlpha = 1;
  g.strokeStyle = 'rgba(8,10,40,0.55)'; g.lineWidth = 5;
  const veinAngles = kind === 'fore' ? [0.62, 0.45, 0.28, 0.10, -0.08, -0.25] : [-0.2, -0.45, -0.7, -0.95, -1.15];
  veinAngles.forEach((a) => {
    g.beginPath(); g.moveTo(rx, ry);
    g.quadraticCurveTo(rx + Math.cos(a) * N * 0.45, ry - Math.sin(a) * N * 0.38, rx + Math.cos(a) * N * 1.2, ry - Math.sin(a) * N * 1.2);
    g.stroke();
  });
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(5,6,18,0.98)'; g.lineWidth = N * 0.095; g.stroke(path);
  g.strokeStyle = 'rgba(30,30,80,0.7)'; g.lineWidth = N * 0.13; g.globalAlpha = 0.5; g.stroke(path); g.globalAlpha = 1;
  const spotIdx = kind === 'fore' ? [0.30, 0.36, 0.42, 0.48, 0.54] : [0.35, 0.45, 0.55, 0.65];
  spotIdx.forEach((u) => {
    const i = Math.floor(u * P.length), [x, y] = P[i], [x2, y2] = P[Math.max(0, i - 3)];
    const nx = -(y - y2), ny = x - x2, L = Math.hypot(nx, ny) || 1;
    const X = (x - nx / L * 0.035) * N, Y = (1 - (y - ny / L * 0.035)) * N;
    const sg = g.createRadialGradient(X, Y, 0, X, Y, N * 0.016);
    sg.addColorStop(0, 'rgba(255,250,240,1)'); sg.addColorStop(1, 'rgba(255,250,240,0)');
    g.fillStyle = sg; g.beginPath(); g.arc(X, Y, N * 0.016, 0, Math.PI * 2); g.fill();
  });
  g.restore();
  g.strokeStyle = 'rgba(140,220,255,0.9)'; g.lineWidth = 6; g.stroke(path);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  return tex;
}

/** View-dependent iridescence plus sparse glitter. */
export function wingMaterial(tex: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: tex }, time: { value: 0 } },
    transparent: true, side: THREE.DoubleSide, depthWrite: false,
    vertexShader: `
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ vUv=uv; vec4 mv=modelViewMatrix*vec4(position,1.);
        vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `
      uniform sampler2D map; uniform float time; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      float h(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
      void main(){
        vec4 t=texture2D(map,vUv); if(t.a<0.02) discard;
        float ndv=abs(dot(normalize(vN),normalize(vV)));
        float fres=pow(1.-ndv,2.0);
        vec3 iri=mix(vec3(0.15,0.45,1.0), vec3(0.25,0.95,0.95), smoothstep(0.,0.5,fres));
        iri=mix(iri, vec3(0.65,0.45,1.0), smoothstep(0.45,1.,fres));
        float blueMask=smoothstep(0.15,0.6,t.b-t.r*0.5);
        vec3 col=t.rgb*(0.85+0.15*ndv) + iri*blueMask*(0.06+0.55*fres);
        vec2 cell=floor(vUv*140.); float r=h(cell);
        float tw=pow(max(0.,sin(time*(2.+r*5.)+r*40.)),18.);
        vec2 f=fract(vUv*140.)-.5; float d=length(f);
        float sp=step(0.86,r)*tw*smoothstep(.35,.0,d);
        col+=vec3(1.0,0.97,0.9)*sp*2.2*blueMask;
        gl_FragColor=vec4(col, t.a*0.93);
        #include <colorspace_fragment>
      }`,
  });
}

export function wingMesh(outline: Pt[], tex: THREE.Texture, scale: number): THREE.Mesh {
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
  const geo = new THREE.ShapeGeometry(shape, 64);
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i), pos.getY(i));
  geo.translate(0, -outline[0][1], 0); geo.scale(scale, scale, scale);
  for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), y = pos.getY(i); pos.setZ(i, -0.06 * x * x + 0.03 * y * y); }
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, wingMaterial(tex));
}
