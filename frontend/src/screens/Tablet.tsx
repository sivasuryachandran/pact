import { dollars, usePlan } from './data';
import type { ItemStatus } from './data';
import { Chrome } from './Chrome';

const label: Record<ItemStatus, string> = { waiting: 'Waiting', asking: 'Waiting for Dad', approved: 'Approved by Dad', denied: 'Not allowed: would exceed the $150 budget' };
const tone: Record<ItemStatus, string> = { waiting: 'dim', asking: 'amber', approved: 'mint', denied: 'rose' };

/** Maya's tablet: what she asked for and what the engine said about each step. */
export function Tablet({ fixture }: { fixture: 'fresh' | 'asking' | 'resolved' | null }) {
  const plan = usePlan(fixture);
  const pct = Math.min(100, Math.round((plan.committedCents / plan.budgetCents) * 100));
  return <div className="tablet">
    <Chrome active="Home" tag="Maya’s tablet · simulated" />
    <main className="tablet-main">
      <aside className="tablet-side">
        <section className="panel"><span className="mono-label">YOU SAID</span><p className="quote">“Plan my birthday under $150”</p><span className="fine">Requested by Maya (teen) · decided by the household rules</span></section>
        <section className="panel"><span className="mono-label">TEEN CELEBRATION CAP</span><p className="lead small">Bookings over $100 need a parent. Total spend stays within $150.</p></section>
      </aside>
      <section className="tablet-body">
        <p className="mono-label">MAYA’S BIRTHDAY · LIVE PLAN</p>
        <h1>Maya’s birthday plan</h1>
        <div className="card-row"><span className="mono-label">TOTAL COMMITTED</span><span className="mono-label">{dollars(Math.max(0, plan.budgetCents - plan.committedCents))} remaining</span></div>
        <div className="card-big"><b>{dollars(plan.committedCents)}</b> committed of {dollars(plan.budgetCents)}</div>
        <div className="bar big"><i style={{ width: `${pct}%` }} /></div>
        {(['venue', 'gift'] as const).map((key) => <article className={`step ${tone[plan[key].status]}`} key={key}>
          <div><span className="mono-label">{key === 'venue' ? 'VENUEBOOK' : 'GIFTCART'}</span><h2>{key === 'venue' ? 'Funzone venue' : 'Decorations'}</h2><span className={`pill ${tone[plan[key].status]}`}>{label[plan[key].status]}</span></div>
          <b>{dollars(plan[key].amountCents)}</b>
        </article>)}
      </section>
    </main>
    <div className="screen-foot">Simulated Alexa+ add-on experience</div>
  </div>;
}
