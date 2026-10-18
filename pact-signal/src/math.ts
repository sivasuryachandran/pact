export interface Vec3 { x: number; y: number; z: number; }
export interface Viewport { left: number; top: number; width: number; height: number; }

export function cubicBezier(a: Vec3, b: Vec3, c: Vec3, d: Vec3, t: number, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  const u = 1 - t;
  const uu = u * u;
  const tt = t * t;
  const uuu = uu * u;
  const ttt = tt * t;
  out.x = uuu * a.x + 3 * uu * t * b.x + 3 * u * tt * c.x + ttt * d.x;
  out.y = uuu * a.y + 3 * uu * t * b.y + 3 * u * tt * c.y + ttt * d.y;
  out.z = uuu * a.z + 3 * uu * t * b.z + 3 * u * tt * c.z + ttt * d.z;
  return out;
}

export function easeInOut(t: number): number {
  const v = Math.min(1, Math.max(0, t));
  return v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2;
}

export function screenToNdc(x: number, y: number, viewport: Viewport): { x: number; y: number } {
  return { x: ((x - viewport.left) / viewport.width) * 2 - 1, y: 1 - ((y - viewport.top) / viewport.height) * 2 };
}

export function durationForDistance(distance: number): number {
  return Math.min(1800, Math.max(600, 600 + distance * 210));
}
