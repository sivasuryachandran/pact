import { dollars, usePlan } from './data';

/** Dad's phone: the private approval card. Approving calls the same engine endpoint as the main app. */
export function Phone({ fixture }: { fixture: 'fresh' | 'asking' | 'resolved' | null }) {
  const plan = usePlan(fixture);
  const remaining = Math.max(0, plan.budgetCents - plan.committedCents);
  const asking = plan.pendingApproval;
  const approve = () => void fetch('/api/command', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Dad: Approve.', speaker_id: 'siva', surface: 'dad_phone' }) });
  return <div className="phone">
    <header className="phone-bar"><span className="mono-label">PRIVATE · DAD’S PHONE · SIMULATED</span></header>
    <main className="phone-main">
      {asking ? <section className="approval" aria-label="Approval needed">
        <div className="card-row"><h1>Approval needed</h1><span className="pill amber">Needs approval</span></div>
        <p className="lead">Maya wants VenueBook to book Funzone for {dollars(plan.venue.amountCents)}</p>
        <dl className="facts">
          <div><dt>Add-on</dt><dd>VenueBook</dd></div>
          <div><dt>Amount</dt><dd>{dollars(plan.venue.amountCents)}</dd></div>
          <div><dt>Budget remaining</dt><dd>{dollars(remaining)} <span>of {dollars(plan.budgetCents)}</span></dd></div>
          <div><dt>Policy</dt><dd>Ask before booking over $100</dd></div>
        </dl>
        <button className="primary" onClick={approve}>Approve exact request</button>
        <button className="ghost">Deny</button>
        <p className="fine">The policy engine decided; you confirm.</p>
      </section> : <section className="approval calm" aria-label="Nothing waiting">
        <div className="card-row"><h1>Nothing waiting</h1><span className="pill mint">All clear</span></div>
        <p className="lead">{plan.venue.status === 'approved' ? 'You approved the Funzone booking.' : 'Approval requests from the household appear here, only on this phone.'}</p>
      </section>}
    </main>
    <div className="phone-foot">Simulated Alexa+ add-on experience</div>
    <nav className="tabbar" aria-label="Primary navigation">{['Home', 'Rules', 'Activity', 'Developer'].map((n, i) => <span key={n} className={i === 0 ? 'active' : ''}>{n}</span>)}</nav>
  </div>;
}
