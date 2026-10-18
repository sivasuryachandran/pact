import type { SignalTheme } from './types';

export const defaultTheme: SignalTheme = {
  idle: '#FFF4D6',
  listening: '#8B7CFF',
  thinking: '#8B7CFF',
  speaking: '#60A5FA',
  approval: '#FBBF24',
  allowed: '#34D399',
  denied: '#FB7185',
  private: '#6B7280',
  wingStart: '#5EEAD4',
  wingEnd: '#C4B5FD',
};

export function mergeTheme(partial: Partial<SignalTheme> = {}, base: SignalTheme = defaultTheme): SignalTheme {
  return { ...base, ...partial };
}
