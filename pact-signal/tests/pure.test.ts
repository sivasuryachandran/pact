import { describe, expect, it } from 'vitest';
import { cubicBezier, durationForDistance, easeInOut, screenToNdc } from '../src/math';
import { seededRandom } from '../src/rng';
import { createStateMachine, reducedMotionEnabled } from '../src/stateMachine';
import { mergeTheme } from '../src/theme';

describe('pact-signal pure logic', () => {
  it('is deterministic for a seed', () => {
    const a = seededRandom(42); const b = seededRandom(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('clamps bezier timing and preserves endpoints', () => {
    const a = { x: 0, y: 0, z: 0 }; const d = { x: 4, y: 2, z: 1 };
    expect(cubicBezier(a, { x: 1, y: 0, z: 0 }, { x: 3, y: 2, z: 1 }, d, 0)).toEqual(a);
    expect(cubicBezier(a, { x: 1, y: 0, z: 0 }, { x: 3, y: 2, z: 1 }, d, 1)).toEqual(d);
    expect(easeInOut(-1)).toBe(0); expect(easeInOut(2)).toBe(1);
  });

  it('maps screen points to viewport NDC', () => {
    expect(screenToNdc(50, 25, { left: 0, top: 0, width: 100, height: 50 })).toEqual({ x: 0, y: 0 });
  });

  it('uses distance for bounded flight duration', () => {
    expect(durationForDistance(0)).toBe(600); expect(durationForDistance(100)).toBe(1800);
  });

  it('merges only theme values without dropping defaults', () => {
    const theme = mergeTheme({ approval: '#123456' });
    expect(theme.approval).toBe('#123456'); expect(theme.denied).toBe('#FB7185');
  });

  it('returns transient states to the current base without stale overwrite', () => {
    const machine = createStateMachine();
    expect(machine.set('wake').autoReturn).toBe(true);
    expect(machine.getBase()).toBe('idle');
    machine.set('thinking'); machine.set('allowed');
    expect(machine.getBase()).toBe('thinking');
    expect(machine.set('private').autoReturn).toBe(false);
  });

  it('honors reduced motion modes', () => {
    expect(reducedMotionEnabled('on', false)).toBe(true);
    expect(reducedMotionEnabled('off', true)).toBe(false);
    expect(reducedMotionEnabled('auto', true)).toBe(true);
  });
});
