import { useCallback, useEffect, useRef, useState } from 'react';

const WAKE = /\bhey[,.\s]+(pact|pack|packed|packt|pacts)\b[,.\s]*/i;

interface VoiceHandlers {
  /** The wake phrase was heard (or push-to-talk pressed). */
  onWake: (source: 'wake' | 'button') => void;
  /** A finished command after waking. */
  onCommand: (text: string) => void;
  /** Interim words while the person is speaking. */
  onHeard?: (text: string) => void;
  /** BCP-47 language for recognition, e.g. en-US. */
  lang?: string;
}

/**
 * "Hey PACT" wake phrase through the browser Web Speech API, with push-to-talk as the fallback.
 * Audio is handled by the browser; nothing is recorded or sent by PACT.
 */
export function useWakeVoice(handlers: VoiceHandlers) {
  const ref = useRef(handlers);
  ref.current = handlers;
  const recRef = useRef<any>(null);
  const awake = useRef(false);
  const wantOn = useRef(false);
  const awakeTimer = useRef<number>(0);
  const [listening, setListening] = useState(false);
  const Recognition = typeof window === 'undefined' ? undefined : (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

  const sleep = useCallback(() => { awake.current = false; window.clearTimeout(awakeTimer.current); }, []);
  const wake = useCallback((source: 'wake' | 'button' = 'wake') => {
    awake.current = true; ref.current.onWake(source);
    window.clearTimeout(awakeTimer.current);
    awakeTimer.current = window.setTimeout(sleep, 20000);
  }, [sleep]);

  const stop = useCallback(() => { wantOn.current = false; sleep(); recRef.current?.stop(); recRef.current = null; setListening(false); }, [sleep]);
  const start = useCallback(() => {
    if (!Recognition || recRef.current) return false;
    const rec = new Recognition();
    rec.continuous = true; rec.interimResults = true; rec.lang = ref.current.lang || 'en-US';
    rec.onresult = (ev: any) => {
      const res = ev.results[ev.results.length - 1];
      const text = String(res[0].transcript).trim();
      if (!awake.current) {
        const m = text.match(WAKE);
        if (!m) return;
        wake('wake');
        const rest = text.slice((m.index ?? 0) + m[0].length).trim();
        if (!rest) return;
        ref.current.onHeard?.(rest);
        if (res.isFinal) { sleep(); ref.current.onCommand(rest); }
        return;
      }
      const spoken = text.replace(WAKE, '').trim();
      ref.current.onHeard?.(spoken);
      if (res.isFinal && spoken) { sleep(); ref.current.onCommand(spoken); }
    };
    rec.onend = () => { recRef.current = null; if (wantOn.current) { try { start(); } catch { /* already starting */ } } else setListening(false); };
    rec.onerror = (e: any) => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') stop(); };
    recRef.current = rec; wantOn.current = true;
    try { rec.start(); setListening(true); return true; } catch { recRef.current = null; wantOn.current = false; return false; }
  }, [Recognition, sleep, stop, wake]);

  useEffect(() => stop, [stop]);
  const pushToTalk = useCallback(() => { start(); wake('button'); }, [start, wake]);
  return { supported: Boolean(Recognition), listening, start, stop, pushToTalk, endTurn: sleep };
}
