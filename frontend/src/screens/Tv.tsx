import { useEffect, useMemo, useRef, useState } from 'react';
import type { Decision, SignalInstance } from '../signal';
import { DECISION_COPY } from '../signal/decision';
import { useSignal } from '../signal/react';
import { useWakeVoice } from '../signal/voice';
import { dollars, usePlan } from './data';
import type { ItemStatus } from './data';
import { useCommandFlow } from './useCommandFlow';
import { Chrome } from './Chrome';

const chip: Record<ItemStatus, { text: string; tone: string }> = {
  waiting: { text: 'Waiting', tone: 'dim' }, asking: { text: 'Asked Dad', tone: 'amber' },
  approved: { text: 'Approved', tone: 'mint' }, denied: { text: 'Not allowed', tone: 'rose' },
};
const DEMO_ORDER: Decision[] = ['allowed', 'approval', 'denied'];

const useClock = () => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const id = window.setInterval(() => setNow(new Date()), 1000); return () => window.clearInterval(id); }, []);
  return now;
};

/** Living-room TV: clock and date on the left, the firefly across the right two thirds. */
export function Tv({ still, demo, fixture }: { still: boolean; demo: boolean; fixture: 'fresh' | 'asking' | 'resolved' | null }) {
  const host = useRef<HTMLDivElement>(null);
  const { signal, mode } = useSignal(host, { manual: still });
  const plan = usePlan(fixture);
  const now = useClock();
  const flow = useCommandFlow(signal);
  const [typed, setTyped] = useState('');
  const [shown, setShown] = useState<Decision | null>(null);
  const voice = useWakeVoice({ onWake: () => { flow.setHeard(''); signal?.wake(); }, onCommand: (t) => void flow.run(t), onHeard: flow.setHeard });

  // Mirror the decision on screen only while the firefly is displaying it.
  useEffect(() => { setShown(mode === 'respond' ? flow.decision ?? shown : null); }, [mode, flow.decision]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { // test and screenshot hook, only with ?still
    if (!still || !signal) return undefined;
    const w = window as unknown as { __signal?: SignalInstance; __setShown?: (d: Decision | null) => void };
    w.__signal = signal; w.__setShown = setShown;
    return () => { delete w.__signal; delete w.__setShown; };
  }, [still, signal]);

  useEffect(() => { // ?demo: scripted cycle through the three decisions, no keyword matching
    if (!demo || still || !signal) return undefined;
    let cycle = 0; const timers: number[] = [];
    const play = () => {
      signal.wake();
      timers.push(window.setTimeout(() => signal.think(), 5000));
      timers.push(window.setTimeout(() => { const d = DEMO_ORDER[cycle++ % 3]; setShown(d); signal.respond(d); }, 8000));
    };
    play(); const id = window.setInterval(play, 16000);
    return () => { window.clearInterval(id); timers.forEach(window.clearTimeout); };
  }, [demo, still, signal]);

  useEffect(() => {
    if (still) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.code === 'Space' && !(e.target instanceof HTMLInputElement)) { e.preventDefault(); voice.pushToTalk(); } };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [still, voice.pushToTalk]); // eslint-disable-line react-hooks/exhaustive-deps

  const time = useMemo(() => {
    const h = now.getHours(); return { clock: `${h % 12 || 12}:${String(now.getMinutes()).padStart(2, '0')}`, ampm: h >= 12 ? 'PM' : 'AM' };
  }, [now]);
  const date = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  let status = 'Say “Hey PACT”', sub = voice.listening ? 'Listening for the wake phrase' : 'Press Space or tap Hey PACT', color = '';
  if (mode === 'arrive' || mode === 'listen') { status = 'Listening…'; sub = flow.heard ? `“${flow.heard}”` : ''; }
  else if (mode === 'think') { status = 'Checking your house rules…'; sub = flow.heard ? `“${flow.heard}”` : 'The policy engine decides'; }
  else if (mode === 'respond' && shown) { status = DECISION_COPY[shown].label; sub = DECISION_COPY[shown].sub; color = DECISION_COPY[shown].color; }
  else if (flow.error) sub = flow.error;

  const pct = Math.min(100, Math.round((plan.committedCents / plan.budgetCents) * 100));
  return <div className="tv" data-mode={mode}>
    <div className="tv-signal" ref={host} aria-hidden="true" />
    <Chrome active="Home" tag="Simulated display" />
    <main className="tv-left">
      <div className="tv-time" aria-label={`${time.clock} ${time.ampm}`}>{time.clock}<small>{time.ampm}</small></div>
      <div className="tv-date">{date}</div>
      <div className="tv-status" role="status" aria-live="polite" style={color ? { color } : undefined}>{status}</div>
      <div className="tv-sub">{sub}</div>
      <section className="tv-card" aria-label="Birthday plan budget">
        <div className="card-row"><span className="mono-label">MAYA’S BIRTHDAY · BUDGET</span><span className="mono-label">{dollars(plan.budgetCents)}</span></div>
        <div className="card-big"><b>{dollars(plan.committedCents)}</b> committed</div>
        <div className="bar"><i style={{ width: `${pct}%` }} /></div>
        {(['venue', 'gift'] as const).map((key) => <div className="item-row" key={key}><span>{key === 'venue' ? 'VenueBook' : 'GiftCart'}<em>{dollars(plan[key].amountCents)}</em></span><span className={`pill ${chip[plan[key].status].tone}`}>{chip[plan[key].status].text}</span></div>)}
      </section>
      <p className="tv-note">The policy engine decides. The firefly only shows its decision.</p>
    </main>
    {!still && <div className="tv-controls">
      <button onClick={() => voice.pushToTalk()}>Hey PACT</button>
      {voice.supported && <button onClick={() => (voice.listening ? voice.stop() : voice.start())}>{voice.listening ? 'Wake phrase: on' : 'Wake phrase: off'}</button>}
      <input aria-label="Type a command" placeholder="Plan Maya’s birthday under $150" value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && typed.trim()) { void flow.run(typed); setTyped(''); } }} />
    </div>}
    <div className="screen-foot">Simulated Alexa+ add-on experience</div>
  </div>;
}
