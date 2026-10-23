import { useCallback, useEffect, useRef, useState } from 'react';

const WAKE = /\bhey[,.\s]+(pact|pack|packed|packt|pacts)\b[,.\s]*/i;

interface VoiceHandlers {
  /** The wake phrase was heard (or push-to-talk pressed). */
  onWake: (source: 'wake' | 'button') => void;
  /** A finished command after waking. */
  onCommand: (text: string) => void;
  /** Interim words while the person is speaking. */
  onHeard?: (text: string) => void;
  /** Recognition/provider error; the UI remains usable with typed input. */
  onError?: (message: string) => void;
  /** The listening window closed without a command. */
  onSleep?: () => void;
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
  const held = useRef(false); // true while PACT is speaking, so it never hears itself
  const [listening, setListening] = useState(false);
  const Recognition = typeof window === 'undefined' ? undefined : (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

  const sleep = useCallback(() => { awake.current = false; window.clearTimeout(awakeTimer.current); }, []);
  const timedSleep = useCallback(() => { if (awake.current) { sleep(); ref.current.onSleep?.(); } }, [sleep]);
  const wake = useCallback((source: 'wake' | 'button' = 'wake') => {
    awake.current = true; ref.current.onWake(source);
    window.clearTimeout(awakeTimer.current);
    awakeTimer.current = window.setTimeout(timedSleep, 20000);
  }, [sleep, timedSleep]);
  /** Follow-up turn: listen again without needing the wake phrase, like a real conversation. */
  const follow = useCallback((ms = 9000) => {
    if (!wantOn.current) return;
    awake.current = true; window.clearTimeout(awakeTimer.current);
    awakeTimer.current = window.setTimeout(timedSleep, ms);
  }, [timedSleep]);
  const holdTimer = useRef<number>(0);
  const spoken = useRef('');
  const releasedAt = useRef(0);
  const startRef = useRef<() => boolean>(() => false);
  /** While PACT speaks the recognizer is stopped outright, then restarted after a short pause, so it can never hear PACT. */
  const hold = useCallback((on: boolean, text = '') => {
    held.current = on; window.clearTimeout(holdTimer.current);
    if (on) {
      spoken.current = text.toLowerCase();
      window.clearTimeout(awakeTimer.current);
      try { recRef.current?.abort(); } catch { /* already stopped */ }
      holdTimer.current = window.setTimeout(() => { held.current = false; releasedAt.current = Date.now(); startRef.current(); }, 25000); // never stay deaf if a speech-end event is lost
    } else {
      releasedAt.current = Date.now();
      holdTimer.current = window.setTimeout(() => { if (wantOn.current && !recRef.current) startRef.current(); }, 700);
    }
  }, []);
  /** True when the heard words are mostly PACT's own last reply (speaker echo). */
  const isEcho = (heard: string) => {
    if (!spoken.current || Date.now() - releasedAt.current > 5000) return false;
    const words = heard.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
    if (words.length < 2) return false;
    const said = new Set(spoken.current.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/));
    return words.filter((word) => said.has(word)).length / words.length >= 0.7;
  };

  const stop = useCallback(() => { wantOn.current = false; sleep(); recRef.current?.stop(); recRef.current = null; setListening(false); }, [sleep]);
  const start = useCallback(() => {
    if (!Recognition || recRef.current) return false;
    const rec = new Recognition();
    rec.continuous = true; rec.interimResults = true; rec.lang = ref.current.lang || 'en-US';
    rec.onresult = (ev: any) => {
      if (held.current) return;
      const res = ev.results[ev.results.length - 1];
      const text = String(res[0].transcript).trim();
      if (isEcho(text)) return;
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
    rec.onend = () => { recRef.current = null; if (wantOn.current && !held.current) { try { start(); } catch { /* already starting */ } } else if (!wantOn.current) setListening(false); };
    rec.onerror = (e: any) => {
      if (e.error === 'aborted' || e.error === 'no-speech') return;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') stop();
      ref.current.onError?.(e.error || 'speech recognition unavailable');
    };
    recRef.current = rec; wantOn.current = true;
    try { rec.start(); setListening(true); return true; } catch { recRef.current = null; wantOn.current = false; return false; }
  }, [Recognition, sleep, stop, wake]);

  startRef.current = start;
  useEffect(() => stop, [stop]);
  const pushToTalk = useCallback(() => { start(); wake('button'); }, [start, wake]);
  return { supported: Boolean(Recognition), listening, start, stop, pushToTalk, endTurn: sleep, follow, hold };
}
