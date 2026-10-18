import { useEffect, useState } from 'react';

type ApiRecord = Record<string, any>;
export type ItemStatus = 'waiting' | 'asking' | 'approved' | 'denied';

export interface PlanView {
  budgetCents: number;
  committedCents: number;
  pendingApproval: boolean;
  venue: { amountCents: number; status: ItemStatus };
  gift: { amountCents: number; status: ItemStatus };
}

/** Fake household data only (Maya, Dad, VenueBook, GiftCart). */
export const FIXTURES: Record<'fresh' | 'asking' | 'resolved', PlanView> = {
  fresh: { budgetCents: 15000, committedCents: 0, pendingApproval: false, venue: { amountCents: 12000, status: 'waiting' }, gift: { amountCents: 4000, status: 'waiting' } },
  asking: { budgetCents: 15000, committedCents: 12000, pendingApproval: true, venue: { amountCents: 12000, status: 'asking' }, gift: { amountCents: 4000, status: 'waiting' } },
  resolved: { budgetCents: 15000, committedCents: 12000, pendingApproval: false, venue: { amountCents: 12000, status: 'approved' }, gift: { amountCents: 4000, status: 'denied' } },
};
const EMPTY: PlanView = { budgetCents: 15000, committedCents: 0, pendingApproval: false, venue: { amountCents: 12000, status: 'waiting' }, gift: { amountCents: 4000, status: 'waiting' } };

const mapStatus = (status?: string): ItemStatus => {
  if (status === 'pending') return 'asking';
  if (status === 'executed' || status === 'approved' || status === 'allowed') return 'approved';
  if (status === 'denied') return 'denied';
  return 'waiting';
};

export function planFromState(state: ApiRecord): PlanView {
  const plans: ApiRecord[] = state.plans ?? [];
  const plan = plans[plans.length - 1];
  if (!plan) return EMPTY;
  const actions: ApiRecord[] = (state.plan_actions ?? []).filter((a: ApiRecord) => a.plan_id === plan.plan_id);
  const venue = actions.find((a) => a.addon === 'VenueBook'), gift = actions.find((a) => a.addon === 'GiftCart');
  const committed = actions.filter((a) => ['pending', 'approved', 'executed'].includes(a.status)).reduce((sum, a) => sum + Number(a.amount_cents || 0), 0);
  return {
    budgetCents: Number(plan.budget_cents) || 15000,
    committedCents: committed,
    pendingApproval: actions.some((a) => a.status === 'pending'),
    venue: { amountCents: Number(venue?.amount_cents) || 12000, status: mapStatus(venue?.status) },
    gift: { amountCents: Number(gift?.amount_cents) || 4000, status: mapStatus(gift?.status) },
  };
}

/** Polls the sandbox state. `?demo=asking|resolved` pins a fixture instead (used for the gallery shots). */
export function usePlan(fixture: keyof typeof FIXTURES | null): PlanView {
  const [plan, setPlan] = useState<PlanView>(fixture ? FIXTURES[fixture] : EMPTY);
  useEffect(() => {
    if (fixture) { setPlan(FIXTURES[fixture]); return undefined; }
    let live = true;
    const load = () => fetch('/api/state', { credentials: 'same-origin' }).then((r) => r.json()).then((s) => { if (live) setPlan(planFromState(s)); }).catch(() => undefined);
    void load();
    const id = window.setInterval(load, 1000);
    return () => { live = false; window.clearInterval(id); };
  }, [fixture]);
  return plan;
}

export const dollars = (cents: number) => `$${Math.round(cents / 100)}`;
