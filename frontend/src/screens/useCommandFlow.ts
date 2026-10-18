import { useCallback, useRef, useState } from 'react';
import type { SignalInstance } from '../signal';
import { decisionFromResult } from '../signal/decision';
import type { Decision } from '../signal';

/**
 * Wake -> think -> respond, driven by the real engine call. The firefly is told to think while the
 * request is evaluated and to respond only with the decision the engine returned.
 */
export function useCommandFlow(signal: SignalInstance | null, surface = 'living_room') {
  const [heard, setHeard] = useState('');
  const [decision, setDecision] = useState<Decision | null>(null);
  const [error, setError] = useState('');
  const conversation = useRef<string | null>(null);
  const seq = useRef(0);

  const run = useCallback(async (text: string, speaker = 'maya') => {
    const clean = text.trim();
    if (!clean || !signal) return;
    const mine = ++seq.current;
    setHeard(clean); setError(''); setDecision(null);
    signal.think();
    try {
      const res = await fetch('/api/command', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: clean, speaker_id: speaker, surface, conversation_id: conversation.current }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
      if (mine !== seq.current) return; // a newer command already owns the firefly
      conversation.current = body.conversation_id ?? conversation.current;
      const next = decisionFromResult(body);
      setDecision(next);
      if (next) signal.respond(next); else signal.idle();
    } catch (reason) {
      if (mine !== seq.current) return;
      setError(reason instanceof Error ? reason.message : String(reason));
      signal.idle();
    }
  }, [signal, surface]);

  return { heard, setHeard, decision, setDecision, error, run };
}
