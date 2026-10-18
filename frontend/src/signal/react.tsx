import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import { createSignal } from './index';
import type { SignalInstance, SignalMode, SignalOptions } from './index';

/** Mounts a firefly in `hostRef`, disposes it on unmount, and mirrors its mode in state. */
export function useSignal(hostRef: RefObject<HTMLElement | null>, opts: Omit<SignalOptions, 'onMode'> = {}) {
  const [signal, setSignal] = useState<SignalInstance | null>(null);
  const [mode, setMode] = useState<SignalMode>('roam');
  const { size, speed, reducedMotion, manual } = opts;
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const instance = createSignal(host, { size, speed, reducedMotion, manual, onMode: setMode });
    setSignal(instance);
    return () => { instance.dispose(); setSignal(null); };
  }, [hostRef, size, speed, reducedMotion, manual]);
  return { signal, mode };
}
