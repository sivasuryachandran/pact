import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import './settings.css';

/** ISO timestamps are shown in the viewer's own time zone, e.g. "Oct 22, 2026, 3:34 PM". */
export const formatWhen = (iso: unknown): string => {
  const date = new Date(String(iso || ''));
  return Number.isNaN(date.getTime()) ? String(iso || '') : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

type Rec = Record<string, any>;
const api = async (path: string, body?: unknown, method?: string): Promise<Rec> => {
  const csrf = document.cookie.split('; ').find((part) => part.startsWith('PACT_CSRF='))?.slice('PACT_CSRF='.length) || '';
  const res = await fetch(path, { credentials: 'same-origin', method: method || (body === undefined ? 'GET' : 'POST'), headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-PACT-CSRF': csrf } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json: Rec = {};
  try { json = text ? JSON.parse(text) as Rec : {}; } catch { json = { error: text || `Request failed (${res.status})` }; }
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
};
const detectTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; } };
const STATE_TEXT: Record<string, string> = { connected: 'Connected', demo: 'Demo mode', unavailable: 'Unavailable' };

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return <label className="st-toggle"><span><b>{label}</b>{hint && <em>{hint}</em>}</span><input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} /><i aria-hidden="true" /></label>;
}

export function SettingsDrawer({ open, fullPage = false, onClose, onChange, onAfterReset, displayName, avatarPhoto, onAvatarPhotoChange }: { open: boolean; fullPage?: boolean; onClose: () => void; onChange: (settings: Rec) => void; onAfterReset: () => void; displayName: string; avatarPhoto: string | null; onAvatarPhotoChange: (value: string | null) => void }) {
  const [data, setData] = useState<Rec | null>(null);
  const [name, setName] = useState('');
  const [loc, setLoc] = useState<Rec>({});
  const [tz, setTz] = useState('');
  const [members, setMembers] = useState<Rec[]>([]);
  const [personalText, setPersonalText] = useState('{}');
  const [sharedText, setSharedText] = useState('{}');
  const [shareConsent, setShareConsent] = useState(false);
  const [inviteRole, setInviteRole] = useState('teen');
  const [inviteCode, setInviteCode] = useState('');
  const [invites, setInvites] = useState<Rec[]>([]);
  const [tests, setTests] = useState<Record<string, string>>({});
  const [memories, setMemories] = useState<Rec[]>([]);
  const [memoryKey, setMemoryKey] = useState('favorite_color');
  const [memoryValue, setMemoryValue] = useState('"violet"');
  const [memoryScope, setMemoryScope] = useState<'private_member' | 'shared_household'>('private_member');
  const [pendingMemory, setPendingMemory] = useState<Rec | null>(null);
  const [voiceStatus, setVoiceStatus] = useState<Rec | null>(null);
  const [msg, setMsg] = useState('');
  const detected = useMemo(detectTz, []);
  const zones = useMemo<string[]>(() => { try { return (Intl as any).supportedValuesOf('timeZone'); } catch { return []; } }, []);

  const adopt = useCallback((next: Rec) => {
    setData(next); setLoc(next.settings.location); setTz(next.settings.timezone.name); setMembers(next.members.map((m: Rec) => ({ ...m, interests: Object.entries(m.shared_preferences || {}).map(([key, value]) => `${key}: ${value}`).join(', ') })));
    const profile = next.profile || {};
    setPersonalText(JSON.stringify(profile.personal || profile, null, 2)); setSharedText(JSON.stringify(profile.shared || {}, null, 2)); setShareConsent(Boolean(profile.share_consent));
    onChange(next.settings);
  }, [onChange]);
  const save = useCallback(async (patch: Rec, note = 'Saved.') => { try { adopt(await api('/api/settings', patch)); setMsg(note); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } }, [adopt]);

  const loadMemory = useCallback(async () => { try { const next = await api('/api/memory'); setMemories(next.memories || []); } catch { setMemories([]); } }, []);
  useEffect(() => { if (open) { api('/api/settings').then(adopt).catch((e) => setMsg(String(e.message || e))); api('/api/invites').then((next) => setInvites(next.invites || [])).catch(() => setInvites([])); void loadMemory(); api('/api/voice/status').then(setVoiceStatus).catch(() => setVoiceStatus({ tts: { provider: 'browser' }, browser_fallback: true })); } }, [open, adopt, loadMemory]);
  useEffect(() => { // first run: fill the timezone from the browser, never over a value the person set
    if (data && data.settings.timezone.source === 'unset' && detected) void api('/api/settings', { timezone: { name: detected, source: 'auto' } }).then(adopt).catch(() => undefined);
  }, [data, detected, adopt]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; if (open) window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [open, onClose]);

  if (!open && !fullPage) return null;
  const s = data?.settings;
  const testProvider = async (provider: string) => { setTests((t) => ({ ...t, [provider]: 'Testing…' })); try { const r = await api('/api/providers/test', { provider }); setTests((t) => ({ ...t, [provider]: r.message })); } catch (e) { setTests((t) => ({ ...t, [provider]: e instanceof Error ? e.message : 'Failed' })); } };
  const savePreferences = async () => {
    try {
      const result = await api('/api/preferences', { personal: JSON.parse(personalText), shared: JSON.parse(sharedText), share_consent: shareConsent });
      setPersonalText(JSON.stringify(result.profile.personal || {}, null, 2)); setSharedText(JSON.stringify(result.profile.shared || {}, null, 2)); setMsg('Private and shared preferences saved.');
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Preferences must be valid JSON.'); }
  };
  const remember = async (confirmed = false) => {
    try {
      const value = JSON.parse(memoryValue);
      const result = await api('/api/memory', { key: memoryKey, value, scope: memoryScope, confirmed });
      if (result.memory?.status === 'confirmation_required') setPendingMemory({ key: memoryKey, value, scope: memoryScope });
      else { setPendingMemory(null); setMsg('Memory saved. It personalizes PACT but never authorizes an action.'); await loadMemory(); }
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Memory value must be valid JSON.'); }
  };
  const forget = async (memoryId: string) => { try { await api(`/api/memory/${encodeURIComponent(memoryId)}`, undefined, 'DELETE'); setMemories((items) => items.filter((item) => item.memory_id !== memoryId)); setMsg('Memory forgotten.'); } catch (e) { setMsg(e instanceof Error ? e.message : 'Memory could not be forgotten.'); } };
  const createInvite = async () => { try { const result = await api('/api/invites', { role: inviteRole, expires_minutes: 60 }); setInviteCode(result.invite.code); setInvites([result.invite, ...invites]); setMsg('Single-use invite created. Copy it to the person joining.'); } catch (e) { setMsg(e instanceof Error ? e.message : 'Invite could not be created.'); } };
  const useMyLocation = () => navigator.geolocation?.getCurrentPosition((p) => setLoc((l) => ({ ...l, latitude: +p.coords.latitude.toFixed(2), longitude: +p.coords.longitude.toFixed(2), share_coordinates: true })), () => setMsg('Location permission was not granted. Nothing was read.'), { timeout: 8000 });
  const choosePhoto = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { setMsg('Choose an image file for your profile photo.'); return; }
    if (file.size > 2_000_000) { setMsg('Choose a profile photo smaller than 2 MB.'); return; }
    const reader = new FileReader();
    reader.onload = () => { if (typeof reader.result === 'string') { onAvatarPhotoChange(reader.result); setMsg('Profile photo saved in this browser.'); } };
    reader.onerror = () => setMsg('The profile photo could not be read.');
    reader.readAsDataURL(file);
    event.target.value = '';
  };
  const wipe = async (path: string, ok: string, confirmText?: string) => { if (confirmText && !window.confirm(confirmText)) return; try { await api(path, {}); setMsg(ok); onAfterReset(); const fresh = await api('/api/settings'); adopt(fresh); } catch (e) { setMsg(String(e instanceof Error ? e.message : e)); } };

  return <div className={fullPage ? 'profile-page-layer' : 'st-layer'} role="presentation">
    {!fullPage && <div className="st-scrim" onClick={onClose} />}
    <aside className={`st-drawer ${fullPage ? 'profile-page-drawer' : ''}`} role="dialog" aria-modal="true" aria-label="Settings">
      <header className="st-head"><div><p className="st-eyebrow">PROFILE</p><h2>Your PACT profile</h2></div><button className="st-close" onClick={onClose} aria-label="Close settings">{fullPage ? '←' : '✕'}</button></header>
      {msg && <div className="st-msg" role="status">{msg}</div>}
      {!s ? <p className="st-muted">Loading…</p> : <div className="st-body">
        <section className="st-card"><div className="st-row"><h3>Profile</h3><span className="st-pill violet">Household identity</span></div>
          {(data?.identity?.user_id || data?.identity?.member_id) ? <><p className="st-who"><span className="st-avatar st-avatar-photo">{avatarPhoto ? <img src={avatarPhoto} alt="" /> : String(displayName || data.identity.display_name || s.account.display_name || 'P')[0]?.toUpperCase()}</span>{displayName || data.identity.display_name || s.account.display_name || data.identity.member_id}</p><label className="st-field st-photo-picker">Profile photo <small>Stored only in this browser; it is not sent to PACT.</small><input type="file" accept="image/*" onChange={choosePhoto} /></label>{avatarPhoto && <button className="st-btn" onClick={() => { onAvatarPhotoChange(null); setMsg('Profile photo removed.'); }}>Remove photo</button>}<button className="st-btn" onClick={() => wipe('/api/auth/logout', 'Signed out of this account.')}>Sign out</button></>
            : <div className="st-inline"><input aria-label="Your name" placeholder="Your name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} /><button className="st-btn primary" disabled={!name.trim()} onClick={async () => { try { adopt(await api('/api/session/login', { name })); setMsg('Signed in to the demo.'); } catch (e) { setMsg(String(e instanceof Error ? e.message : e)); } }}>Sign in</button></div>}
          <p className="st-note">{data?.account_notice} It is stored in this browser’s sandbox only.</p></section>

        <section className="st-card"><h3>Location &amp; timezone</h3>
          <p className="st-note">Used only for answers like “what time is it” or “what’s near me.” Nothing is read from your device unless you press the button below.</p>
          <div className="st-grid"><label>City<input value={loc.city || ''} onChange={(e) => setLoc({ ...loc, city: e.target.value })} /></label><label>State / region<input value={loc.region || ''} onChange={(e) => setLoc({ ...loc, region: e.target.value })} /></label><label>Country<input value={loc.country || ''} onChange={(e) => setLoc({ ...loc, country: e.target.value })} /></label>
            <label>Latitude (optional)<input inputMode="decimal" value={loc.latitude ?? ''} onChange={(e) => setLoc({ ...loc, latitude: e.target.value })} /></label><label>Longitude (optional)<input inputMode="decimal" value={loc.longitude ?? ''} onChange={(e) => setLoc({ ...loc, longitude: e.target.value })} /></label></div>
          <Toggle label="Share coordinates with providers" hint="Off by default. City alone is enough for most answers." checked={!!loc.share_coordinates} onChange={(v) => setLoc({ ...loc, share_coordinates: v })} />
          <div className="st-inline"><button className="st-btn" onClick={useMyLocation}>Use my location…</button></div>
          <label className="st-field">Timezone <small>{s.timezone.source === 'auto' ? 'detected automatically' : s.timezone.source === 'user' ? 'set by you' : 'not set'}</small><input list="st-zones" value={tz} onChange={(e) => setTz(e.target.value)} placeholder={detected || 'Region/City'} /><datalist id="st-zones">{zones.map((z) => <option key={z} value={z} />)}</datalist></label>
          <div className="st-inline"><button className="st-btn primary" onClick={() => save({ location: { ...loc, latitude: loc.latitude === '' ? null : loc.latitude, longitude: loc.longitude === '' ? null : loc.longitude }, ...(tz !== s.timezone.name ? { timezone: { name: tz, source: 'user' } } : {}) }, 'Location saved.')}>Save location</button>{detected && detected !== tz && <button className="st-btn" onClick={() => setTz(detected)}>Use {detected}</button>}</div></section>

        <section className="st-card"><h3>Personalization &amp; voice</h3>
          <Toggle label="Personalization" hint="Use household interests to rank suggestions." checked={s.personalization} onChange={(v) => save({ personalization: v }, 'Preference saved.')} />
          <Toggle label="Qloo recommendations" hint="Taste data for movies, food and activities only." checked={s.qloo_enabled} onChange={(v) => save({ qloo_enabled: v }, 'Preference saved.')} />
          <Toggle label="Voice input and output" hint="Browser speech recognition and read-aloud." checked={s.voice_enabled} onChange={(v) => save({ voice_enabled: v }, 'Preference saved.')} />
          <label className="st-field">Language<select value={s.language} onChange={(e) => save({ language: e.target.value }, 'Language saved.')}>{Object.entries(data!.languages as Rec).map(([k, v]) => <option key={k} value={k}>{String(v)}</option>)}</select></label>
          <p className="st-note">Voice output: <strong>{voiceStatus?.tts?.provider || 'browser'}.</strong> {voiceStatus?.browser_fallback ? 'Browser speech remains the fallback.' : 'Server voice is configured.'}</p></section>

        <section className="st-card"><div className="st-row"><h3>Remember &amp; forget</h3><span className="st-pill violet">explicit only</span></div>
          <p className="st-note">These memories personalize responses only. They never grant permission, change budgets, or authorize an action. Shared memories require adult access and your confirmation.</p>
          <div className="st-grid"><label>Memory key<input value={memoryKey} maxLength={80} onChange={(e) => setMemoryKey(e.target.value)} /></label><label>Scope<select value={memoryScope} onChange={(e) => setMemoryScope(e.target.value as 'private_member' | 'shared_household')}><option value="private_member">Private to me</option><option value="shared_household">Shared household</option></select></label></div>
          <label className="st-field">Value (JSON)<textarea className="st-memory-text" value={memoryValue} onChange={(e) => setMemoryValue(e.target.value)} /></label>
          <div className="st-inline"><button className="st-btn primary" onClick={() => void remember(false)}>Remember</button>{pendingMemory && <button className="st-btn" onClick={() => void remember(true)}>Confirm save “{pendingMemory.key}”</button>}</div>
          {memories.length ? <div className="st-memory-list">{memories.map((item) => <div className="st-memory-row" key={item.memory_id}><div><strong>{item.key}</strong><span>{item.scope === 'private_member' ? 'Private to you' : 'Shared with household'} · {JSON.stringify(item.value)}</span></div><button className="text-button" onClick={() => void forget(item.memory_id)}>Forget</button></div>)}</div> : <p className="st-muted">No explicit memories saved for this account.</p>}
        </section>

        <section className="st-card"><div className="st-row"><h3>Preference privacy</h3><span className="st-pill violet">personal / shared</span></div>
          <p className="st-note">Personal preferences stay with you. Shared preferences are visible to the household only after you opt in. They personalize suggestions, never authorization.</p>
          <label className="st-field">Personal preferences (JSON)<textarea className="st-pref-text" value={personalText} onChange={(e) => setPersonalText(e.target.value)} /></label>
          <label className="st-field">Household-shared preferences (JSON)<textarea className="st-pref-text" value={sharedText} onChange={(e) => setSharedText(e.target.value)} /></label>
          <Toggle label="Share this household profile" hint="Other members see only this shared section." checked={shareConsent} onChange={setShareConsent} />
          <button className="st-btn primary" onClick={() => void savePreferences()}>Save preference boundary</button></section>

        <section className="st-card"><h3>Providers</h3>
          <p className="st-privacy">Qloo receives recommendation context, not your PACT rules or approval history.</p>
          {Object.entries(data!.providers as Rec).map(([id, p]) => <div className="st-provider" key={id}><div className="st-row"><b>{p.name}</b><span className={`st-pill ${p.state}`}>{STATE_TEXT[p.state]}</span></div><span className="st-muted">{p.purpose} · {p.detail}</span><span className="st-recv"><u>Receives:</u> {p.receives}</span><div className="st-inline"><button className="st-btn" onClick={() => void testProvider(id)}>Test connection</button><span className="st-muted" aria-live="polite">{tests[id]}</span></div></div>)}
          <p className="st-note">Credentials live in your server’s environment (see README). They are never shown here.</p></section>

        <section className="st-card"><h3>Household</h3>
          <p className="st-note">Names, roles and explicitly shared interests shape suggestions. Approval rules stay in the service layer; this screen never grants permissions.</p>
          {members.map((m, i) => <div className="st-member" key={m.id + i}><input aria-label="Member name" value={m.name} disabled={m.account_role !== 'owner' && data?.identity?.account_role !== 'owner'} onChange={(e) => setMembers(members.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} /><select aria-label="Role" value={m.role} disabled={m.account_role !== 'owner' && data?.identity?.account_role !== 'owner'} onChange={(e) => setMembers(members.map((x, j) => j === i ? { ...x, role: e.target.value } : x))}><option>adult</option><option>teen</option><option>child</option><option>caregiver</option></select><input aria-label="Shared preferences" placeholder="not shared" value={m.interests || 'not shared'} disabled /><span className="st-role-chip">{m.preferences_shared ? 'shared' : 'private'}</span></div>)}
          {data?.identity?.account_role === 'owner' && <div className="st-inline"><button className="st-btn primary" onClick={() => save({ members: members.map((m) => ({ ...m, id: m.id || undefined, interests: String(m.interests || '').split(',').map((x) => x.trim()).filter(Boolean) })) }, 'Household saved.')}>Save household</button></div>}</section>
        {(data?.identity?.account_role === 'owner' || data?.identity?.account_role === 'co_parent') && <section className="st-card"><div className="st-row"><h3>Invite someone</h3><span className="st-pill violet">single-use</span></div><p className="st-note">Invite codes expire in one hour and can be accepted only once after the person creates or signs into their account.</p><div className="st-inline"><select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}><option value="adult">Co-parent / adult</option><option value="teen">Teen</option><option value="child">Child</option><option value="caregiver">Caregiver</option></select><button className="st-btn primary" onClick={() => void createInvite()}>Create invite</button></div>{inviteCode && <div className="invite-code"><span>Copy this code</span><strong>{inviteCode}</strong></div>}{invites.filter((invite) => !invite.accepted_at && !invite.revoked_at).map((invite) => <div className="st-muted" key={invite.invite_id}>Pending {invite.role} invite · expires {formatWhen(invite.expires_at)}</div>)}</section>}

        <section className="st-card danger"><h3>Reset</h3>
          <div className="st-inline"><button className="st-btn" onClick={() => wipe('/api/reset', 'Demo household reset. Your settings were kept.')}>Reset demo household</button><button className="st-btn warn" onClick={() => wipe('/api/data/clear', 'All local data cleared for this browser.', 'Clear all local PACT data for this browser, including settings and your demo account?')}>Clear local data</button></div></section>
      </div>}
    </aside>
  </div>;
}
