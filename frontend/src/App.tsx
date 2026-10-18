import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { decisionFromResult } from './signal/decision';
import { useSignal } from './signal/react';
import { useWakeVoice } from './signal/voice';

type View = 'home' | 'rules' | 'activity' | 'developer';
type VoiceState = 'ready' | 'listening' | 'thinking' | 'speaking' | 'approval' | 'allowed' | 'denied' | 'private';
type ApiRecord = Record<string, any>;

const money = (cents: number | undefined) => `$${((Number(cents) || 0) / 100).toFixed(0)}`;
const escapeText = (value: unknown) => String(value ?? '');
const fetchJson = async (path: string, init: RequestInit = {}): Promise<ApiRecord> => {
  const response = await fetch(path, { credentials: 'same-origin', ...init, headers: { 'Content-Type': 'application/json', ...(init.headers || {}) } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
};

function App() {
  const [view, setView] = useState<View>('home');
  const [state, setState] = useState<ApiRecord>({ household: { members: [] }, rules: [], receipts: { receipts: [] } });
  const [status, setStatus] = useState<ApiRecord | null>(null);
  const [voiceState, setVoiceState] = useState<VoiceState>('ready');
  const [transcript, setTranscript] = useState('Try “Plan Maya’s birthday under $150.”');
  const [commandText, setCommandText] = useState('');
  const [activeResult, setActiveResult] = useState<ApiRecord | null>(null);
  const [trace, setTrace] = useState<string[]>([]);
  const [muted, setMuted] = useState(false);
  const [proposalText, setProposalText] = useState('Ask me before booking anything over $100.');
  const [proposal, setProposal] = useState<ApiRecord | null>(null);
  const [privateMessage, setPrivateMessage] = useState('');
  const [demoRunning, setDemoRunning] = useState(false);
  const [error, setError] = useState('');
  const hostRef = useRef<HTMLDivElement>(null);
  const { signal } = useSignal(hostRef);
  const conversationIdRef = useRef<string | null>(null);
  const lastSpeechRef = useRef('');
  const speakSeqRef = useRef(0);

  const refresh = useCallback(async () => {
    const [nextState, nextStatus] = await Promise.all([fetchJson('/api/state'), fetchJson('/api/status')]);
    setState(nextState); setStatus(nextStatus);
  }, []);

  useEffect(() => { refresh().catch((reason) => setError(escapeText(reason))); }, [refresh]);

  const speak = useCallback((text: string, next: VoiceState = 'ready') => {
    lastSpeechRef.current = text;
    if (muted || !('speechSynthesis' in window)) { setVoiceState(next); return; }
    const mine = ++speakSeqRef.current; // cancel() fires the old utterance's end event late; ignore it
    window.speechSynthesis.cancel(); setVoiceState('speaking');
    const utterance = new SpeechSynthesisUtterance(text); utterance.rate = .95; utterance.pitch = 1; utterance.volume = .82;
    utterance.onend = () => { if (mine === speakSeqRef.current) setVoiceState(next); };
    utterance.onerror = () => { if (mine === speakSeqRef.current) setVoiceState(next); };
    window.speechSynthesis.speak(utterance);
  }, [muted]);

  const presentResult = useCallback(async (result: ApiRecord) => {
    setActiveResult(result); setTranscript(result.transcript?.user_text ? `You: ${result.transcript.user_text}\nPACT: ${result.assistant_text}` : result.assistant_text); setTrace(result.trace || []);
    // The firefly shows the decision the policy engine already returned; it never decides.
    const shown = decisionFromResult(result);
    const voice: VoiceState = shown === 'approval' ? 'approval' : shown ?? 'ready';
    if (shown) signal?.respond(shown); else signal?.idle();
    speak(result.assistant_text, voice);
    await refresh();
  }, [refresh, signal, speak]);

  const sendCommand = useCallback(async (text: string, options: { speaker_id?: string; surface?: string } = {}) => {
    const clean = text.trim(); if (!clean) return null;
    setError(''); signal?.think(); setVoiceState('thinking'); setTranscript(`You: ${clean}\nChecking household rules…`);
    try {
      const result = await fetchJson('/api/command', { method: 'POST', body: JSON.stringify({ text: clean, speaker_id: options.speaker_id || 'maya', surface: options.surface || 'living_room', conversation_id: conversationIdRef.current }) });
      conversationIdRef.current = result.conversation_id; await presentResult(result); return result;
    } catch (reason) { setError(escapeText(reason)); signal?.idle(); setVoiceState('ready'); return null; }
  }, [presentResult, signal]);

  const voice = useWakeVoice({
    onWake: () => { signal?.wake(); setVoiceState('listening'); },
    onCommand: (text) => void sendCommand(text),
    onHeard: (text) => setTranscript(`Listening… ${text}`),
  });
  const micOn = voice.listening;
  const toggleMic = () => {
    if (!voice.supported) { setError('Chrome speech recognition is unavailable; typed input remains ready.'); return; }
    if (micOn) { voice.stop(); signal?.idle(); setVoiceState('ready'); } else voice.pushToTalk();
  };

  const runDemo = async () => {
    setDemoRunning(true); conversationIdRef.current = null; await fetchJson('/api/reset', { method: 'POST' }); await refresh();
    const steps = [
      ['Plan Maya’s birthday under $150.', { speaker_id: 'maya', surface: 'living_room' }],
      ['Book Funzone.', { speaker_id: 'maya', surface: 'maya_tablet' }],
      ['Dad: Approve.', { speaker_id: 'siva', surface: 'dad_phone' }],
      ['Add the decorations.', { speaker_id: 'maya', surface: 'maya_tablet' }],
    ] as const;
    for (const [text, options] of steps) { await sendCommand(text, options); await new Promise((resolve) => setTimeout(resolve, 620)); }
    setDemoRunning(false);
  };

  const propose = async () => { setError(''); try { const next = await fetchJson('/api/propose', { method: 'POST', body: JSON.stringify({ source_text: proposalText, created_by: 'siva' }) }); setProposal(next); speak(next.read_back || next.question || next.reason || 'I need more detail.'); } catch (reason) { setError(escapeText(reason)); } };
  const confirm = async () => { if (!proposal?.proposal_hash) return; try { const next = await fetchJson('/api/confirm', { method: 'POST', body: JSON.stringify({ proposal_hash: proposal.proposal_hash, confirmer: 'siva' }) }); setProposal({ ...proposal, ...next, confirmed: true }); await refresh(); speak('Rule confirmed. Code now enforces the exact rule.'); } catch (reason) { setError(escapeText(reason)); } };
  const privateRoute = async () => { const result = await sendCommand('Show the private order.', { speaker_id: 'siva', surface: 'living_room' }); if (result) setPrivateMessage(result.assistant_text); };
  const approveCurrent = async () => { if (!conversationIdRef.current) return; await sendCommand('Dad: Approve.', { speaker_id: 'siva', surface: 'dad_phone' }); };
  const reset = async () => { await fetchJson('/api/reset', { method: 'POST' }); conversationIdRef.current = null; setActiveResult(null); setTrace([]); setTranscript('Try “Plan Maya’s birthday under $150.”'); await refresh(); signal?.idle(); setVoiceState('ready'); };

  const receipts = state.receipts?.receipts || [];
  const plan = activeResult?.plan || state.plans?.[state.plans.length - 1];
  const pendingApproval = activeResult?.card?.approval?.approval?.status === 'pending';
  const memberCount = state.household?.members?.length || 0;
  const modelStatus = status?.bedrock?.available ? `${status.bedrock.model_id} · ${status.bedrock.region}` : 'deterministic fallback';

  return <div className="app-shell">
    <div className="signal-host" ref={hostRef} aria-hidden="true" />
    <header className="top-nav"><button className="wordmark" onClick={() => setView('home')} aria-label="PACT home"><span className="wordmark-mark">P</span><span>PACT</span></button><nav aria-label="Primary navigation">{(['home', 'rules', 'activity', 'developer'] as View[]).map((item) => <button key={item} className={view === item ? 'nav-item active' : 'nav-item'} onClick={() => setView(item)}>{item[0].toUpperCase() + item.slice(1)}</button>)}</nav><div className="nav-right"><span className="live-dot" />sandbox live <button className="reset-link" onClick={reset}>Reset sandbox</button></div></header>
    <main>
      <div className="honesty-line"><span>SIMULATED ALEXA+ ADD-ON EXPERIENCE</span><span>AI proposes · code decides</span></div>
      <AnimatePresence mode="wait"><motion.div key={view} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: .22 }}>
        {view === 'home' && <Home signalState={voiceState} transcript={transcript} activeResult={activeResult} plan={plan} pendingApproval={pendingApproval} memberCount={memberCount} demoRunning={demoRunning} micOn={micOn} muted={muted} privateMessage={privateMessage} onMic={toggleMic} onMute={() => setMuted((value) => !value)} onReplay={() => speak(lastSpeechRef.current)} onText={(event) => setCommandText(event.target.value)} commandText={commandText} onSend={() => { const text = commandText; setCommandText(''); void sendCommand(text); }} onDemo={() => void runDemo()} onApprove={() => void approveCurrent()} onPrivate={() => void privateRoute()} />}
        {view === 'rules' && <Rules proposal={proposal} proposalText={proposalText} setProposalText={setProposalText} onPropose={() => void propose()} onConfirm={() => void confirm()} rules={state.rules || []} />}
        {view === 'activity' && <Activity receipts={receipts} />}
        {view === 'developer' && <Developer status={status} trace={trace} />}
      </motion.div></AnimatePresence>
      {error && <div className="error-banner" role="alert">{error}</div>}
    </main>
    <footer><span>Simulated Alexa+ add-on experience · 2026 · MIT-licensed prototype</span><span>{status ? `MCP ${status.mcp_sdk_version} · ${status.protocol?.minimum_hackathon_handshake}` : 'MCP loading…'} · Bedrock {modelStatus}</span></footer>
  </div>;
}

function Home(props: { signalState: VoiceState; transcript: string; activeResult: ApiRecord | null; plan: ApiRecord | undefined; pendingApproval: boolean; memberCount: number; demoRunning: boolean; micOn: boolean; muted: boolean; privateMessage: string; onMic: () => void; onMute: () => void; onReplay: () => void; onText: (event: ChangeEvent<HTMLInputElement>) => void; commandText: string; onSend: () => void; onDemo: () => void; onApprove: () => void; onPrivate: () => void }) {
  const resultCard = props.activeResult?.card || {};
  return <section className="home-layout">
    <aside className="left-rail"><p className="eyebrow">HOUSEHOLD SIGNAL</p><div className="clock">09<span>:</span>41</div><p className="date">Saturday · October 17, 2026</p><div className="rail-title">Screens in this home</div><div className="screen-list"><Screen name="Living-room TV" detail="shared · safe summaries" tone="shared" /><Screen name="Dad’s phone" detail="private · approval" tone="private" target="dad-phone" /><Screen name="Maya’s tablet" detail="requester · teen" tone="tablet" /></div><div className="briefing"><span className="section-label">GOOD MORNING</span><strong>Trust briefing is ready.</strong><span>Sandbox data only · San Jose weather is not connected in this local build.</span></div></aside>
    <section className="home-center"><div className="home-copy"><p className="eyebrow">PACT CORE · VOICE-FIRST</p><h1>Permission,<br /><em>made visible.</em></h1><p>PACT lets a household assistant earn the right to act through exact rules, human approval, and receipts.</p></div><div className="signal-stage"><div className="signal-label"><span className={`signal-state state-${props.signalState}`}>{props.signalState === 'ready' ? 'READY' : props.signalState.toUpperCase()}</span><span>no face · only signal</span></div><div className="signal-caption">{props.signalState === 'approval' ? 'Waiting for Dad’s approval' : props.signalState === 'thinking' ? 'Checking household rules…' : props.signalState === 'speaking' ? 'PACT is speaking' : props.signalState === 'listening' ? 'I’m listening' : 'Say “Hey PACT” or type below'}</div></div><div className="caption-card" aria-live="polite"><span className="section-label">LIVE CAPTION</span><p>{props.transcript}</p></div><div className="composer"><button className={props.micOn ? 'mic-button active' : 'mic-button'} onClick={props.onMic} aria-label={props.micOn ? 'Stop listening' : 'Push to talk'}><span className="mic-glyph">◉</span>{props.micOn ? 'Listening' : 'Push to talk'}</button><input aria-label="Typed PACT command" placeholder="Typed input remains ready…" value={props.commandText} onChange={props.onText} onKeyDown={(event) => { if (event.key === 'Enter') props.onSend(); }} /><button className="send-button" onClick={props.onSend}>Send</button><button className="icon-button" onClick={props.onMute}>{props.muted ? 'Unmute' : 'Mute'}</button><button className="icon-button" onClick={props.onReplay}>Replay</button></div><div className="suggestions"><button onClick={() => props.onDemo()}>Run Maya’s birthday plan</button><button>What did PACT block?</button><button>Is anything waiting for Dad?</button></div></section>
    <aside className="right-rail"><div className="phone-card" data-target="dad-phone"><div className="phone-top"><span className="section-label">DAD’S PHONE · PRIVATE</span><span className="lock-chip">private</span></div><div className="phone-screen"><AnimatePresence mode="wait">{props.pendingApproval ? <motion.div key="approval" className="approval-card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}><span className="approval-mark">!</span><span className="section-label">APPROVAL REQUIRED</span><h3>Maya wants to book Funzone for $120.</h3><p>VenueBook · Maya’s birthday · exact action token held</p><button onClick={props.onApprove}>Approve exact request</button></motion.div> : <motion.div key="empty" className="empty-phone" initial={{ opacity: 0 }} animate={{ opacity: 1 }}><span className="phone-orb" />{props.activeResult ? <><strong>{resultCard.addon || resultCard.kind || 'PACT response'}</strong><span>{props.activeResult.assistant_text}</span></> : <><strong>Dad’s private surface</strong><span>Approval details appear here only.</span></>}</motion.div>}</AnimatePresence></div></div><div className="trace-card"><div className="card-heading"><span className="section-label">LIVE POLICY TRACE</span><span className="code-chip">REAL API</span></div><div className="trace-flow"><TraceStep label="check_action" active={props.activeResult?.trace?.includes('check_action')} /><TraceStep label="decision" active={Boolean(resultCard.decision)} /><TraceStep label="approval" active={props.pendingApproval || resultCard.kind === 'approval'} /><TraceStep label="execute" active={props.activeResult?.assistant_text?.toLowerCase().includes('executed')} /><TraceStep label="receipt" active={Boolean(props.plan?.actions?.some((item: ApiRecord) => item.status === 'executed'))} /></div></div><div className="privacy-card"><div><span className="section-label">SHARED-SCREEN ROUTING</span><strong>Private stays private.</strong></div><button onClick={props.onPrivate}>Try it</button>{props.privateMessage && <p>{props.privateMessage}</p>}</div></aside>
    <section className="plan-timeline"><div className="plan-heading"><div><p className="eyebrow">MAYA’S BIRTHDAY · LIVE PLAN</p><h2>One plan, every hold accounted for.</h2></div><button className="primary-button" disabled={props.demoRunning} onClick={props.onDemo}>{props.demoRunning ? 'Running…' : 'Run Maya’s birthday'}</button></div><div className="budget-bar"><span style={{ width: `${Math.min(100, Math.round(((props.plan?.exposure_cents || 0) / (props.plan?.budget_cents || 15000)) * 100))}%` }} /></div><div className="budget-label"><span>{money(props.plan?.exposure_cents)} committed</span><span>{money(props.plan?.budget_cents || 15000)} budget</span></div><div className="timeline-items"><TimelineItem addon="VenueBook" label="Funzone venue" amount="$120" status={props.plan?.actions?.[0]?.status || 'waiting'} /><div className="timeline-line" /><TimelineItem addon="GiftCart" label="Birthday decorations" amount="$40" status={props.plan?.actions?.[1]?.status || 'waiting'} /></div></section>
  </section>;
}

function Screen({ name, detail, tone, target }: { name: string; detail: string; tone: string; target?: string }) { return <div className={`screen-item tone-${tone}`} data-target={target}><span className="screen-icon">⌁</span><div><strong>{name}</strong><span>{detail}</span></div><i>›</i></div>; }
function TraceStep({ label, active }: { label: string; active?: boolean }) { return <div className={active ? 'trace-step active' : 'trace-step'}><span>{active ? '✓' : '·'}</span>{label}</div>; }
function TimelineItem({ addon, label, amount, status }: { addon: string; label: string; amount: string; status: string }) { const denied = status === 'denied'; return <div className={denied ? 'timeline-item denied' : 'timeline-item'}><div className="timeline-icon">{denied ? '×' : status === 'executed' || status === 'approved' ? '✓' : '·'}</div><div><span className="section-label">{addon}</span><strong>{label}</strong><span>{amount} · {status}</span></div></div>; }

function Rules({ rules, proposal, proposalText, setProposalText, onPropose, onConfirm }: { rules: ApiRecord[]; proposal: ApiRecord | null; proposalText: string; setProposalText: (value: string) => void; onPropose: () => void; onConfirm: () => void }) {
  const [preview, setPreview] = useState<ApiRecord | null>(null);
  const [trust, setTrust] = useState<ApiRecord | null>(null);
  const [earned, setEarned] = useState<ApiRecord | null>(null);
  const loadPreview = async () => { if (!proposal?.proposal_hash) return; setPreview(await fetchJson('/api/policy-preview', { method: 'POST', body: JSON.stringify({ proposal_hash: proposal.proposal_hash }) })); };
  const loadTrust = async () => { setTrust(await fetchJson('/api/trust')); setEarned(await fetchJson('/api/autonomy', { method: 'POST', body: JSON.stringify({ action: 'booking', beneficiary: 'maya', max_days: 30 }) })); };
  return <section className="page-section"><PageIntro eyebrow="RULEBOOK" title="Language proposes. Confirmation activates." body="Every candidate is read back in plain English. Only an adult confirmation makes a rule active; deterministic code owns every decision after that." /><div className="rules-grid"><div className="glass-panel composer-panel"><span className="section-label">PROPOSE A RULE</span><textarea value={proposalText} onChange={(event) => setProposalText(event.target.value)} /><button className="primary-button" onClick={onPropose}>Compile candidate</button>{proposal && <div className="candidate"><span className="status-chip violet">{proposal.status}</span><strong>{proposal.read_back || proposal.question || proposal.reason}</strong><pre>{JSON.stringify(proposal.rule || proposal, null, 2)}</pre>{proposal.status === 'candidate' && !proposal.confirmed && <button onClick={onConfirm}>Confirm exact rule</button>}{proposal.status === 'candidate' && <button className="secondary-action" onClick={() => void loadPreview()}>Preview 30-day impact</button>}{preview && <div className="impact-grid"><span><b>{preview.allowed?.length || 0}</b>allow</span><span><b>{preview.approval_required?.length || 0}</b>ask</span><span><b>{preview.denied?.length || 0}</b>deny</span></div>}</div>}</div><div className="glass-panel"><span className="section-label">CONFIRMED RULES</span>{rules.length ? rules.map((rule) => <div className="rule-row" key={rule.rule_id}><div><strong>{rule.source_text}</strong><span>AI proposed · You confirmed · Code enforces</span></div><span className={`status-chip ${rule.effect}`}>{rule.effect}</span></div>) : <p className="muted">No confirmed rules yet.</p>}<div className="trust-box"><div><span className="section-label">EARNED TRUST</span><strong>Never auto-applied.</strong></div><button className="secondary-action" onClick={() => void loadTrust()}>Review proposal</button>{trust && <span>{trust.matching_approvals || 0} matching approvals · {trust.denials || 0} denials</span>}{earned && <span className="muted">{earned.status === 'eligible' ? 'Ready for adult review.' : 'Not eligible; approvals must be earned first.'}</span>}</div></div></div></section>;
}
function Activity({ receipts }: { receipts: ApiRecord[] }) { return <section className="page-section"><PageIntro eyebrow="ACTIVITY" title="A receipt for every boundary." body="Allowed, asked, denied, private, and failed verification events stay visible without exposing protected fields on shared surfaces." /><div className="activity-list">{receipts.length ? receipts.map((receipt) => <div className="activity-row" key={receipt.receipt_hash || `${receipt.timestamp}-${receipt.action}`}><span className={`result-dot ${receipt.result}`} /><div><strong>{receipt.action || 'policy event'} · {receipt.subject_id || 'simulated household'}</strong><span>{receipt.reason || 'PACT verified the event'} · {receipt.receipt_hash?.slice(0, 18)}…</span></div><span className="status-chip">{receipt.result || 'recorded'}</span></div>) : <p className="muted">Run Maya’s plan to create real sandbox receipts.</p>}</div></section>; }
function Developer({ status, trace }: { status: ApiRecord | null; trace: string[] }) { return <section className="page-section"><PageIntro eyebrow="DEVELOPER" title="One boundary for every add-on." body="Both VenueBook and GiftCart use the same check_action → approval → execute contract. This panel is a live view of the local sandbox status." /><div className="developer-grid"><div className="glass-panel"><span className="section-label">MCP RUNTIME</span><div className="runtime-row"><strong>Streamable HTTP</strong><span>{status?.protocol?.minimum_hackathon_handshake || 'loading'}</span></div><div className="runtime-row"><strong>SDK</strong><span>{status?.mcp_sdk_version || 'loading'}</span></div><div className="runtime-row"><strong>Bedrock</strong><span>{status?.bedrock?.available ? `${status.bedrock.model_id} · ${status.bedrock.region}` : 'deterministic fallback'}</span></div><pre className="snippet">{`const decision = await pact.check_action(action);\nif (decision.decision === "ask") await pact.request_approval(action, decision.decision_token);\nawait pact.execute_action(action, decision.decision_token, approval_token);`}</pre></div><div className="glass-panel"><span className="section-label">LIVE TOOL TRACE</span>{trace.length ? trace.map((item, index) => <div className="dev-trace" key={`${item}-${index}`}><span>{String(index + 1).padStart(2, '0')}</span>{item}</div>) : <p className="muted">Use the Home command deck to populate the trace.</p>}<div className="security-proof"><strong>Adversarial suite</strong><span>240 deterministic attempts · 0 bypasses · 0 unauthorized executions</span></div></div></div></section>; }
function PageIntro({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) { return <div className="page-intro"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{body}</p></div>; }

export default App;
