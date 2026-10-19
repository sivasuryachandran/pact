/**
 * Small, generated PACT interaction cues.
 *
 * These are intentionally synthesized with Web Audio instead of shipping a
 * third-party sound file. The cue palette is original, tiny, and works
 * offline after the page has loaded.
 */
export type PactCue = 'wake' | 'listening' | 'thinking' | 'speaking' | 'approval' | 'approved' | 'denied';

let context: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioContextCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return null;
  context ||= new AudioContextCtor();
  if (context.state === 'suspended') void context.resume();
  return context;
}

const CUES: Record<PactCue, { notes: number[]; duration: number; volume: number }> = {
  wake: { notes: [392, 523], duration: 0.11, volume: 0.045 },
  listening: { notes: [440, 660], duration: 0.14, volume: 0.035 },
  thinking: { notes: [262], duration: 0.18, volume: 0.025 },
  speaking: { notes: [330], duration: 0.12, volume: 0.018 },
  approval: { notes: [262, 330, 392], duration: 0.13, volume: 0.045 },
  approved: { notes: [392, 523, 659], duration: 0.12, volume: 0.05 },
  denied: { notes: [330, 247], duration: 0.15, volume: 0.04 },
};

export function playPactCue(kind: PactCue): void {
  const audio = getContext();
  if (!audio) return;
  const cue = CUES[kind];
  const start = audio.currentTime + 0.01;
  cue.notes.forEach((frequency, index) => {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    const at = start + index * cue.duration * 0.72;
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, at);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(cue.volume, at + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + cue.duration);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(at);
    oscillator.stop(at + cue.duration + 0.02);
  });
}
