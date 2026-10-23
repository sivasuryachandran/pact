import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { decisionFromResult } from './signal/decision';
import { playPactCue } from './signal/audio';
import { useWakeVoice } from './signal/voice';
import { SettingsDrawer } from './Settings';
import { PactCoreSphere, type PactCoreState } from './PactCoreSphere';
import QRCode from 'qrcode';
import './marketplace.css';

type View = 'home' | 'household' | 'wallet' | 'rules' | 'activity' | 'about' | 'developer' | 'profile';
type VoiceState = 'ready' | 'listening' | 'transcribing' | 'thinking' | 'speaking' | 'approval' | 'allowed' | 'denied' | 'private' | 'error';
type ApiRecord = Record<string, any>;

const money = (cents: number | undefined) => `$${((Number(cents) || 0) / 100).toFixed(0)}`;
const escapeText = (value: unknown) => String(value ?? '');
const csrfToken = () => document.cookie.split('; ').find((part) => part.startsWith('PACT_CSRF='))?.slice('PACT_CSRF='.length) || '';
const fetchJson = async (path: string, init: RequestInit = {}): Promise<ApiRecord> => {
  const response = await fetch(path, { credentials: 'same-origin', ...init, headers: { 'Content-Type': 'application/json', ...(csrfToken() ? { 'X-PACT-CSRF': csrfToken() } : {}), ...(init.headers || {}) } });
  const text = await response.text();
  let body: ApiRecord = {};
  try { body = text ? JSON.parse(text) as ApiRecord : {}; } catch { body = { error: text || `Request failed (${response.status})` }; }
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
};
const fetchJsonOptional = async (path: string, fallback: ApiRecord): Promise<ApiRecord> => {
  try { return await fetchJson(path); } catch { return fallback; }
};
const emptyWallet: ApiRecord = { members: [], cards: [], permissions: [], activity: [], receipts: [] };
const avatarStorageKey = (identity: unknown) => `pact.profile.avatar.${String(identity || 'local')}`;
const readAvatar = (identity: unknown): string | null => {
  try { return window.localStorage.getItem(avatarStorageKey(identity)); } catch { return null; }
};
const writeAvatar = (identity: unknown, value: string | null) => {
  try {
    if (value) window.localStorage.setItem(avatarStorageKey(identity), value);
    else window.localStorage.removeItem(avatarStorageKey(identity));
  } catch { /* local profile photos are best-effort and never affect auth */ }
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

function ProfileAvatar({ photo, name, className = '' }: { photo?: string | null; name?: string; className?: string }) {
  const initial = String(name || 'P').trim().slice(0, 1).toUpperCase();
  return <span className={`profile-avatar ${className}`.trim()} aria-label={`${name || 'Profile'} profile photo`}>
    {photo ? <img src={photo} alt="" /> : <span>{initial}</span>}
  </span>;
}

/** ISO timestamps are shown in the viewer's own time zone, e.g. "Oct 22, 2026, 3:34 PM". */
const formatWhen = (iso: unknown): string => {
  const date = new Date(String(iso || ''));
  return Number.isNaN(date.getTime()) ? String(iso || '') : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

const pause = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

function App() {
  const [auth, setAuth] = useState<ApiRecord | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [view, setView] = useState<View>('home');
  const [state, setState] = useState<ApiRecord>({ household: { members: [] }, rules: [], receipts: { receipts: [] }, wallet: { members: [], cards: [], permissions: [], activity: [], receipts: [] } });
  const [wallet, setWallet] = useState<ApiRecord>({ members: [], cards: [], permissions: [], activity: [], receipts: [] });
  const [catalog, setCatalog] = useState<ApiRecord[]>([]);
  const [status, setStatus] = useState<ApiRecord | null>(null);
  const [voiceState, setVoiceState] = useState<VoiceState>('ready');
  const [chat, setChat] = useState<{ who: 'you' | 'pact'; text: string }[]>([]);
  const addChat = useCallback((who: 'you' | 'pact', text: string) => setChat((items) => [...items.slice(-39), { who, text }]), []);
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
  const [mcpHandshake, setMcpHandshake] = useState<ApiRecord | null>(null);
  const [pendingPurchase, setPendingPurchase] = useState<ApiRecord | null>(null);
  const executingRef = useRef(false);
  const [ttsStatus, setTtsStatus] = useState<ApiRecord | null>(null);
  const [avatarPhoto, setAvatarPhoto] = useState<string | null>(null);
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
    const [nextState, nextStatus, nextWallet, nextCatalog] = await Promise.all([fetchJson('/api/state'), fetchJson('/api/status'), fetchJsonOptional('/api/wallet', emptyWallet), fetchJsonOptional('/api/catalog/search?q=', { products: [] })]);
    setState(nextState); setStatus(nextStatus); setWallet(nextWallet); setCatalog(nextCatalog.products || []);
  }, [auth]);

  const identityKey = auth?.user?.user_id || auth?.session?.user_id || auth?.session?.member_id || auth?.user?.username || 'local';
  const identityName = auth?.user?.display_name || auth?.session?.display_name || auth?.session?.member_id || 'Profile';
  useEffect(() => { setAvatarPhoto(readAvatar(identityKey)); }, [identityKey]);
  const handleAvatarPhotoChange = useCallback((value: string | null) => {
    setAvatarPhoto(value);
    writeAvatar(identityKey, value);
  }, [identityKey]);

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
  useEffect(() => { if (auth?.authenticated) void fetchJsonOptional('/api/voice/status', { tts: { configured_provider: 'browser', provider: 'browser' }, browser_fallback: true }).then(setTtsStatus); }, [auth]);

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
      // The browser is a real MCP client: initialize, then tools/list (observed here), then tools/call (recorded server-side).
      const listed = await readMcpResponse(await fetch('/mcp', { method: 'POST', credentials: 'same-origin', headers: { 'Accept': 'application/json, text/event-stream', 'Content-Type': 'application/json', 'MCP-Protocol-Version': initResult.result?.protocolVersion || '2025-11-25', ...(mcpSessionRef.current ? { 'Mcp-Session-Id': mcpSessionRef.current } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', id: 'tools-list', method: 'tools/list', params: {} }) }));
      setMcpHandshake({ protocol: initResult.result?.protocolVersion, server: initResult.result?.serverInfo?.name, server_version: initResult.result?.serverInfo?.version, tools: (listed.result?.tools || []).length, at: new Date().toLocaleTimeString() });
      setMcpWire('verified');
    } catch {
      setMcpWire('unavailable');
    }
  }, [auth]);

  const callMcpTool = useCallback(async (name: string, args: ApiRecord = {}): Promise<ApiRecord> => {
    if (!mcpSessionRef.current) await verifyMcp();
    const sessionId = mcpSessionRef.current;
    if (!sessionId) throw new Error('Authenticated MCP session is not ready');
    const response = await fetch('/mcp', { method: 'POST', credentials: 'same-origin', headers: { 'Accept': 'application/json, text/event-stream', 'Content-Type': 'application/json', 'MCP-Protocol-Version': '2025-11-25', 'Mcp-Session-Id': sessionId }, body: JSON.stringify({ jsonrpc: '2.0', id: `${name}-${Date.now()}`, method: 'tools/call', params: { name, arguments: args } }) });
    const wire = await readMcpResponse(response);
    if (wire.error) throw new Error(wire.error.message || `MCP tool ${name} failed`);
    if (wire.result?.isError) {
      const message = wire.result.content?.find((item: ApiRecord) => item.type === 'text')?.text;
      throw new Error(message || `MCP tool ${name} failed`);
    }
    const structured = wire.result?.structuredContent;
    if (structured) { setMcpWire('verified'); return structured as ApiRecord; }
    const textResult = wire.result?.content?.find((item: ApiRecord) => item.type === 'text')?.text;
    if (textResult) { setMcpWire('verified'); return JSON.parse(textResult) as ApiRecord; }
    throw new Error(`MCP tool ${name} returned no structured result`);
  }, [verifyMcp]);

  useEffect(() => { void verifyMcp(); }, [verifyMcp]);

  const followDepthRef = useRef(0); // consecutive turns that started from an automatic follow-up window
  const followArmedRef = useRef(false);
  const lastFollowTextRef = useRef('');
  const micRef = useRef<{ hold: (on: boolean, text?: string) => void; follow: (ms?: number) => void; listening: boolean } | null>(null);
  const speak = useCallback((text: string, next: VoiceState = 'ready') => {
    lastSpeechRef.current = text;
    const mine = ++speakSeqRef.current; // cancel() fires the old utterance's end event late; ignore it
    micRef.current?.hold(true, text); // the recognizer is stopped while PACT talks
    const settle = () => {
      setVoiceState(next);
      if (next === 'allowed' || next === 'denied') window.setTimeout(() => setVoiceState('ready'), 2600);
      // A natural pause, then PACT listens again. A question gets a longer window to answer.
      window.setTimeout(() => {
        if (mine !== speakSeqRef.current) return; // a newer utterance owns the mic
        micRef.current?.hold(false);
        if (micRef.current?.listening && next !== 'thinking' && followDepthRef.current < 2 && lastFollowTextRef.current !== text) { lastFollowTextRef.current = text; followArmedRef.current = true; micRef.current.follow(/\?\s*$/.test(text.trim()) ? 14000 : 8000); setVoiceState('listening'); }
      }, 650);
    };
    if (muted || prefs.voice_enabled === false) { settle(); return; }
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    setVoiceState('speaking');
    playPactCue(next === 'approval' ? 'approval' : next === 'allowed' ? 'approved' : next === 'denied' ? 'denied' : 'speaking');

    // Sentence-sized utterances sound conversational on browser voices: the
    // short breath between them is much less like a screen reader reading a
    // paragraph. The actual words still come from the PACT response.
    const parts = text.replace(/\s+/g, ' ').trim().match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
    const lang = String(prefs.language || 'en-US');
    const chooseVoice = () => {
      const voices = window.speechSynthesis.getVoices();
      const exact = voices.filter((voice) => voice.lang.toLowerCase().replace('_', '-') === lang.toLowerCase());
      const language = exact.length ? exact : voices.filter((voice) => voice.lang.toLowerCase().startsWith(lang.toLowerCase().split('-')[0]));
      const quality = ['premium', 'enhanced', 'natural', 'neural', 'siri'];
      const preferred = ['samantha', 'ava', 'zoe', 'google us english', 'microsoft aria', 'daniel'];
      return language.find((voice) => quality.some((name) => voice.name.toLowerCase().includes(name)))
        || language.find((voice) => preferred.some((name) => voice.name.toLowerCase().includes(name)))
        || language.find((voice) => voice.localService)
        || language[0]
        || voices.find((voice) => voice.localService)
        || voices[0];
    };
    let speakPart: (index: number) => void;
    const browserSpeak = () => {
      if (!('speechSynthesis' in window)) { settle(); return; }
      speakPart(0);
    };
    speakPart = (index: number) => {
      if (mine !== speakSeqRef.current) return;
      const utterance = new SpeechSynthesisUtterance(parts[index].trim());
      utterance.voice = chooseVoice() || null;
      utterance.lang = lang;
      utterance.rate = .8;
      utterance.pitch = 1.03;
      utterance.volume = .9;
      utterance.onend = () => {
        if (mine !== speakSeqRef.current) return;
        if (index + 1 < parts.length) window.setTimeout(() => speakPart(index + 1), 420);
        else settle();
      };
      utterance.onerror = () => { if (mine === speakSeqRef.current) settle(); };
      window.speechSynthesis.speak(utterance);
    };
    const configured = String(ttsStatus?.tts?.configured_provider || 'browser');
    if ((configured === 'polly' || configured === 'auto') && typeof Audio !== 'undefined') {
      void (async () => {
        try {
          const response = await fetch('/api/tts', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(csrfToken() ? { 'X-PACT-CSRF': csrfToken() } : {}) }, body: JSON.stringify({ text, locale: prefs.language || 'en-US', personalized: true }) });
          if (mine !== speakSeqRef.current) return;
          if (response.ok && response.headers.get('content-type')?.includes('audio')) {
            const audio = new Audio(URL.createObjectURL(await response.blob()));
            audio.onended = () => { URL.revokeObjectURL(audio.src); if (mine === speakSeqRef.current) settle(); };
            audio.onerror = () => { URL.revokeObjectURL(audio.src); if (mine === speakSeqRef.current) browserSpeak(); };
            await audio.play();
            return;
          }
        } catch { /* browser voice remains the safe fallback */ }
        if (mine === speakSeqRef.current) browserSpeak();
      })();
      return;
    }

    browserSpeak();
  }, [muted, prefs.language, prefs.voice_enabled, ttsStatus]);

  const stopSpeaking = useCallback(() => {
    speakSeqRef.current += 1;
    micRef.current?.hold(false);
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    setVoiceState('ready');
  }, []);

  const presentResult = useCallback(async (result: ApiRecord) => {
    addChat('pact', String(result.assistant_text || ''));
    setProvider(result.provider || null); setActiveResult(result); setTranscript(result.transcript?.user_text ? `You: ${result.transcript.user_text}\nPACT: ${result.assistant_text}` : result.assistant_text); setTrace(result.trace || []);
    const shown = decisionFromResult(result);
    const voice: VoiceState = shown === 'approval' ? 'approval' : shown ?? 'ready';
    speak(result.assistant_text, voice);
    await refresh();
  }, [refresh, speak, addChat]);

  const sendCommand = useCallback(async (text: string, options: { speaker_id?: string; surface?: string } = {}) => {
    const clean = text.trim(); if (!clean) return null;
    setError(''); setTranscript(`You: ${clean}`); addChat('you', clean);
    // Every turn walks the whole sphere: heard → thinking → (speaking → outcome). Each stage is held long enough to be seen.
    setVoiceState('transcribing'); await pause(700);
    setVoiceState('thinking'); if (!muted && prefs.voice_enabled !== false) playPactCue('thinking'); setTranscript(`You: ${clean}\nChecking household rules…`);
    const thinkingStarted = Date.now();
    const filler = window.setTimeout(() => speak(['One moment.', 'Let me check on that.', 'Checking the house rules.'][Math.floor(Math.random() * 3)], 'thinking'), 2600);
    try {
      const result = await fetchJson('/api/command', { method: 'POST', body: JSON.stringify({ text: clean, speaker_id: options.speaker_id || 'maya', surface: options.surface || 'living_room', conversation_id: conversationIdRef.current }) });
      conversationIdRef.current = result.conversation_id; window.clearTimeout(filler); await pause(Math.max(0, 1500 - (Date.now() - thinkingStarted))); await presentResult(result); return result;
    } catch (reason) { window.clearTimeout(filler); setError(escapeText(reason)); setVoiceState('ready'); return null; }
  }, [muted, prefs.voice_enabled, presentResult, addChat, speak]);

  const runMcpCommerce = useCallback(async (productId?: string) => {
    setError(''); setVoiceState('thinking'); setTranscript('MCP: searching the PACT Sandbox Catalog…');
    const memberId = String(auth?.session?.member_id || auth?.user?.user_id || 'current-member');
    try {
      const search = await callMcpTool('search_catalog', { query: productId || 'laptop', limit: 6 });
      const selected = (search.products || []).find((item: ApiRecord) => !productId || item.product_id === productId) || search.products?.[0];
      if (!selected?.product_id) throw new Error('MCP catalog returned no selectable product');
      setTranscript(`MCP: ${selected.title} selected · checking household rules…`);
      const productResult = await callMcpTool('get_product', { product_id: selected.product_id });
      const product = productResult.product || selected;
      const purchase = await callMcpTool('create_purchase_request', { product_id: product.product_id, quantity: 1, shipping_option: 'standard', device_id: 'browser-mcp' });
      const action = purchase.request;
      const checked = await callMcpTool('check_action', { action });
      let approvalResult: ApiRecord | null = null;
      let approvalToken: string | null = null;
      if (checked.decision === 'ask') {
        approvalResult = await callMcpTool('request_approval', { action, decision_token: checked.decision_token });
        if (auth?.session?.can_approve && auth.session.role === 'adult') {
          const approved = await callMcpTool('approve', { approval_id: approvalResult.approval?.approval_id, approver: memberId, approved: true });
          approvalResult = { ...approvalResult, ...approved };
          approvalToken = approved.approval_token || null;
        } else {
          // A member who cannot approve waits for an adult. The exact request and her own decision token stay here;
          // execution happens only after an adult approves in a separate session.
          setPendingPurchase({ product, action, decision: checked, approval_id: approvalResult.approval?.approval_id, approver: approvalResult.approval?.approver, status: 'pending', note: '' });
          setVoiceState('approval'); setTranscript(`${product.title} needs an authorized adult approval.`); await refresh(); return;
        }
      }
      if (checked.decision === 'deny') {
        await callMcpTool('get_receipts', { limit: 20 });
        setVoiceState('denied'); setTranscript(`${product.title} was denied by deterministic household policy.`); await refresh(); return;
      }
      const executed = await callMcpTool('execute_action', { action, decision_token: checked.decision_token, approval_token: approvalToken });
      const orderId = executed.order?.order_id || executed.payment?.order_id;
      const order = orderId ? await callMcpTool('get_order_status', { order_id: orderId }) : null;
      await callMcpTool('get_receipts', { limit: 20 });
      setActiveResult({ assistant_text: executed.executed ? `${product.title} completed through the authenticated MCP commerce flow.` : executed.error || 'MCP execution was refused.', mcpCommerce: true, product, decision: checked, approval: approvalResult, execution: executed, order: order?.order, trace: ['search_catalog', 'get_product', 'create_purchase_request', ...(approvalResult ? ['request_approval', 'approve'] : []), 'execute_action', ...(order ? ['get_order_status'] : []), 'get_receipts'] });
      setTrace(['search_catalog', 'get_product', 'create_purchase_request', ...(approvalResult ? ['request_approval', 'approve'] : []), 'execute_action', ...(order ? ['get_order_status'] : []), 'get_receipts']);
      setTranscript(executed.executed ? `${product.title} completed. Receipt recorded.` : executed.error || 'MCP execution was refused.');
      setVoiceState(executed.executed ? 'allowed' : 'denied');
      await refresh();
    } catch (reason) { setError(escapeText(reason)); setVoiceState('denied'); }
  }, [auth, callMcpTool, refresh]);

  const finishPurchase = useCallback(async (purchase: ApiRecord, approvalToken: string) => {
    if (executingRef.current) return;
    executingRef.current = true;   // the unchanged request is executed exactly once
    try {
      const executed = await callMcpTool('execute_action', { action: purchase.action, decision_token: purchase.decision.decision_token, approval_token: approvalToken });
      const orderId = executed.order?.order_id || executed.payment?.order_id;
      const order = orderId ? await callMcpTool('get_order_status', { order_id: orderId }) : null;
      await callMcpTool('get_receipts', { limit: 20 });
      setActiveResult({ assistant_text: executed.executed ? `${purchase.product.title} was approved by the household adult and ordered once.` : executed.error || 'Execution was refused.', mcpCommerce: true, product: purchase.product, decision: purchase.decision, approval: { approval: { status: 'approved' } }, executed, order: order?.order });
      setTrace(['search_catalog', 'get_product', 'create_purchase_request', 'check_action', 'request_approval', 'get_approval_status', 'execute_action', ...(order ? ['get_order_status'] : []), 'get_receipts']);
      setTranscript(executed.executed ? `${purchase.product.title} ordered. Receipt recorded.` : executed.error || 'Execution was refused.');
      setVoiceState(executed.executed ? 'allowed' : 'denied');
      setPendingPurchase(null);
      await refresh();
    } catch (reason) { setPendingPurchase((current) => current ? { ...current, note: escapeText(reason) } : current); }
  }, [callMcpTool, refresh]);

  useEffect(() => { // the requester polls her own approval; the token only reaches her after an adult approves
    if (!pendingPurchase?.approval_id || pendingPurchase.status !== 'pending') return undefined;
    const timer = window.setInterval(async () => {
      try {
        const status = await callMcpTool('get_approval_status', { approval_id: pendingPurchase.approval_id });
        const state = status.approval?.status;
        if (state === 'approved' && status.approval_token) { window.clearInterval(timer); setPendingPurchase((current) => current ? { ...current, status: 'approved' } : current); void finishPurchase(pendingPurchase, status.approval_token); }
        else if (state === 'rejected') { window.clearInterval(timer); setPendingPurchase((current) => current ? { ...current, status: 'rejected' } : current); setVoiceState('denied'); }
      } catch { /* keep waiting */ }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [pendingPurchase, callMcpTool, finishPurchase]);

  useEffect(() => { // adults need to see new requests from other members without reloading
    if (!auth?.authenticated || !auth.session?.household_id || !auth.session?.can_approve) return undefined;
    // One lightweight request every 4 s (about 15 per minute), only while the tab is visible, to stay far below the household rate limit.
    const timer = window.setInterval(() => { if (!document.hidden) void fetchJson('/api/state').then(setState).catch(() => undefined); }, 4000);
    return () => window.clearInterval(timer);
  }, [auth]);

  const tryApproveMyself = useCallback(async () => {
    if (!pendingPurchase) return;
    try {
      await callMcpTool('approve', { approval_id: pendingPurchase.approval_id, approver: String(auth?.session?.member_id || auth?.user?.user_id || ''), approved: true });
      setPendingPurchase({ ...pendingPurchase, note: 'Unexpectedly accepted.' });
    } catch { setPendingPurchase({ ...pendingPurchase, note: 'Refused by PACT: only an adult approver can approve this request, so you cannot approve it yourself.' }); }
  }, [pendingPurchase, callMcpTool, auth]);

  const decideApproval = useCallback(async (approvalId: string, approved: boolean) => {
    try { await callMcpTool('approve', { approval_id: approvalId, approver: String(auth?.session?.member_id || auth?.user?.user_id || ''), approved }); await refresh(); }
    catch (reason) { setError(escapeText(reason)); }
  }, [callMcpTool, auth, refresh]);

  const searchProducts = useCallback(async (query: string, filters: ApiRecord = {}) => callMcpTool('search_catalog', { query, filters, limit: 20 }), [callMcpTool]);

  const voice = useWakeVoice({
    onSleep: () => { followArmedRef.current = false; setVoiceState((current) => (current === 'listening' || current === 'transcribing' ? 'ready' : current)); },
    onWake: (source) => {
      stopSpeaking();
      if (source === 'wake') {
        const firstName = String(auth?.user?.display_name || 'there').split(/\s+/)[0];
        speak(`Hey ${firstName}. What can I do for you?`, 'ready');
      } else {
        setVoiceState('listening');
        if (!muted && prefs.voice_enabled !== false) playPactCue('wake');
      }
    },
    onCommand: (text) => {
      followDepthRef.current = followArmedRef.current ? followDepthRef.current + 1 : 0; // a person who keeps talking resets it; echo and noise cannot loop forever
      followArmedRef.current = false;
      if (text.trim().split(/\s+/).length < 2 && followDepthRef.current > 0) return;
      void sendCommand(text);
    },
    onHeard: (text) => { if (text) stopSpeaking(); setVoiceState('transcribing'); setTranscript(`Listening… ${text}`); },
    onError: (message) => { setVoiceState('error'); setError(`Voice input unavailable (${message}). Typed input remains ready.`); },
    lang: prefs.language,
  });
  const micOn = voice.listening;
  micRef.current = { hold: voice.hold, follow: voice.follow, listening: voice.listening };
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
  const coreState: PactCoreState = voiceState === 'ready' || voiceState === 'private' || voiceState === 'error' ? 'idle' : voiceState === 'approval' ? 'approval_required' : voiceState === 'allowed' ? 'approved' : voiceState === 'transcribing' ? 'listening' : voiceState === 'denied' ? 'denied' : voiceState;

  if (!authChecked) return <div className="auth-shell"><CoreBackdrop /><div className="auth-card"><span className="eyebrow">PACT</span><h1>Loading your household…</h1></div></div>;
  if (!auth?.authenticated) return <AuthGate onAuthenticated={setAuth} />;
  if (!auth.session?.household_id) return <HouseholdOnboarding auth={auth} onAuthenticated={setAuth} />;

  const signOut = async () => { await fetchJson('/api/auth/logout', { method: 'POST' }).catch(() => undefined); setAuth({ authenticated: false }); };

  return <div className="app-shell">
    {view !== 'home' && <CoreBackdrop />}
    <header className="top-nav"><button className="wordmark" onClick={() => { setView('home'); setBrandOpen(true); }} aria-label="Open PACT brand"><img className="wordmark-mark-image" src="/static/pact-firefly-mark.png" alt="" /><span className="wordmark-name pact-word">PACT</span></button><nav aria-label="Primary navigation">{(['home', 'household', 'wallet', 'rules', 'activity', 'about', 'developer'] as View[]).map((item) => <button key={item} className={view === item ? 'nav-item active' : 'nav-item'} onClick={() => setView(item)}>{item[0].toUpperCase() + item.slice(1)}</button>)}</nav><div className="nav-right"><button className={`profile-trigger ${view === 'profile' ? 'active' : ''}`} onClick={() => { setSettingsOpen(false); setView('profile'); }} aria-label={`Open ${identityName} profile Preferences`} title="Open profile and preferences"><ProfileAvatar photo={avatarPhoto} name={identityName} /><span>{identityName}</span><span className="visually-hidden">Preferences</span></button><button className="reset-link" onClick={signOut}>Log out</button></div></header>
    <main>
      <div className={`honesty-line ${view === 'home' ? 'home-corner-status' : ''}`}><span className="core-status"><i />PACT Core online <b>(v2.4-active)</b></span><span className="addon-status">Simulated Alexa+ add-on</span><span className="honesty-guardrails">Deterministic Guardrails: <b>ENFORCED</b></span></div>
      <AnimatePresence mode="wait"><motion.div key={view} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: .22 }}>
        {view === 'home' && <Home categories={categories} onCategory={(label: string) => void sendCommand(`Recommend ${label.toLowerCase()} near me`)} provider={provider} onSettings={() => setSettingsOpen(true)} coreState={coreState} voiceState={voiceState} transcript={transcript} chat={chat} activeResult={activeResult} plan={plan} pendingApproval={pendingApproval} memberCount={memberCount} demoRunning={demoRunning} micOn={micOn} muted={muted} voiceSupported={voice.supported} typedMode={typedMode} onToggleTyped={() => setTypedMode((value) => !value)} privateMessage={privateMessage} onMic={toggleMic} onMute={toggleMute} onStopSpeaking={stopSpeaking} onReplay={() => speak(lastSpeechRef.current)} onText={(event) => setCommandText(event.target.value)} commandText={commandText} onSend={() => { const text = commandText; setCommandText(''); void sendCommand(text); }} onDemo={() => void runDemo()} onApprove={() => void approveCurrent()} onPrivate={() => void privateRoute()} />}
        {view === 'household' && <HouseholdDashboard wallet={wallet} approvals={state.approvals || []} onWallet={() => setView('wallet')} auth={auth} />}
        {view === 'wallet' && <WalletPage wallet={wallet} catalog={catalog} onRefresh={refresh} canManage={Boolean(auth.session?.account_role === 'owner' || auth.session?.can_manage_rules)} onMcpPurchase={(product) => void runMcpCommerce(product.product_id)} onMcpSearch={searchProducts} />}
        {view === 'rules' && <Rules proposal={proposal} proposalText={proposalText} setProposalText={setProposalText} onPropose={() => void propose()} onConfirm={() => void confirm()} rules={state.rules || []} />}
        {view === 'activity' && <Activity handshake={mcpHandshake} receipts={receipts} walletActivity={wallet.activity || []} rules={state.rules || []} approvals={state.approvals || []} plans={state.plans || []} planActions={state.plan_actions || []} trustEvents={state.trust_events || []} mcpEvents={state.mcp_events || []} paymentOrders={state.payment_orders || {}} catalog={catalog} mcpWire={mcpWire} />}
        {view === 'about' && <About />}
        {view === 'developer' && <Developer status={status} trace={trace} />}
        {view === 'profile' && <SettingsDrawer open fullPage onClose={() => setView('home')} onChange={setPrefs} onAfterReset={() => { conversationIdRef.current = null; setActiveResult(null); setProvider(null); void refresh(); }} displayName={identityName} avatarPhoto={avatarPhoto} onAvatarPhotoChange={handleAvatarPhotoChange} />}
      </motion.div></AnimatePresence>
      {settingsOpen && view !== 'profile' && <SettingsDrawer open onClose={() => { setSettingsOpen(false); if (window.location.hash === '#settings') history.replaceState(null, '', window.location.pathname + window.location.search); }} onChange={setPrefs} onAfterReset={() => { conversationIdRef.current = null; setActiveResult(null); setProvider(null); void refresh(); }} displayName={identityName} avatarPhoto={avatarPhoto} onAvatarPhotoChange={handleAvatarPhotoChange} />}
      <ApprovalDock pending={pendingPurchase} approvals={(state.approvals || []) as ApiRecord[]} me={String(auth?.session?.member_id || auth?.user?.user_id || '')} canApprove={Boolean(auth?.session?.can_approve)} onApprove={decideApproval} onSelfApprove={tryApproveMyself} />
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
      <img className="brand-modal-mark" src="/static/pact-firefly-mark.png" alt="PACT firefly core mark" />
      <div className="brand-modal-lockup"><h2 id="brand-modal-title" className="pact-word">PACT</h2><span>Household AI that earns the right to act.</span></div>
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
    <div className="auth-brand-lockup"><img className="auth-mark-image" src="/static/pact-firefly-mark.png" alt="PACT firefly core mark" /><span className="pact-word">PACT</span></div>
    <h1 aria-label={mode === 'login' ? 'Sign in to your household.' : undefined}>{mode === 'login' ? 'Welcome back.' : 'Create your PACT account.'}</h1>
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
  const [code, setCode] = useState(() => new URLSearchParams(window.location.search).get('invite') || '');
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

function ApprovalDock({ pending, approvals, me, canApprove, onApprove, onSelfApprove }: { pending: ApiRecord | null; approvals: ApiRecord[]; me: string; canApprove: boolean; onApprove: (id: string, approved: boolean) => void; onSelfApprove: () => void }) {
  const queue = canApprove ? approvals.filter((item) => item.status === 'pending' && item.approver === me && item.bound) : [];
  if (!pending && !queue.length) return null;
  const money = (cents?: number) => `$${((Number(cents) || 0) / 100).toFixed(2)}`;
  return <div className="approval-dock" aria-live="polite">
    {pending && <section className="dock-card" aria-label="Waiting for an adult to approve">
      <span className="section-label">{pending.status === 'rejected' ? 'DECLINED' : pending.status === 'approved' ? 'APPROVED · ORDERING' : 'ASK · WAITING FOR AN ADULT'}</span>
      <strong>{pending.product?.title} · {money(pending.action?.amount_cents)}</strong>
      <p>PACT returned <b>ASK</b>. An adult must approve this exact request from their own session. You cannot approve it yourself.</p>
      {pending.status === 'pending' && <button className="secondary-action" onClick={onSelfApprove}>Try to approve it myself</button>}
      {pending.note && <p className="dock-note" role="status">{pending.note}</p>}
    </section>}
    {queue.map((item) => <section className="dock-card" key={item.approval_id} aria-label="Approval requested">
      <span className="section-label">APPROVAL REQUESTED</span>
      <strong>{item.bound.product_id} · {money(item.bound.amount_cents)} × {item.bound.quantity ?? 1}</strong>
      <dl className="bound-fields">
        <div><dt>Requested by</dt><dd>{item.bound.member_id}</dd></div><div><dt>Payment method</dt><dd>{item.bound.payment_method_id}</dd></div>
        <div><dt>Device</dt><dd>{item.bound.device_id}</dd></div><div><dt>Provider</dt><dd>{item.bound.provider} (simulated)</dd></div>
        <div><dt>Product revision</dt><dd>{item.bound.product_revision}</dd></div><div><dt>Policy version</dt><dd>{item.policy_version}</dd></div>
        <div><dt>Household</dt><dd>{item.bound.household_id}</dd></div><div><dt>Request hash</dt><dd>{String(item.request_hash).slice(0, 18)}…</dd></div>
      </dl>
      <div className="dock-actions"><button className="primary-action" onClick={() => onApprove(item.approval_id, true)}>Approve exact request</button><button className="secondary-action" onClick={() => onApprove(item.approval_id, false)}>Decline</button></div>
    </section>)}
  </div>;
}

function Home(props: { categories: ApiRecord[]; onCategory: (label: string) => void; provider: ApiRecord | null; onSettings: () => void; coreState: PactCoreState; voiceState: VoiceState; transcript: string; chat: { who: 'you' | 'pact'; text: string }[]; activeResult: ApiRecord | null; plan: ApiRecord | undefined; pendingApproval: boolean; memberCount: number; demoRunning: boolean; micOn: boolean; muted: boolean; voiceSupported: boolean; typedMode: boolean; onToggleTyped: () => void; privateMessage: string; onMic: () => void; onMute: () => void; onStopSpeaking: () => void; onReplay: () => void; onText: (event: ChangeEvent<HTMLInputElement>) => void; commandText: string; onSend: () => void; onDemo: () => void; onApprove: () => void; onPrivate: () => void }) {
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
  const voiceLabel = props.voiceState === 'transcribing' ? 'Transcribing…' : props.voiceState === 'error' ? 'Voice unavailable' : props.voiceState === 'speaking' ? 'PACT is speaking' : copy.title;
  return <section className="home-layout home-minimal">
    <section className="home-center home-minimal-center">
      <div className="product-hero-copy">
        <p className="eyebrow">HOUSEHOLD AUTHORIZATION LAYER</p>
        <h1>A family member wants to act.<span><em>PACT determines whether they can.</em></span></h1>
        <p>AI can propose the next step. PACT checks identity, rules, budgets, and human approval before anything acts.</p>
      </div>
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
          <div className="signal-caption signal-status-pill" aria-live="polite"><span className="status-dot" /><strong>{voiceLabel}</strong><span>{copy.sub}</span></div>
          <div className="voice-transcript" aria-live="polite">{props.transcript}</div>
        </div>
        <div className="typed-chat-dock" aria-label="PACT chat fallback">
          <div className="typed-chat-heading"><span>CONVERSATION</span><small>{props.chat.length ? `${props.chat.length} messages` : 'Say “Hey PACT” or type'}</small></div>
          <div className="chat-log" role="log" aria-live="polite" ref={(el) => { if (el) el.scrollTop = el.scrollHeight; }}>{props.chat.map((item, index) => <div key={index} className={`chat-bubble ${item.who}`}><b>{item.who === 'you' ? 'You' : 'PACT'}</b><span>{item.text}</span></div>)}</div>
          {props.typedMode && <div className="typed-fallback"><input aria-label="Typed PACT command" placeholder="Type a request instead…" value={props.commandText} onChange={props.onText} onKeyDown={(event) => { if (event.key === 'Enter') props.onSend(); }} /><button className="send-button" onClick={props.onSend}>Send</button></div>}
          <div className="chat-actions"><button onClick={props.onStopSpeaking} disabled={props.voiceState !== 'speaking'}>Stop speaking</button><button onClick={props.onReplay} disabled={!props.activeResult}>Replay response</button><span>PACT speaks responses aloud</span></div>
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
function QrCode({ value, label }: { value: string; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!canvas.current || !value) return;
    void QRCode.toCanvas(canvas.current, value, { width: 128, margin: 1, color: { dark: '#dbeafe', light: '#08101d' } }).catch(() => undefined);
  }, [value]);
  return <canvas ref={canvas} className="invite-qr" aria-label={label} />;
}

function ShareValue({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 1500); } catch { setCopied(false); }
  };
  return <div className="share-value"><code title={value}>{value}</code><button className="text-button" onClick={() => void copy()}>{copied ? 'Copied' : label}</button></div>;
}

function HouseholdDashboard({ wallet, approvals, onWallet, auth }: { wallet: ApiRecord; approvals: ApiRecord[]; onWallet: () => void; auth: ApiRecord }) {
  const members = (wallet.members || []) as ApiRecord[];
  const activeRules = (wallet.permissions || []).filter((item: ApiRecord) => item.active !== false).length;
  const [invites, setInvites] = useState<ApiRecord[]>([]);
  const [devices, setDevices] = useState<ApiRecord[]>([]);
  const [pairings, setPairings] = useState<ApiRecord[]>([]);
  const [invite, setInvite] = useState<ApiRecord | null>(null);
  const [pairing, setPairing] = useState<ApiRecord | null>(null);
  const [role, setRole] = useState('teen');
  const [permissionTemplate, setPermissionTemplate] = useState('limited_spending');
  const [expiresMinutes, setExpiresMinutes] = useState('1440');
  const [deviceName, setDeviceName] = useState('My browser');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const canInvite = auth.session?.account_role === 'owner' || auth.session?.account_role === 'co_parent' || (auth.session?.role === 'adult' && auth.session?.can_approve);
  const loadHouseholdSecurity = useCallback(async () => {
    const [inviteResult, deviceResult, pairingResult] = await Promise.all([
      fetchJsonOptional('/api/invites', { invites: [] }),
      fetchJsonOptional('/api/devices', { devices: [] }),
      fetchJsonOptional('/api/pairing/pending', { pairings: [] }),
    ]);
    setInvites(inviteResult.invites || []); setDevices(deviceResult.devices || []); setPairings(pairingResult.pairings || []);
  }, []);
  useEffect(() => { void loadHouseholdSecurity(); }, [loadHouseholdSecurity]);
  const createInvite = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      const result = await fetchJson('/api/invites', { method: 'POST', body: JSON.stringify({ role, permission_template: permissionTemplate, expires_minutes: Number(expiresMinutes) }) });
      setInvite(result.invite); await loadHouseholdSecurity();
    } catch (reason) { setMessage(escapeText(reason)); } finally { setBusy(false); }
  };
  const revokeInvite = async (id: string) => { setBusy(true); try { await fetchJson(`/api/invites/${encodeURIComponent(id)}`, { method: 'DELETE' }); await loadHouseholdSecurity(); } catch (reason) { setMessage(escapeText(reason)); } finally { setBusy(false); } };
  const startPairing = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage('');
    try { const result = await fetchJson('/api/pairing/start', { method: 'POST', body: JSON.stringify({ device_name: deviceName, device_type: 'browser' }) }); setPairing(result.pairing); await loadHouseholdSecurity(); }
    catch (reason) { setMessage(escapeText(reason)); } finally { setBusy(false); }
  };
  const approvePairing = async (id: string) => { setBusy(true); try { await fetchJson(`/api/pairing/${encodeURIComponent(id)}/approve`, { method: 'POST', body: '{}' }); await loadHouseholdSecurity(); } catch (reason) { setMessage(escapeText(reason)); } finally { setBusy(false); } };
  const revokeDevice = async (id: string) => { setBusy(true); try { await fetchJson(`/api/devices/${encodeURIComponent(id)}`, { method: 'DELETE' }); await loadHouseholdSecurity(); } catch (reason) { setMessage(escapeText(reason)); } finally { setBusy(false); } };
  return <section className="page-section product-page">
    <PageIntro eyebrow="HOUSEHOLD" title={wallet.household?.name || 'Your shared home'} body="See who is here, what each person can request, and where approval authority stays. Personal preferences remain private." />
    <div className="dashboard-summary"><div className="summary-card"><span className="section-label">MEMBERS</span><strong>{members.length}</strong><span>server-bound identities</span></div><div className="summary-card"><span className="section-label">ACTIVE PERMISSIONS</span><strong>{activeRules}</strong><span>deterministic wallet rules</span></div><div className="summary-card"><span className="section-label">PENDING APPROVALS</span><strong>{approvals.filter((item) => item.status === 'pending').length}</strong><span>adult review queue</span></div><button className="primary-button" onClick={onWallet}>Open wallet & permissions</button></div>
    <div className="member-grid">{members.map((member) => <article className="member-card glass-panel" key={member.id}><div className="member-card-head"><span className={`member-avatar role-${member.role}`}>{String(member.name || member.id || '?').slice(0, 1).toUpperCase()}</span><div><strong>{member.name || member.id}</strong><span>@{member.username || member.id}</span></div><span className={member.online ? 'online-chip' : 'muted-chip'}>{member.online ? 'Online' : 'Household member'}</span></div><div className="member-meta"><span>{member.role} · {member.account_role}</span><span>{member.can_approve ? 'Can approve' : 'Request only'}</span></div><div className="permission-bars"><div><span>Allow</span><b>{member.spending_access?.allow || 0}</b></div><div><span>Ask</span><b>{member.spending_access?.ask || 0}</b></div><div><span>Block</span><b>{member.spending_access?.block || 0}</b></div></div><p className="muted">{member.can_manage_rules ? 'Household owner · manages permissions' : member.can_approve ? 'Adult approval authority' : member.role === 'caregiver' ? 'Only explicitly permitted actions' : 'Can request help within household rules'}</p></article>)}</div>
    <div className="glass-panel dashboard-note"><span className="section-label">THE BOUNDARY</span><strong>PACT keeps authority with the household.</strong><span>Cards are simulated. No PAN, CVV, PIN, or real payment credential is stored.</span></div>
    {approvals.length > 0 && <div className="glass-panel dashboard-approvals"><div className="panel-heading"><div><span className="section-label">APPROVALS</span><h2>Exact requests, human decisions</h2></div><span className="muted">Use Home for the active approval card</span></div>{approvals.slice(0, 5).map((item) => <div className="wallet-event" key={item.approval_id}><span className={`result-dot ${item.status === 'approved' ? 'allowed' : item.status === 'rejected' ? 'rejected' : 'asked'}`} /><div><strong>{item.action || 'household action'} · {item.addon || 'simulated add-on'}</strong><span>{item.beneficiary || item.member_id} · required approver {item.approver}</span></div><span className="status-chip">{item.status}</span></div>)}</div>}
    <div className="household-security-grid">
      <section className="glass-panel household-security-panel" aria-labelledby="invite-member-title">
        <div className="panel-heading"><div><span className="section-label">MEMBERS</span><h2 id="invite-member-title">Invite a family member</h2></div><span className="status-chip violet">ONE-TIME CODE</span></div>
        {canInvite ? <form className="wallet-form" onSubmit={(event) => void createInvite(event)}><div className="form-row"><label>Role<select value={role} onChange={(event) => { setRole(event.target.value); setPermissionTemplate(event.target.value === 'adult' ? 'standard_adult' : event.target.value === 'child' ? 'request_only' : event.target.value === 'caregiver' ? 'caregiver_explicit' : 'limited_spending'); }}><option value="adult">Adult</option><option value="teen">Teen</option><option value="child">Child</option><option value="caregiver">Caregiver</option></select></label><label>Initial permission<select value={permissionTemplate} onChange={(event) => setPermissionTemplate(event.target.value)}><option value="standard_adult">Standard adult</option><option value="limited_spending">Limited spending</option><option value="request_only">Request only</option><option value="caregiver_explicit">Caregiver — explicit actions</option></select></label></div><label>Expires<select value={expiresMinutes} onChange={(event) => setExpiresMinutes(event.target.value)}><option value="60">1 hour</option><option value="1440">24 hours</option><option value="10080">7 days</option></select></label><button className="primary-button" disabled={busy}>Generate invite</button></form> : <p className="muted">Only the household owner or an authorized adult can invite members.</p>}
        {invite && <div className="generated-invite"><div><span className="section-label">SHARE THIS INVITE</span><strong>{invite.role} · {invite.permission_template}</strong><ShareValue value={invite.code} label="Copy code" /><ShareValue value={invite.invite_link} label="Copy link" /><small>Expires {formatWhen(invite.expires_at)}</small></div><QrCode value={invite.invite_link} label="QR code for family invite" /></div>}
        <div className="pending-list"><span className="section-label">PENDING INVITES</span>{invites.filter((item) => !item.accepted_at && !item.revoked_at).length ? invites.filter((item) => !item.accepted_at && !item.revoked_at).map((item) => <div className="pending-row" key={item.invite_id}><span><strong>{item.role}</strong><small>{item.permission_template} · expires {formatWhen(item.expires_at)}</small></span>{canInvite && <button className="text-button" disabled={busy} onClick={() => void revokeInvite(item.invite_id)}>Revoke</button>}</div>) : <p className="muted">No pending family invites.</p>}</div>
      </section>
      <section className="glass-panel household-security-panel" aria-labelledby="trusted-device-title">
        <div className="panel-heading"><div><span className="section-label">TRUSTED DEVICES</span><h2 id="trusted-device-title">Pair a household device</h2></div><span className="status-chip">ADULT APPROVAL</span></div>
        <form className="wallet-form" onSubmit={(event) => void startPairing(event)}><label>Device name<input value={deviceName} onChange={(event) => setDeviceName(event.target.value)} placeholder="Siva’s MacBook" required /></label><button className="secondary-action" disabled={busy}>Start pairing</button><small className="form-footnote">A different authorized adult must approve this browser before it becomes trusted.</small></form>
        {pairing && <div className="generated-invite"><div><span className="section-label">PAIRING REQUEST</span><strong>{pairing.device_name}</strong><ShareValue value={pairing.code} label="Copy code" /><small>Expires {formatWhen(pairing.expires_at)}</small></div><QrCode value={pairing.pairing_link} label="QR code for trusted device pairing" /></div>}
        {pairings.length > 0 && <div className="pending-list"><span className="section-label">ADULT REVIEW QUEUE</span>{pairings.map((item) => <div className="pending-row" key={item.pairing_id}><span><strong>{item.device_name}</strong><small>{item.device_type} · {item.approved_at ? 'approved' : 'awaiting approval'}</small></span>{!item.approved_at && item.requesting_user_id !== auth.session?.user_id && <button className="text-button" disabled={busy} onClick={() => void approvePairing(item.pairing_id)}>Approve</button>}</div>)}</div>}
        <div className="pending-list"><span className="section-label">TRUSTED DEVICES</span>{devices.length ? devices.map((item) => <div className="pending-row" key={item.device_id}><span><strong>{item.device_name}</strong><small>{item.device_type} · {item.revoked_at ? 'revoked' : `trusted ${formatWhen(item.trusted_at)}`}</small></span>{!item.revoked_at && <button className="text-button" disabled={busy} onClick={() => void revokeDevice(item.device_id)}>Revoke</button>}</div>) : <p className="muted">No trusted devices yet.</p>}</div>
      </section>
    </div>
    {message && <div className="error-banner" role="alert">{message}</div>}
  </section>;
}

function WalletPage({ wallet, catalog, onRefresh, canManage, onMcpPurchase, onMcpSearch }: { wallet: ApiRecord; catalog: ApiRecord[]; onRefresh: () => Promise<void>; canManage: boolean; onMcpPurchase: (product: ApiRecord) => void; onMcpSearch: (query: string, filters?: ApiRecord) => Promise<ApiRecord> }) {
  const [card, setCard] = useState<ApiRecord>({ display_name: '', brand: 'Visa', last4: '', expiry_month: 12, expiry_year: new Date().getFullYear() + 3, assigned_member_ids: [] });
  const [permission, setPermission] = useState<ApiRecord>({ member_id: '', payment_method_id: '', category: 'purchases', merchant: '', merchant_type: '', amount_limit_cents: '', period: 'one_time', decision: 'ask' });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const members = (wallet.members || []) as ApiRecord[];
  const cards = (wallet.cards || []) as ApiRecord[];
  const permissions = (wallet.permissions || []) as ApiRecord[];
  useEffect(() => { if (!permission.member_id && members[0]?.id) setPermission((value) => ({ ...value, member_id: members[0].id })); }, [members, permission.member_id]);
  const mutate = async (path: string, body: ApiRecord) => { setBusy(true); setMessage(''); try { await fetchJson(path, { method: 'POST', body: JSON.stringify(body) }); await onRefresh(); setMessage('Saved. The policy version was advanced.'); } catch (reason) { setMessage(escapeText(reason)); } finally { setBusy(false); } };
  const addCard = async (event: FormEvent) => { event.preventDefault(); await mutate('/api/wallet/cards', { ...card, expiry_month: Number(card.expiry_month), expiry_year: Number(card.expiry_year), assigned_member_ids: card.assigned_member_ids?.length ? card.assigned_member_ids : members.filter((item) => item.role === 'adult').map((item) => item.id) }); setCard({ display_name: '', brand: 'Visa', last4: '', expiry_month: 12, expiry_year: new Date().getFullYear() + 3, assigned_member_ids: [] }); };
  const addPermission = async (event: FormEvent) => { event.preventDefault(); await mutate('/api/wallet/permissions', { ...permission, amount_limit_cents: permission.amount_limit_cents === '' ? null : Number(permission.amount_limit_cents) }); };
  const revokePermission = async (permissionId: string) => { setBusy(true); try { await fetchJson(`/api/wallet/permissions/${encodeURIComponent(permissionId)}`, { method: 'DELETE' }); await onRefresh(); } catch (reason) { setMessage(escapeText(reason)); } finally { setBusy(false); } };
  return <section className="page-section product-page">
    <PageIntro eyebrow="WALLET · SIMULATED" title="Permission follows the payment method." body="Add masked demo cards and define the exact household boundaries that the deterministic policy engine will enforce." />
    {!canManage && <div className="info-banner">You can view the permissions that apply to you. Only the household owner can add cards or change rules.</div>}
    {message && <div className="info-banner" role="status">{message}</div>}
    <ProductDiscovery catalog={catalog} onSearch={onMcpSearch} onPurchase={onMcpPurchase} />
    <div className="wallet-grid">
      <div className="glass-panel wallet-panel"><div className="panel-heading"><div><span className="section-label">SIMULATED WALLET</span><h2>Masked payment methods</h2></div><span className="status-chip violet">MOCK ONLY</span></div>{cards.length ? <div className="sim-card-list">{cards.map((item) => <div className="sim-card" key={item.payment_method_id}><div className="sim-card-top"><span className="sim-card-brand">{item.brand}</span><span>SIMULATED</span></div><strong>{item.display_name}</strong><span>•••• {item.last4} · Expires {String(item.expiry_month).padStart(2, '0')}/{item.expiry_year}</span><small>{item.assigned_member_ids?.map((id: string) => members.find((member) => member.id === id)?.name || id).join(', ') || 'Household'}</small></div>)}</div> : <p className="muted">No simulated payment methods yet.</p>}{canManage && <form className="wallet-form" onSubmit={addCard}><span className="section-label">ADD MASKED CARD</span><div className="form-row"><label>Display name<input value={card.display_name} onChange={(event) => setCard({ ...card, display_name: event.target.value })} placeholder="Household card" required /></label><label>Brand<input value={card.brand} onChange={(event) => setCard({ ...card, brand: event.target.value })} required /></label></div><div className="form-row"><label>Last 4 only<input inputMode="numeric" maxLength={4} value={card.last4} onChange={(event) => setCard({ ...card, last4: event.target.value.replace(/\D/g, '') })} placeholder="4242" required /></label><label>Expiry month<input type="number" min={1} max={12} value={card.expiry_month} onChange={(event) => setCard({ ...card, expiry_month: event.target.value })} required /></label><label>Expiry year<input type="number" value={card.expiry_year} onChange={(event) => setCard({ ...card, expiry_year: event.target.value })} required /></label></div><div className="member-checks"><span>Assign to</span>{members.map((member) => <label key={member.id}><input type="checkbox" checked={card.assigned_member_ids?.includes(member.id)} onChange={(event) => setCard({ ...card, assigned_member_ids: event.target.checked ? [...(card.assigned_member_ids || []), member.id] : (card.assigned_member_ids || []).filter((id: string) => id !== member.id) })} />{member.name}</label>)}</div><button className="primary-button" disabled={busy}>Add simulated card</button><small className="form-footnote">Only brand, last four, expiry, provider reference, and household assignment are stored.</small></form>}</div>
      <div className="glass-panel wallet-panel"><div className="panel-heading"><div><span className="section-label">MEMBER PERMISSIONS</span><h2>Build a spending boundary</h2></div><span className="status-chip">ALLOW · ASK · BLOCK</span></div>{canManage && <form className="wallet-form" onSubmit={addPermission}><label>Member<select value={permission.member_id} onChange={(event) => setPermission({ ...permission, member_id: event.target.value })}>{members.map((member) => <option key={member.id} value={member.id}>{member.name} · {member.role}</option>)}</select></label><div className="form-row"><label>Decision<select value={permission.decision} onChange={(event) => setPermission({ ...permission, decision: event.target.value })}><option value="allow">Allow</option><option value="ask">Ask for approval</option><option value="block">Block</option></select></label><label>Period<select value={permission.period} onChange={(event) => setPermission({ ...permission, period: event.target.value })}><option value="one_time">One time</option><option value="day">Per day</option><option value="week">Per week</option><option value="month">Per month</option></select></label></div><div className="form-row"><label>Category<input value={permission.category} onChange={(event) => setPermission({ ...permission, category: event.target.value })} placeholder="purchases" required /></label><label>Merchant <span className="muted">optional</span><input value={permission.merchant} onChange={(event) => setPermission({ ...permission, merchant: event.target.value })} placeholder="GiftCart" /></label></div><div className="form-row"><label>Amount limit in cents<input type="number" min={0} value={permission.amount_limit_cents} onChange={(event) => setPermission({ ...permission, amount_limit_cents: event.target.value })} placeholder="5000" /></label><label>Card <span className="muted">optional</span><select value={permission.payment_method_id} onChange={(event) => setPermission({ ...permission, payment_method_id: event.target.value })}><option value="">Any registered card</option>{cards.map((item) => <option key={item.payment_method_id} value={item.payment_method_id}>{item.display_name} ·•••• {item.last4}</option>)}</select></label></div><button className="primary-button" disabled={busy || !permission.member_id}>Add permission</button></form>}{permissions.length ? <div className="permission-list">{permissions.map((item) => <div className="permission-row" key={item.permission_id}><div><strong>{members.find((member) => member.id === item.member_id)?.name || item.member_id}</strong><span>{item.category}{item.merchant ? ` · ${item.merchant}` : ''} · {item.amount_limit_cents == null ? 'no amount cap' : money(item.amount_limit_cents)} · {item.period}</span></div><div className="permission-row-end"><span className={`status-chip ${item.decision === 'block' ? 'deny' : item.decision}`}>{item.decision}</span>{canManage && item.active !== false && <button className="text-button" onClick={() => void revokePermission(item.permission_id)}>Revoke</button>}</div></div>)}</div> : <p className="muted">No permissions configured. Unknown and high-risk actions still fail safely.</p>}</div>
    </div>
    <div className="glass-panel wallet-timeline"><div className="panel-heading"><div><span className="section-label">WALLET ACTIVITY</span><h2>Changes remain visible</h2></div><span className="muted">Policy version {wallet.policy_version || 1}</span></div>{(wallet.activity || []).length ? (wallet.activity as ApiRecord[]).map((item) => <div className="wallet-event" key={item.event_id}><span className="result-dot allowed" /><div><strong>{String(item.event || '').replaceAll('_', ' ')}</strong><span>{item.display_name || item.permission_id || item.payment_method_id || 'Household wallet'} · {item.actor_id}</span></div><time>{item.timestamp}</time></div>) : <p className="muted">No wallet changes yet.</p>}</div>
  </section>;
}

function ProductDiscovery({ catalog, onSearch, onPurchase }: { catalog: ApiRecord[]; onSearch: (query: string, filters?: ApiRecord) => Promise<ApiRecord>; onPurchase: (product: ApiRecord) => void }) {
  const [query, setQuery] = useState('laptop under $1500 with at least 16GB RAM');
  const [results, setResults] = useState<ApiRecord[]>(catalog);
  const [selected, setSelected] = useState<string[]>([]);
  const [comparison, setComparison] = useState<ApiRecord | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (catalog.length && !results.length) setResults(catalog); }, [catalog, results.length]);
  const search = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      const response = await onSearch(query); setResults(response.products || []);
      setMessage(response.clarification || (response.products?.length ? `Found ${response.products.length} products. Hard requirements were applied first.` : 'No products matched every hard requirement.'));
    } catch (reason) { setMessage(escapeText(reason)); } finally { setBusy(false); }
  };
  const toggleCompare = (id: string) => setSelected((items) => items.includes(id) ? items.filter((item) => item !== id) : items.length >= 5 ? items : [...items, id]);
  const compare = async () => {
    if (selected.length < 2) return;
    setBusy(true); setMessage('');
    try { const response = await onSearch('', { compare_product_ids: selected }); setComparison(response.comparison || null); } catch (reason) { setMessage(escapeText(reason)); } finally { setBusy(false); }
  };
  return <div className="glass-panel marketplace-panel discovery-panel">
    <div className="panel-heading"><div><span className="section-label">PACT SANDBOX CATALOG</span><h2>Choose a product, then let PACT decide.</h2><p className="muted discovery-kicker">Find a laptop. Let PACT control the order.</p></div><span className="status-chip violet">MCP DISCOVERY</span></div>
    <p className="muted">Search is deterministic: hard requirements filter first, then transparent fit scores rank the simulated catalog. Product evidence never authorizes a purchase.</p>
    <form className="discovery-search" onSubmit={search}><input aria-label="Product request" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Try: lightweight laptop under $1500 with 16GB RAM" /><button className="primary-button" disabled={busy}>Search</button></form>
    <div className="discovery-meta"><span>PACT Sandbox Catalog · simulated availability</span><span>{message || 'Review evidence is shown only when supplied by the provider.'}</span></div>
    <div className="discovery-actions"><button className="secondary-action" disabled={selected.length < 2 || busy} onClick={() => void compare()}>Compare {selected.length || ''}</button><span>{selected.length ? 'Select two to five products for a structured comparison.' : 'Choose Compare on product cards to compare.'}</span></div>
    <div className="marketplace-grid discovery-grid">{results.map((item) => <article className="marketplace-card discovery-card" key={item.product_id}><div className="discovery-card-top"><span className="section-label">{String(item.category || 'product').toUpperCase()}</span><span className={`availability-badge ${item.availability === 'in_stock' ? 'in-stock' : item.availability === 'out_of_stock' ? 'out-stock' : 'unknown'}`}>{item.availability === 'in_stock' ? 'In stock' : item.availability === 'out_of_stock' ? 'Out of stock' : 'Availability unknown'}</span></div><strong>{item.title}</strong><span>{item.description}</span><b>{money(Number(item.price_cents ?? item.amount_cents))} · {item.currency} · fit {item.fit_score ?? '—'}</b><span className="spec-line">{item.specifications ? `${item.specifications.ram_gb}GB RAM · ${item.specifications.storage_gb}GB · ${item.specifications.weight_lbs}lb · ${item.specifications.operating_system}` : 'Provider metadata available'}</span><small>{item.rating ? `Rating ${item.rating} from ${item.review_count} reviews` : 'Review evidence unavailable'} · checked {String(item.retrieved_at || '').replace('T', ' ').replace('Z', '')}</small><small>{item.review_summary || 'Review text unavailable from this provider.'}</small><small className="simulated-label">PACT Sandbox Catalog · simulated data</small><div className="discovery-card-actions"><button className="text-button" onClick={() => toggleCompare(item.product_id)}>{selected.includes(item.product_id) ? 'Selected for compare' : 'Compare'}</button><button className="secondary-action marketplace-mcp-button" disabled={item.availability !== 'in_stock'} onClick={() => onPurchase(item)}>{item.availability === 'in_stock' ? 'Run MCP purchase flow · Request to order' : 'Unavailable for ordering'}</button></div></article>)}</div>
    {comparison && <div className="comparison-panel"><div className="panel-heading"><div><span className="section-label">STRUCTURED COMPARISON</span><h3>Evidence side by side</h3></div><button className="text-button" onClick={() => setComparison(null)}>Close</button></div><div className="comparison-grid">{(comparison.products || []).map((item: ApiRecord) => <div key={item.product_id}><strong>{item.title}</strong><span>{money(Number(item.price_cents ?? item.amount_cents))} · {item.availability}</span><span>{item.specifications?.ram_gb}GB RAM · {item.specifications?.storage_gb}GB · {item.specifications?.battery_hours}h battery</span></div>)}</div></div>}
  </div>;
}

function Activity({ handshake, receipts, walletActivity, rules, approvals, plans, planActions, trustEvents, mcpEvents, paymentOrders, catalog, mcpWire }: { handshake: ApiRecord | null; receipts: ApiRecord[]; walletActivity: ApiRecord[]; rules: ApiRecord[]; approvals: ApiRecord[]; plans: ApiRecord[]; planActions: ApiRecord[]; trustEvents: ApiRecord[]; mcpEvents: ApiRecord[]; paymentOrders: ApiRecord | Record<string, ApiRecord>; catalog: ApiRecord[]; mcpWire: 'pending' | 'verified' | 'unavailable' }) {
  const serverMcpEvents = [...mcpEvents].sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
  const entries: ApiRecord[] = [...walletActivity.map((item): ApiRecord => ({ ...item, kind: 'wallet' })), ...receipts.map((item): ApiRecord => ({ ...item, kind: 'receipt' })), ...serverMcpEvents.map((item): ApiRecord => ({ ...item, kind: 'mcp' }))].sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
  const latestReceipt = receipts[0];
  const latestCommerceEvent = serverMcpEvents.find((item) => ['execute_action', 'check_action', 'get_product'].includes(item.tool));
  const latestAction = latestCommerceEvent?.arguments?.action || latestReceipt?.redacted_parameters || planActions[planActions.length - 1] || {};
  const latestPlan = plans[plans.length - 1];
  const latestApproval = approvals[approvals.length - 1];
  const product = catalog.find((item) => item.product_id === latestAction.product_id);
  const orderList = Object.values(paymentOrders || {}) as ApiRecord[];
  const latestOrder = orderList[orderList.length - 1];
  const selectedTitle = product?.title || latestAction.product_id || latestAction.merchant || 'No commerce action recorded yet';
  const decision = String(latestCommerceEvent?.policy_decision || latestReceipt?.decision || planActions[planActions.length - 1]?.decision || '—').toUpperCase();
  const paymentStatus = latestReceipt?.result === 'executed' ? 'success' : latestReceipt?.result === 'rejected' ? 'not completed' : latestOrder?.status || 'not started';
  const toolNames = ['search_catalog', 'get_product', 'create_purchase_request', 'check_action', 'request_approval', 'approve', 'execute_action', 'get_order_status', 'get_receipts'];
  const trace = toolNames.map((name) => [name, serverMcpEvents.some((item) => item.tool === name)] as [string, boolean]);
  const redactedTrace = { jsonrpc: '2.0', transport: 'Streamable HTTP /mcp', events: serverMcpEvents.slice(0, 20) };
  return <section className="page-section activity-page">
    <PageIntro eyebrow="TRUST & ACTIVITY" title="See why PACT acted—or stopped." body="Every household commerce decision stays connected to the request, rule, approval, payment boundary, and receipt. Private values remain redacted on shared surfaces." />
    <div className="trust-summary-grid"><div className="summary-card"><span className="section-label">LATEST DECISION</span><strong className={`trust-decision trust-${decision.toLowerCase()}`}>{decision}</strong><span>{latestReceipt?.reason || 'Run a household request to populate the trust record.'}</span></div><div className="summary-card"><span className="section-label">POLICY VERSION</span><strong>{latestReceipt?.policy_version || '—'}</strong><span>{rules.length} confirmed rule{rules.length === 1 ? '' : 's'}</span></div><div className="summary-card"><span className="section-label">MCP IDENTITY</span><strong>{mcpWire === 'verified' ? 'VERIFIED' : mcpWire === 'unavailable' ? 'UNAVAILABLE' : 'CHECKING'}</strong><span>Authenticated browser transport</span></div><div className="summary-card"><span className="section-label">RECEIPT INTEGRITY</span><strong>{receipts.length ? 'CHAINED' : 'READY'}</strong><span>{receipts.length ? 'Tamper-evident local records' : 'No receipt yet'}</span></div></div>
    <div className="trust-focus-grid">
      <article className="glass-panel trust-case-card"><div className="panel-heading"><div><span className="section-label">HOUSEHOLD COMMERCE CASE</span><h2>{selectedTitle}</h2></div><span className={`status-chip ${decision.toLowerCase()}`}>{decision}</span></div><div className="trust-facts"><div><span>Amount</span><strong>{latestAction.amount_cents ? money(latestAction.amount_cents) : '—'} {latestAction.currency || ''}</strong></div><div><span>Member</span><strong>{latestAction.beneficiary || latestReceipt?.subject_id || latestReceipt?.member_id || '—'}</strong></div><div><span>Payment method</span><strong>{latestAction.payment_method_id ? `•••• ${String(latestAction.payment_method_id).slice(-4)}` : 'Household boundary'}</strong></div><div><span>Payment result</span><strong>{paymentStatus}</strong></div></div><div className="trust-case-detail"><span className="section-label">RULE MATCHED</span><p>{latestReceipt?.rule_id || planActions[planActions.length - 1]?.decision || 'Deterministic policy evaluation is shown here after a request.'}</p><span className="section-label">APPROVAL EVENT</span><p>{latestApproval ? `${latestApproval.status} · ${latestApproval.approver || 'required adult'} · exact request hash bound` : 'No approval event recorded for the latest case.'}</p><span className="section-label">PLAN EXPOSURE</span><p>{latestPlan ? `${money(latestPlan.exposure_cents)} committed of ${money(latestPlan.budget_cents)} · ${money(latestPlan.remaining_cents)} remaining` : 'No active household plan yet.'}</p></div></article>
      <article className="glass-panel trust-trace-card">{handshake && <div className="mcp-handshake" aria-label="MCP session handshake"><span className="section-label">BROWSER-OBSERVED MCP HANDSHAKE</span><span>initialize → protocol {handshake.protocol} · {handshake.server} {handshake.server_version}</span><span>tools/list → {handshake.tools} tools · observed {handshake.at}</span><span>tools/call → recorded below by the server, tokens redacted</span></div>}<div className="panel-heading"><div><span className="section-label">SERVER-RECORDED MCP TRACE</span><h2>One path to a safe purchase</h2></div><span className="status-chip violet">{serverMcpEvents.length ? 'LIVE EVENTS' : 'MCP SURFACE'}</span></div>{!serverMcpEvents.length && <p className="muted">Run “MCP purchase flow” from Wallet to record the authenticated commerce journey here.</p>}<div className="tool-trace">{trace.map(([name, observed], index) => <div className={observed ? 'tool-trace-row observed' : 'tool-trace-row'} key={name}><span>{String(index + 1).padStart(2, '0')}</span><strong>{name}</strong><small>{observed ? 'recorded' : 'ready'}</small></div>)}</div><details className="redacted-trace"><summary>View redacted JSON-RPC events</summary><pre>{JSON.stringify(redactedTrace, null, 2)}</pre></details></article>
    </div>
    <div className="trust-lower-grid"><article className="glass-panel trust-receipt-card"><div className="panel-heading"><div><span className="section-label">RECEIPT & ORDER</span><h2>Evidence that closes the loop</h2></div><span className="status-chip allow">LOCAL SANDBOX</span></div>{latestReceipt ? <div className="receipt-proof"><div><span>Receipt</span><strong>{latestReceipt.receipt_id}</strong></div><div><span>Order status</span><strong>{latestOrder?.status || (latestReceipt.result === 'executed' ? 'completed' : latestReceipt.result)}</strong></div><div><span>Hash</span><strong>{String(latestReceipt.receipt_hash || '').slice(0, 25)}…</strong></div><div><span>Previous hash</span><strong>{latestReceipt.previous_hash ? `${latestReceipt.previous_hash.slice(0, 25)}…` : 'genesis'}</strong></div></div> : <p className="muted">Run the Maya birthday plan or a marketplace action to create a receipt.</p>}</article><article className="glass-panel trust-members-card"><div className="panel-heading"><div><span className="section-label">AUDIT SIGNALS</span><h2>Human authority stays visible</h2></div></div><div className="audit-signal"><strong>{trustEvents.filter((item) => item.event === 'approval').length}</strong><span>adult approval events</span></div><div className="audit-signal"><strong>{receipts.filter((item) => item.result === 'rejected').length}</strong><span>safe refusals</span></div><div className="audit-signal"><strong>{planActions.length}</strong><span>exact plan actions</span></div></article></div>
    <div className="activity-stream-heading"><span className="section-label">ACTIVITY TIMELINE</span><span className="muted">Server-recorded MCP events, wallet changes, and policy receipts</span></div><div className="activity-list">{entries.length ? entries.map((item) => <div className="activity-row" key={item.receipt_hash || item.event_id || `${item.timestamp}-${item.action || item.tool}`}><span className={`result-dot ${item.kind === 'wallet' ? 'allowed' : item.kind === 'mcp' ? 'allowed' : item.result}`} /><div><strong>{item.kind === 'wallet' ? String(item.event || '').replaceAll('_', ' ') : item.kind === 'mcp' ? `${item.tool} · ${item.member_id || 'authenticated member'}` : `${item.action || 'policy event'} · ${item.subject_id || 'simulated household'}`}</strong><span>{item.kind === 'mcp' ? `${String(item.policy_decision || 'recorded').toUpperCase()} · ${item.latency_ms}ms · ${item.request_id}` : item.reason || item.display_name || item.permission_id || 'PACT recorded the event'}{item.receipt_hash ? ` · ${item.receipt_hash.slice(0, 18)}…` : ''}</span></div><span className="status-chip">{item.kind === 'wallet' ? 'wallet' : item.kind === 'mcp' ? 'mcp' : item.result || 'recorded'}</span></div>) : <p className="muted">Run the MCP purchase flow or configure the wallet to create activity.</p>}</div>
  </section>;
}
function Developer({ status, trace }: { status: ApiRecord | null; trace: string[] }) { return <section className="page-section"><PageIntro eyebrow="DEVELOPER" title="One boundary for every add-on." body="Product discovery, comparison, purchase requests, approvals and execution all use the same check_action → approval → execute contract over MCP. This panel is a live view of the local sandbox status." /><div className="developer-grid"><div className="glass-panel"><span className="section-label">MCP RUNTIME</span><div className="runtime-row"><strong>Streamable HTTP</strong><span>{status?.protocol?.minimum_hackathon_handshake || 'loading'}</span></div><div className="runtime-row"><strong>SDK</strong><span>{status?.mcp_sdk_version || 'loading'}</span></div><div className="runtime-row"><strong>Bedrock</strong><span>{status?.bedrock?.available ? `${status.bedrock.model_id} · ${status.bedrock.region}` : 'deterministic fallback'}</span></div><pre className="snippet">{`const decision = await pact.check_action(action);\nif (decision.decision === "ask") await pact.request_approval(action, decision.decision_token);\nawait pact.execute_action(action, decision.decision_token, approval_token);`}</pre></div><div className="glass-panel"><span className="section-label">LIVE TOOL TRACE</span>{trace.length ? trace.map((item, index) => <div className="dev-trace" key={`${item}-${index}`}><span>{String(index + 1).padStart(2, '0')}</span>{item}</div>) : <p className="muted">Use the Home command deck to populate the trace.</p>}<div className="security-proof"><strong>Adversarial suite</strong><span>240 deterministic attempts · 0 bypasses · 0 unauthorized executions</span></div></div></div></section>; }
function About() {
  return <section className="page-section about-page">
    <div className="about-brand-hero">
      <div className="about-brand-lockup"><img className="about-mark-image" src="/static/pact-firefly-mark.png" alt="PACT firefly core mark" /><span className="pact-word">PACT</span><span className="about-tagline-separator">—</span><span className="about-tagline">Household AI that earns the right to act.</span></div>
    </div>
    <PageIntro eyebrow="ABOUT PACT" title="Permission should be earned." body="PACT is a voice-first household assistant that lets AI propose helpful plans while deterministic code keeps authority with the people who live there." />

    <div className="about-grid about-lead-grid">
      <article className="glass-panel"><span className="section-label">THE PRODUCT PROMISE</span><h2>AI proposes. Code decides.</h2><p>Natural language can suggest a rule or action, but it never gets to authorize one. PACT validates the proposal, asks the right adult when needed, signs the exact action, and records the outcome.</p></article>
      <article className="glass-panel"><span className="section-label">A HOUSEHOLD BOUNDARY</span><h2>Permission travels with the action.</h2><p>Rules, roles, budgets, private surfaces, approvals, replay protection, and receipts stay attached to the exact simulated action across VenueBook and GiftCart.</p></article>
    </div>

    <section className="about-section about-proof-section">
      <div className="about-section-heading"><span className="section-label">JUDGE PROOF · VERIFIED FLOW</span><h2>One request. Two people. One verifiable result.</h2><p>The strongest PACT path is a real cross-member MCP commerce flow: Maya asks, Siva approves from another authenticated session, and Leo is denied.</p></div>
      <div className="about-proof-grid">
        <article className="glass-panel"><span className="proof-number">01</span><span className="section-label">MAYA · REQUESTER</span><h3>Ask through MCP</h3><p>Search a product, check the exact amount and rule, then request approval when policy returns <strong>ASK</strong>.</p></article>
        <article className="glass-panel"><span className="proof-number">02</span><span className="section-label">SIVA · APPROVER</span><h3>Approve elsewhere</h3><p>Siva sees the pending request in a separate authenticated session and approves only the bound product, amount, card, device, and rule version.</p></article>
        <article className="glass-panel"><span className="proof-number">03</span><span className="section-label">LEO · PROTECTED</span><h3>Deny by code</h3><p>Leo receives deterministic <strong>DENY</strong> for the same restricted purchase. Forged execution and changed parameters are refused.</p></article>
      </div>
      <div className="about-mcp-path glass-panel"><span className="section-label">SERVER-RECORDED MCP PATH</span><p><code>search_catalog</code> → <code>get_product</code> → <code>compare_products</code> → <code>create_purchase_request</code> → <code>check_action</code> → <code>request_approval</code> → <code>approve</code> → <code>execute_action</code> → <code>get_order_status</code> → <code>get_receipts</code></p><span className="about-proof-note">Activity records the authenticated member, household, tool, decision, latency, and redacted arguments at the MCP boundary.</span></div>
    </section>

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
