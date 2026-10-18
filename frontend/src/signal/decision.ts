import type { Decision } from './index';

type ApiRecord = Record<string, any>;

/**
 * Translate an engine response into what the firefly should show. This only reads the decision
 * the policy engine already made (deny > ask > allow, enforced server-side); it never decides.
 * Returns null when the response carries no decision to display.
 */
export function decisionFromResult(result: ApiRecord | null | undefined): Decision | null {
  const card = result?.card ?? {};
  if (card.kind === 'privacy') return 'private';
  if (card.approval?.approval?.status === 'approved') return 'allowed';
  switch (card.decision?.decision) {
    case 'deny': return 'denied';
    case 'ask': return 'approval';
    case 'allow': return 'allowed';
    default: return null;
  }
}

export const DECISION_COPY: Record<Decision, { label: string; sub: string; color: string }> = {
  allowed: { label: 'Allowed', sub: 'Within your house rules', color: '#34D399' },
  approval: { label: 'Asking for approval', sub: 'Sent to a parent to confirm', color: '#FBBF24' },
  denied: { label: 'Not allowed', sub: 'Blocked by a house rule', color: '#FB7185' },
  private: { label: 'Kept private', sub: 'Details stay off the shared screen', color: '#A1A1AA' },
};
