import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';
import { createSignal } from './index';
import type { SignalInstance, SignalOptions } from './types';

export interface SignalProps extends SignalOptions { className?: string; style?: CSSProperties; }

export function useSignal(options: SignalOptions = {}, hostRef?: RefObject<HTMLDivElement | null>): SignalInstance | null {
  const fallbackHost = useRef<HTMLDivElement>(null);
  const host = hostRef || fallbackHost;
  const [instance, setInstance] = useState<SignalInstance | null>(null);
  useEffect(() => {
    const target = host.current || options.container || document.body;
    const next = createSignal({ ...options, container: target as HTMLElement | string });
    setInstance(next);
    return () => { next.dispose(); setInstance(null); };
  }, []);
  return instance;
}

export function Signal({ className, style, children: _children, ...options }: SignalProps & { children?: never }) {
  const host = useRef<HTMLDivElement>(null);
  useSignal(options, host);
  return <div ref={host} className={className} style={style} aria-hidden="true" />;
}

