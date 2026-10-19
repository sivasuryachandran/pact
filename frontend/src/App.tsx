import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { decisionFromResult } from './signal/decision';
import { playPactCue } from './signal/audio';
import { useWakeVoice } from './signal/voice';
import { SettingsDrawer } from './Settings';
import { PactCoreSphere, type PactCoreState } from './PactCoreSphere';

type View = 'home' | 'rules' | 'activity' | 'about' | 'developer';
type VoiceState = 'ready' | 'listening' | 'thinking' | 'speaking' | 'approval' | 'allowed' | 'denied' | 'private';
type ApiRecord = Record<string, any>;

const money = (cents: number | undefined) => `$${((Number(cents) || 0) / 100).toFixed(0)}`;
const escapeText = (value: unknown) => String(value ?? '');
const csrfToken = () => document.cookie.split('; ').find((part) => part.startsWith('PACT_CSRF='))?.slice('PACT_CSRF='.length) || '';
const fetchJson = async (path: string, init: RequestInit = {}): Promise<ApiRecord> => {
  const response = await fetch(path, { credentials: 'same-origin', ...init, headers: { 'Content-Type': 'application/json', ...(csrfToken() ? { 'X-PACT-CSRF': csrfToken() } : {}), ...(init.headers || {}) } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
};

function CoreBackdrop({ state = 'idle' as PactCoreState }: { state?: PactCoreState }) {
  return <div className="core-backdrop" aria-hidden="true"><PactCoreSphere state={state} /></div>;
}

function PactMark({ className = '' }: { className?: string }) {
  return <span className={`pact-mark ${className}`.trim()} aria-hidden="true">
    <svg viewBox="0 0 32 32" role="presentation">
      <path className="pact-mark-half-ring" d="M16 6.2a9.8 9.8 0 0 1 0 19.6" />
      <path className="pact-mark-side-arc" d="M9.6 9.6a9 9 0 0 0 0 12.8" />
      <circle className="pact-mark-orb" cx="16" cy="16" r="6.7" />
      <circle className="pact-mark-dot" cx="16" cy="16" r="1.65" />
    </svg>
  </span>;
}

function App() {
  const [auth, setAuth] = useState<ApiRecord | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [view, setView] = useState<View>('home');
  const [state, setState] = useState<ApiRecord>({ household: { members: [] }, rules: [], receipts: { receipts: [] } });
  const [status, setStatus] = useState<ApiRecord | null>(null);
  const [voiceState, setVoiceState] = useState<VoiceState>('ready');
  const [transcript, setTranscript] = useState('Try “Plan Maya’s birthday under $150.”');
  const [commandText, setCommandText] = useState('');
  const [typedMode, setTypedMode] = useState(true);
  const [activeResult, setActiveResult] = useState<ApiRecord | null>(null);
  const [trace, setTrace] = useState<string[]>([]);
  const [muted, setMuted] = useState(false);
  const [proposalText, setProposalText] = useState('Ask me before booking anything over $100.');
  const [proposal, setProposal] = useState<ApiRecord | null>(null);
  const [privateMessage, setPrivateMessage] = useState('');
  const [demoRunning, setDemoRunning] = useState(false);
  const [error, setError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(() => window.location.hash === '#settings');
  const [brandOpen, setBrandOpen] = useState(false);
  const [prefs, setPrefs] = useState<ApiRecord>({ voice_enabled: true, language: 'en-US' });
  const [provider, setProvider] = useState<ApiRecord | null>(null);
  const [categories, setCategories] = useState<ApiRecord[]>([]);
  const [mcpWire, setMcpWire] = useState<'pending' | 'verified' | 'unavailable'>('pending');
  const conversationIdRef = useRef<string | null>(null);
  const lastSpeechRef = useRef('');
  const speakSeqRef = useRef(0);
  const mcpSessionRef = useRef<string | null>(null);

  useEffect(() => {
    if (!brandOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setBrandOpen(false); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [brandOpen]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      const button = event.target.closest('button') as HTMLButtonElement | null;
      if (!button || button.disabled) return;
      const rect = button.getBoundingClientRect();
      const x = (event.clientX - rect.left) / Math.max(1, rect.width);
      const y = (event.clientY - rect.top) / Math.max(1, rect.height);
      button.style.setProperty('--pointer-x', `${x * 100}%`);
      button.style.setProperty('--pointer-y', `${y * 100}%`);
      button.style.setProperty('--magnet-x', `${(x - 0.5) * 5}px`);
      button.style.setProperty('--magnet-y', `${(y - 0.5) * 5}px`);
    };
    document.addEventListener('pointermove', onPointerMove, { passive: true });
    return () => document.removeEventListener('pointermove', onPointerMove);
  }, []);

  useEffect(() => {
    void fetchJson('/api/auth/current').then((current) => setAuth(current)).catch(() => setAuth({ authenticated: false })).finally(() => setAuthChecked(true));
  }, []);

  const refresh = useCallback(async () => {
    if (!auth?.authenticated || !auth.session?.household_id) return;
    const [nextState, nextStatus] = await Promise.all([fetchJson('/api/state'), fetchJson('/api/status')]);
    setState(nextState); setStatus(nextStatus);
  }, [auth]);

  useEffect(() => { if (auth?.authenticated) void fetchJson('/api/activity-categories').then((r) => setCategories(r.categories || [])).catch(() => undefined); }, [auth]);

  useEffect(() => { // load preferences; fill the timezone from the browser only if nothing is saved yet
    if (!auth?.authenticated || !auth.session?.household_id) return;
    void fetchJson('/api/settings').then(async (loaded) => {
      setPrefs(loaded.settings);
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (loaded.settings.timezone.source === 'unset' && zone) setPrefs((await fetchJson('/api/settings', { method: 'POST', body: JSON.stringify({ timezone: { name: zone, source: 'auto' } }) })).settings);
    }).catch(() => undefined);
  }, [auth]);

  useEffect(() => { if (auth?.authenticated && auth.session?.household_id) refresh().catch((reason) => setError(escapeText(reason))); }, [auth, refresh]);

  const readMcpResponse = async (response: Response): Promise<ApiRecord> => {
    const text = await response.text();
    if (!response.ok) throw new Error(`MCP request failed (${response.status})`);
    if (!text.trim()) return {};
    if (response.headers.get('content-type')?.includes('application/json')) return JSON.parse(text) as ApiRecord;
    const data = text.split('\n').find((line) => line.startsWith('data:'))?.slice(5).trim();
    return data ? JSON.parse(data) as ApiRecord : {};
  };

  const verifyMcp = useCallback(async () => {
    if (!auth?.authenticated || !auth.session?.household_id) return;
    try {
      const initialize = await fetch('/mcp', { method: 'POST', credentials: 'same-origin', headers: { 'Accept': 'application/json, text/event-stream', 'Content-Type': 'application/json', 'MCP-Protocol-Version': '2025-11-25' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'PACT browser assistant', version: '0.3.0' } } }) });
      const initResult = await readMcpResponse(initialize);
      mcpSessionRef.current = initialize.headers.get('Mcp-Session-Id');
      await fetch('/mcp', { method: 'POST', credentials: 'same-origin', headers: { 'Accept': 'application/json, text/event-stream', 'Content-Type': 'application/json', 'MCP-Protocol-Version': '2025-11-25', ...(mcpSessionRef.current ? { 'Mcp-Session-Id': mcpSessionRef.current } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) });
      const toolCall = await fetch('/mcp', { method: 'POST', credentials: 'same-origin', headers: { 'Accept': 'application/json, text/event-stream', 'Content-Type': 'application/json', 'MCP-Protocol-Version': initResult.result?.protocolVersion || '2025-11-25', ...(mcpSessionRef.current ? { 'Mcp-Session-Id': mcpSessionRef.current } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_rules', arguments: {} } }) });
      const result = await readMcpResponse(toolCall);
      if (!result.result?.structuredContent && !result.result?.content) throw new Error('MCP returned no tool result');
      setMcpWire('verified');
    } catch {
      setMcpWire('unavailable');
    }
  }, [auth]);

  useEffect(() => { void verifyMcp(); }, [verifyMcp]);

  const speak = useCallback((text: string, next: VoiceState = 'ready') => {
    lastSpeechRef.current = text;
    const settle = () => {
      setVoiceState(next);
      if (next === 'allowed' || next === 'denied') window.setTimeout(() => setVoiceState('ready'), 1400);
    };
    if (muted || prefs.voice_enabled === false || !('speechSynthesis' in window)) { settle(); return; }
    const mine = ++speakSeqRef.current; // cancel() fires the old utterance's end event late; ignore it
    window.speechSynthesis.cancel(); setVoiceState('speaking');
    playPactCue(next === 'approval' ? 'approval' : next === 'allowed' ? 'approved' : next === 'denied' ? 'denied' : 'speaking');

    // Sentence-sized utterances sound conversational on browser voices: the
    // short breath between them is much less like a screen reader reading a
    // paragraph. The actual words still come from the PACT response.
    const parts = text.replace(/\s+/g, ' ').trim().match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
    const lang = String(prefs.language || 'en-US');
    const chooseVoice = () => {
      const voices = window.speechSynthesis.getVoices();
      const language = voices.filter((voice) => voice.lang.toLowerCase().startsWith(lang.toLowerCase().split('-')[0]));
      const preferred = ['samantha', 'ava', 'google us english', 'microsoft aria', 'daniel'];
      return language.find((voice) => preferred.some((name) => voice.name.toLowerCase().includes(name)))
        || language.find((voice) => voice.localService)
        || language[0]
        || voices.find((voice) => voice.localService)
        || voices[0];
    };
    const speakPart = (index: number) => {
      if (mine !== speakSeqRef.current) return;
      const utterance = new SpeechSynthesisUtterance(parts[index].trim());
      utterance.voice = chooseVoice() || null;
      utterance.lang = lang;
      utterance.rate = .88;
      utterance.pitch = 1.03;
      utterance.volume = .9;
      utterance.onend = () => {
        if (mine !== speakSeqRef.current) return;
        if (index + 1 < parts.length) window.setTimeout(() => speakPart(index + 1), 105);
        else settle();
      };
      utterance.onerror = () => { if (mine === speakSeqRef.current) settle(); };
      window.speechSynthesis.speak(utterance);
    };
    speakPart(0);
  }, [muted, prefs.voice_enabled]);

  const presentResult = useCallback(async (result: ApiRecord) => {
    setProvider(result.provider || null); setActiveResult(result); setTranscript(result.transcript?.user_text ? `You: ${result.transcript.user_text}\nPACT: ${result.assistant_text}` : result.assistant_text); setTrace(result.trace || []);
    const shown = decisionFromResult(result);
    const voice: VoiceState = shown === 'approval' ? 'approval' : shown ?? 'ready';
    speak(result.assistant_text, voice);
    await refresh();
  }, [refresh, speak]);

  const sendCommand = useCallback(async (text: string, options: { speaker_id?: string; surface?: string } = {}) => {
    const clean = text.trim(); if (!clean) return null;
    setError(''); setVoiceState('thinking'); if (!muted && prefs.voice_enabled !== false) playPactCue('thinking'); setTranscript(`You: ${clean}\nChecking household rules…`);
    try {
      const result = await fetchJson('/api/command', { method: 'POST', body: JSON.stringify({ text: clean, speaker_id: options.speaker_id || 'maya', surface: options.surface || 'living_room', conversation_id: conversationIdRef.current }) });
      conversationIdRef.current = result.conversation_id; await presentResult(result); return result;
    } catch (reason) { setError(escapeText(reason)); setVoiceState('ready'); return null; }
  }, [muted, prefs.voice_enabled, presentResult]);

  const voice = useWakeVoice({
    onWake: (source) => {
      if (source === 'wake') {
        const firstName = String(auth?.user?.display_name || 'there').split(/\s+/)[0];
        speak(`Hey ${firstName}, what can I do for you?`, 'ready');
      } else {
        setVoiceState('listening');
        if (!muted && prefs.voice_enabled !== false) playPactCue('wake');
      }
    },
    onCommand: (text) => void sendCommand(text),
    onHeard: (text) => setTranscript(`Listening… ${text}`),
    lang: prefs.language,
  });
  const micOn = voice.listening;
  useEffect(() => {
    if (view !== 'home' || !auth?.authenticated || !auth.session?.household_id || muted || prefs.voice_enabled === false || !voice.supported || micOn) return undefined;
    const timer = window.setTimeout(() => { voice.start(); }, 350);
    return () => window.clearTimeout(timer);
  }, [auth?.authenticated, auth?.session?.household_id, micOn, muted, prefs.voice_enabled, view, voice.start, voice.supported]);
  const toggleMic = () => {
    if (prefs.voice_enabled === false) { setError('Voice is switched off in Settings. Typed input is ready.'); return; }
    if (!voice.supported) { setError('Chrome speech recognition is unavailable; typed input remains ready.'); return; }
    if (micOn) { voice.stop(); setVoiceState('ready'); } else { playPactCue('listening'); voice.start(); setVoiceState('listening'); }
  };
  const toggleMute = () => {
    if (muted) { setMuted(false); if (voice.supported) window.setTimeout(() => voice.start(), 40); }
    else { setMuted(true); voice.stop(); setVoiceState('ready'); }
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
  const reset = async () => { await fetchJson('/api/reset', { method: 'POST' }); conversationIdRef.current = null; setActiveResult(null); setTrace([]); setTranscript('Try “Plan Maya’s birthday under $150.”'); await refresh(); setVoiceState('ready'); };

  const receipts = state.receipts?.receipts || [];
  const plan = activeResult?.plan || state.plans?.[state.plans.length - 1];
  const pendingApproval = activeResult?.card?.approval?.approval?.status === 'pending';
  const memberCount = state.household?.members?.length || 0;
  const modelStatus = status?.bedrock?.available ? `${status.bedrock.model_id} · ${status.bedrock.region}` : 'deterministic fallback';
  const coreState: PactCoreState = voiceState === 'ready' ? 'idle' : voiceState === 'approval' ? 'approval_required' : voiceState === 'allowed' ? 'approved' : voiceState === 'private' ? 'idle' : voiceState;

  if (!authChecked) return <div className="auth-shell"><CoreBackdrop /><div className="auth-card"><span className="eyebrow">PACT</span><h1>Loading your household…</h1></div></div>;
  if (!auth?.authenticated) return <AuthGate onAuthenticated={setAuth} />;
  if (!auth.session?.household_id) return <HouseholdOnboarding auth={auth} onAuthenticated={setAuth} />;

  const signOut = async () => { await fetchJson('/api/auth/logout', { method: 'POST' }).catch(() => undefined); setAuth({ authenticated: false }); };

  return <div className="app-shell">
    {view !== 'home' && <CoreBackdrop />}
    <header className="top-nav"><button className="wordmark" onClick={() => { setView('home'); setBrandOpen(true); }} aria-label="Open PACT brand"><img className="wordmark-mark-image" src="/static/pact-firefly-logo.png" alt="" /><span className="wordmark-name">PACT</span>{view === 'home' && <span className="wordmark-context">· SHARED HOME</span>}</button><nav aria-label="Primary navigation">{(['home', 'rules', 'activity', 'about', 'developer'] as View[]).map((item) => <button key={item} className={view === item ? 'nav-item active' : 'nav-item'} onClick={() => setView(item)}>{item[0].toUpperCase() + item.slice(1)}</button>)}</nav><div className="nav-right"><span className="live-dot" />{auth.user.display_name} · {auth.session.role}<button className="reset-link" onClick={() => setSettingsOpen(true)}>Preferences</button><button className="reset-link" onClick={signOut}>Log out</button></div></header>
    <main>
      <div className={`honesty-line ${view === 'home' ? 'home-corner-status' : ''}`}><span className="core-status"><i />PACT Core online <b>(v2.4-active)</b></span><span className="addon-status">Simulated Alexa+ add-on</span><span className="honesty-guardrails">Deterministic Guardrails: <b>ENFORCED</b></span></div>
      <AnimatePresence mode="wait"><motion.div key={view} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: .22 }}>
        {view === 'home' && <Home categories={categories} onCategory={(label: string) => void sendCommand(`Recommend ${label.toLowerCase()} near me`)} provider={provider} onSettings={() => setSettingsOpen(true)} coreState={coreState} transcript={transcript} activeResult={activeResult} plan={plan} pendingApproval={pendingApproval} memberCount={memberCount} demoRunning={demoRunning} micOn={micOn} muted={muted} voiceSupported={voice.supported} typedMode={typedMode} onToggleTyped={() => setTypedMode((value) => !value)} privateMessage={privateMessage} onMic={toggleMic} onMute={toggleMute} onReplay={() => speak(lastSpeechRef.current)} onText={(event) => setCommandText(event.target.value)} commandText={commandText} onSend={() => { const text = commandText; setCommandText(''); void sendCommand(text); }} onDemo={() => void runDemo()} onApprove={() => void approveCurrent()} onPrivate={() => void privateRoute()} />}
        {view === 'rules' && <Rules proposal={proposal} proposalText={proposalText} setProposalText={setProposalText} onPropose={() => void propose()} onConfirm={() => void confirm()} rules={state.rules || []} />}
        {view === 'activity' && <Activity receipts={receipts} />}
        {view === 'about' && <About />}
        {view === 'developer' && <Developer status={status} trace={trace} />}
      </motion.div></AnimatePresence>
      <SettingsDrawer open={settingsOpen} onClose={() => { setSettingsOpen(false); if (window.location.hash === '#settings') history.replaceState(null, '', window.location.pathname + window.location.search); }} onChange={setPrefs} onAfterReset={() => { conversationIdRef.current = null; setActiveResult(null); setProvider(null); void refresh(); }} />
      {error && <div className="error-banner" role="alert">{error}</div>}
    </main>
    {brandOpen && <BrandModal onClose={() => setBrandOpen(false)} onAbout={() => { setBrandOpen(false); setView('about'); }} />}
    <footer><span>Simulated Alexa+ add-on experience · 2026 · MIT-licensed prototype</span><span>{status ? `MCP ${status.mcp_sdk_version} · ${status.protocol?.minimum_hackathon_handshake}` : 'MCP loading…'} · {mcpWire === 'verified' ? 'browser MCP verified' : mcpWire === 'unavailable' ? 'browser MCP unavailable' : 'MCP checking…'} · Bedrock {modelStatus}</span></footer>
  </div>;
}

function BrandModal({ onClose, onAbout }: { onClose: () => void; onAbout: () => void }) {
  return <div className="brand-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="brand-modal" role="dialog" aria-modal="true" aria-labelledby="brand-modal-title">
      <button className="brand-modal-close" onClick={onClose} aria-label="Close PACT brand dialog">×</button>
      <img className="brand-modal-mark" src="/static/pact-firefly-logo.png" alt="PACT firefly core mark" />
      <div className="brand-modal-lockup"><h2 id="brand-modal-title">PACT</h2><span>Household AI that earns the right to act.</span></div>
      <p>AI proposes helpful plans. Deterministic policy, household approval, and exact-action receipts decide what can happen.</p>
      <button className="secondary-action brand-modal-action" onClick={onAbout}>About PACT</button>
    </section>
  </div>;
}

function AuthGate({ onAuthenticated }: { onAuthenticated: (value: ApiRecord) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [identifier, setIdentifier] = useState('');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      const result = mode === 'login'
        ? await fetchJson('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier, password }) })
        : await fetchJson('/api/auth/register', { method: 'POST', body: JSON.stringify({ username: identifier, email, display_name: displayName || identifier, password }) });
      onAuthenticated(result);
    } catch (reason) { setError(escapeText(reason)); } finally { setBusy(false); }
  };
  return <div className="auth-shell"><CoreBackdrop /><div className="auth-card">
    <div className="auth-brand-lockup"><img className="auth-mark-image" src="/static/pact-firefly-logo.png" alt="PACT firefly core mark" /><span>PACT · SHARED HOME</span></div>
    <h1>{mode === 'login' ? 'Welcome back.' : 'Create your PACT account.'}</h1>
    <p className="auth-copy">Your rules, preferences, approvals, and receipts stay bound to your account and household.</p>
    <form onSubmit={submit} className="auth-form">
      <label>Username or email<input autoComplete="username" value={identifier} onChange={(event) => setIdentifier(event.target.value)} required /></label>
      {mode === 'register' && <><label>Display name<input autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="How your household sees you" /></label><label>Email <span className="muted">optional</span><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label></>}
      <label>Password<input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required /></label>
      {mode === 'register' && <p className="auth-hint">Use at least 8 characters. Passwords are stored as secure scrypt hashes.</p>}
      {error && <div className="error-banner" role="alert">{error}</div>}
      <button className="primary-button auth-submit" disabled={busy}>{busy ? 'Working…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
    </form>
    <button className="auth-switch" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>{mode === 'login' ? 'New here? Create an account' : 'Already have an account? Sign in'}</button>
    <p className="auth-disclaimer">Local hackathon authentication · not production identity verification</p>
  </div></div>;
}

function HouseholdOnboarding({ auth, onAuthenticated }: { auth: ApiRecord; onAuthenticated: (value: ApiRecord) => void }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (path: string, body: ApiRecord) => {
    setError(''); setBusy(true);
    try { const result = await fetchJson(path, { method: 'POST', body: JSON.stringify(body) }); onAuthenticated(result.current || result); }
    catch (reason) { setError(escapeText(reason)); } finally { setBusy(false); }
  };
  return <div className="auth-shell"><CoreBackdrop /><div className="auth-card onboarding-card">
    <p className="eyebrow">WELCOME, {String(auth.user?.display_name || '').toUpperCase()}</p><h1>Bring your household into PACT.</h1>
    <p className="auth-copy">Create a household and invite people, or join one with a single-use invite code.</p>
    <section className="onboarding-choice"><span className="section-label">START A HOUSEHOLD</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Household name" /><button className="primary-button" disabled={busy || !name.trim()} onClick={() => void run('/api/households/create', { name })}>Create household</button></section>
    <div className="onboarding-divider"><span>or</span></div>
    <section className="onboarding-choice"><span className="section-label">JOIN BY INVITE</span><input value={code} onChange={(event) => setCode(event.target.value)} placeholder="Paste invite code" /><button className="secondary-action" disabled={busy || !code.trim()} onClick={() => void run('/api/invites/accept', { code })}>Join household</button></section>
    {error && <div className="error-banner" role="alert">{error}</div>}
    <p className="auth-disclaimer">Household membership is server-side and survives a process restart.</p>
  </div></div>;
}

function Home(props: { categories: ApiRecord[]; onCategory: (label: string) => void; provider: ApiRecord | null; onSettings: () => void; coreState: PactCoreState; transcript: string; activeResult: ApiRecord | null; plan: ApiRecord | undefined; pendingApproval: boolean; memberCount: number; demoRunning: boolean; micOn: boolean; muted: boolean; voiceSupported: boolean; typedMode: boolean; onToggleTyped: () => void; privateMessage: string; onMic: () => void; onMute: () => void; onReplay: () => void; onText: (event: ChangeEvent<HTMLInputElement>) => void; commandText: string; onSend: () => void; onDemo: () => void; onApprove: () => void; onPrivate: () => void }) {
  const stateCopy: Record<PactCoreState, { title: string; sub: string }> = {
    idle: { title: 'Say something…', sub: 'Ready' },
    listening: { title: 'I’m listening', sub: 'Mic Active' },
    thinking: { title: 'Checking household rules…', sub: 'Policy Check' },
    speaking: { title: 'PACT is speaking', sub: 'Voice Response' },
    approval_required: { title: 'Approval required', sub: 'Waiting for Dad' },
    approved: { title: 'Action approved', sub: 'Token signed' },
    denied: { title: 'Request denied safely', sub: 'Deterministic block' },
  };
  const copy = stateCopy[props.coreState];
  return <section className="home-layout home-minimal">
    <section className="home-center home-minimal-center">
      <div className={`signal-stage stage-${props.coreState}`}><PactCoreSphere state={props.coreState} /></div>
      {props.pendingApproval && <div className="hero-approval" aria-live="polite"><div><span className="section-label">APPROVAL REQUIRED</span><strong>Maya wants to book Funzone for $120.</strong><span>VenueBook · Maya’s birthday · exact action token held</span></div><button onClick={props.onApprove}>Approve exact request</button></div>}
      <span className="visually-hidden" aria-live="polite">{props.transcript}{props.provider ? ` Answered by ${props.provider.label}.` : ''}</span>
      <div className="voice-dock">
        <div className="voice-console voice-console-left" aria-label="PACT voice assistant">
          <div className="voice-console-main">
            <button className={props.micOn ? 'voice-orb-button active' : 'voice-orb-button'} onClick={props.onMic} aria-label={props.micOn ? 'Pause microphone' : 'Start microphone'}><span className="voice-orb-glyph">⌁</span><span><strong>{!props.voiceSupported ? 'Voice unavailable' : props.muted ? 'Microphone paused' : props.micOn ? 'Listening for “Hey PACT”' : 'Start voice mode'}</strong><small>{!props.voiceSupported ? 'Use typed input below' : props.micOn ? 'Say Hey PACT, then speak naturally' : 'Allow microphone access to continue'}</small></span></button>
            <button className="voice-pause" onClick={props.onMute} aria-label={props.muted ? 'Resume microphone' : props.micOn ? 'Pause microphone' : 'Enable microphone'}>{props.muted ? 'Resume' : props.micOn ? 'Pause' : 'Enable'}</button>
          </div>
          <div className="voice-console-footer"><button onClick={props.onToggleTyped}>{props.typedMode ? 'Type fallback' : 'Type instead'}</button><span>Voice-first</span></div>
        </div>
        <div className="voice-center-dock">
          <div className="signal-caption signal-status-pill" aria-live="polite"><span className="status-dot" /><strong>{copy.title}</strong><span>{copy.sub}</span></div>
          <div className="voice-transcript" aria-live="polite">{props.transcript}</div>
        </div>
        <div className="typed-chat-dock" aria-label="PACT chat fallback">
          <div className="typed-chat-heading"><span>CHAT</span><small>Text fallback</small></div>
          {props.typedMode && <div className="typed-fallback"><input aria-label="Typed PACT command" placeholder="Type a request instead…" value={props.commandText} onChange={props.onText} onKeyDown={(event) => { if (event.key === 'Enter') props.onSend(); }} /><button className="send-button" onClick={props.onSend}>Send</button></div>}
          <div className="chat-actions"><button onClick={props.onReplay} disabled={!props.activeResult}>Replay response</button><span>PACT speaks responses aloud</span></div>
        </div>
      </div>
      <div className="minimal-actions"><button onClick={() => props.onDemo()}>{props.demoRunning ? 'Running Maya’s plan…' : 'Run Maya’s birthday plan'}</button><span>AI proposes · code decides</span></div>
    </section>
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
function About() {
  return <section className="page-section about-page">
    <div className="about-brand-hero">
      <div className="about-brand-lockup"><img className="about-mark-image" src="/static/pact-firefly-logo.png" alt="PACT firefly core mark" /><span>PACT</span><span className="about-tagline-separator">—</span><span className="about-tagline">Household AI that earns the right to act.</span></div>
    </div>
    <PageIntro eyebrow="ABOUT PACT" title="Permission should be earned." body="PACT is a voice-first household assistant that lets AI propose helpful plans while deterministic code keeps authority with the people who live there." />

    <div className="about-grid about-lead-grid">
      <article className="glass-panel"><span className="section-label">THE PRODUCT PROMISE</span><h2>AI proposes. Code decides.</h2><p>Natural language can suggest a rule or action, but it never gets to authorize one. PACT validates the proposal, asks the right adult when needed, signs the exact action, and records the outcome.</p></article>
      <article className="glass-panel"><span className="section-label">A HOUSEHOLD BOUNDARY</span><h2>Permission travels with the action.</h2><p>Rules, roles, budgets, private surfaces, approvals, replay protection, and receipts stay attached to the exact simulated action across VenueBook and GiftCart.</p></article>
    </div>

    <section className="about-section">
      <div className="about-section-heading"><span className="section-label">HOW IT WORKS</span><h2>From a natural request to a verifiable receipt.</h2><p>Every step is visible. The assistant can explain a plan, but only the policy engine can produce a decision.</p></div>
      <ol className="about-flow">
        <li><span>01</span><div><strong>Speak naturally</strong><p>Ask PACT to plan, book, buy, or help with a household task.</p></div></li>
        <li><span>02</span><div><strong>AI proposes</strong><p>Bedrock or the deterministic fallback turns the request into a candidate rule or plan and reads it back.</p></div></li>
        <li><span>03</span><div><strong>PACT checks</strong><p>Schema validation, role rules, budget exposure, privacy routing, and precedence produce allow, ask, or deny.</p></div></li>
        <li><span>04</span><div><strong>A person approves</strong><p>When required, an adult approves the exact merchant, amount, device, subject, and policy version.</p></div></li>
        <li><span>05</span><div><strong>The receipt closes the loop</strong><p>Execution consumes the signed token once and records a tamper-evident sandbox receipt.</p></div></li>
      </ol>
    </section>

    <section className="about-section">
      <div className="about-section-heading"><span className="section-label">WHO DOES WHAT</span><h2>One household, different permissions.</h2><p>Identity and role are simulated in this local product demo, while the authorization decision remains code-owned.</p></div>
      <div className="about-role-grid">
        <article className="glass-panel"><span className="role-mark role-adult">A</span><h3>Adults</h3><p>Manage rules and approve permitted household actions.</p></article>
        <article className="glass-panel"><span className="role-mark role-teen">T</span><h3>Teens</h3><p>Can ask for help and request actions, but cannot approve household actions.</p></article>
        <article className="glass-panel"><span className="role-mark role-child">C</span><h3>Children</h3><p>Stay behind stricter execution boundaries for paid, private, and device actions.</p></article>
        <article className="glass-panel"><span className="role-mark role-caregiver">G</span><h3>Caregivers</h3><p>Can act only where the household has explicitly granted a matching rule.</p></article>
      </div>
    </section>

    <section className="about-section about-evidence-grid">
      <article className="glass-panel"><span className="section-label">WHAT PACT ENFORCES</span><ul className="about-list"><li>Confirmation before a rule becomes active.</li><li>Precedence: deny before ask before allow.</li><li>Exact-action HMAC tokens with expiry and replay protection.</li><li>Shared budgets, private surfaces, and receipt integrity.</li><li>The same check → approval → execute contract for every add-on.</li></ul></article>
      <article className="glass-panel"><span className="section-label">WHAT PACT DOES NOT CLAIM</span><ul className="about-list"><li>No real Alexa+ access or proprietary Alexa voice.</li><li>No real purchases, bookings, devices, or household hardware.</li><li>No production identity assurance, MFA, or OAuth.</li><li>No public hosted endpoint in this local demo.</li><li>No LLM authority over allow, ask, or deny.</li></ul></article>
    </section>

    <section className="about-section about-tour-section">
      <div className="about-section-heading"><span className="section-label">THE DEMO IN 60 SECONDS</span><h2>Maya’s birthday is the proof point.</h2></div>
      <ol className="about-tour"><li><b>Plan</b><span>“Plan Maya’s birthday under $150.”</span></li><li><b>Ask</b><span>VenueBook requests $120 and waits for Dad.</span></li><li><b>Approve</b><span>Dad approves the exact request.</span></li><li><b>Protect</b><span>GiftCart’s $40 request is denied because exposure becomes $160.</span></li><li><b>Record</b><span>The final decision and receipt remain visible to the household.</span></li></ol>
    </section>

    <section className="about-scope glass-panel"><span className="section-label">SIMULATED ALEXA+ ADD-ON</span><h2>Built for a credible demo, with honest boundaries.</h2><p>PACT is a local, self-hosted household assistant experience backed by an MCP Streamable HTTP server. The integrations, add-ons, purchases, bookings, and receipts are simulated so the permission model can be demonstrated safely.</p><div className="about-scope-meta"><span>PACT Core</span><span>Deterministic guardrails</span><span>Human approval</span><span>Tamper-evident receipts</span></div></section>
  </section>;
}
function PageIntro({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) { return <div className="page-intro"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{body}</p></div>; }

export default App;
