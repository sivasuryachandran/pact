import type * as THREE from 'three';

export type SignalState = 'idle' | 'wake' | 'listening' | 'thinking' | 'speaking' | 'approval' | 'allowed' | 'denied' | 'private';
export type SignalMode = 'roam' | 'hover';
export type ReducedMotion = 'auto' | 'on' | 'off';

export interface SignalTheme {
  idle: string;
  listening: string;
  thinking: string;
  speaking: string;
  approval: string;
  allowed: string;
  denied: string;
  private: string;
  wingStart: string;
  wingEnd: string;
}

export interface SignalHome { x?: number; y?: number; z?: number; }
export interface SignalPoint { x: number; y: number; z?: number; }
export type SignalTarget = Element | string | SignalPoint;

export interface FlyToOptions {
  arriveState?: SignalState;
  perch?: boolean;
  durationMs?: number;
}

export interface SignalOptions {
  container?: HTMLElement | string;
  zIndex?: number;
  particleCount?: number;
  theme?: Partial<SignalTheme>;
  home?: SignalHome;
  mode?: SignalMode;
  cursor?: boolean;
  bloom?: boolean;
  reducedMotion?: ReducedMotion;
  maxDpr?: number;
  seed?: number;
  avoid?: Array<Element | string>;
}

export interface SignalEventMap {
  arrive: { target: SignalTarget };
  stateChange: { from: SignalState; to: SignalState };
  error: Error;
}

export interface SignalInstance {
  setState(state: SignalState): void;
  getState(): SignalState;
  flyTo(target: SignalTarget, options?: FlyToOptions): Promise<void>;
  returnHome(): Promise<void>;
  setMode(mode: SignalMode): void;
  morph(kind: 'check' | 'lock'): Promise<void>;
  setAudioLevel(level: number): void;
  pulse(strength?: number): void;
  setTheme(theme: Partial<SignalTheme>): void;
  pause(): void;
  resume(): void;
  resize(): void;
  dispose(): void;
  on<K extends keyof SignalEventMap>(event: K, listener: (payload: SignalEventMap[K]) => void): () => void;
  readonly canvas?: HTMLCanvasElement;
}

export type ThreeInternals = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
};
