import type { SignalState } from './types';

export const transientStates = new Set<SignalState>(['wake', 'allowed', 'denied']);

export interface StateMachine {
  get(): SignalState;
  getBase(): SignalState;
  set(next: SignalState): { from: SignalState; to: SignalState; autoReturn: boolean };
}

export function createStateMachine(initial: SignalState = 'idle'): StateMachine {
  let state = initial;
  let base = initial === 'wake' || initial === 'allowed' || initial === 'denied' ? 'idle' : initial;
  return {
    get: () => state,
    getBase: () => base,
    set: (next) => {
      const from = state;
      if (!transientStates.has(next)) base = next;
      state = next;
      return { from, to: next, autoReturn: transientStates.has(next) };
    },
  };
}

export function reducedMotionEnabled(mode: 'auto' | 'on' | 'off', prefersReduced: boolean): boolean {
  return mode === 'on' || (mode === 'auto' && prefersReduced);
}
