export interface MicLevelSource { level(): number; stop(): void; }

export function createMicLevelSource(stream: MediaStream): MicLevelSource {
  if (typeof window === 'undefined') return { level: () => 0, stop: () => undefined };
  const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return { level: () => 0, stop: () => undefined };
  const context = new AudioContextCtor();
  const analyser = context.createAnalyser();
  analyser.fftSize = 256;
  const source = context.createMediaStreamSource(stream);
  source.connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);
  let stopped = false;
  return {
    level: () => {
      if (stopped) return 0;
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i += 1) {
        const value = (data[i] - 128) / 128;
        sum += value * value;
      }
      return Math.min(1, Math.sqrt(sum / data.length) * 2.8);
    },
    stop: () => {
      if (stopped) return;
      stopped = true;
      source.disconnect();
      analyser.disconnect();
      void context.close();
    },
  };
}
