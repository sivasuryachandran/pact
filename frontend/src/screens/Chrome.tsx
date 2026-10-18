const NAV = ['Home', 'Rules', 'Activity', 'Developer'];

/** Shared top bar for the simulated screens: wordmark, "simulated" tag, four nav items. */
export function Chrome({ active, tag }: { active: string; tag: string }) {
  return <header className="chrome">
    <div className="chrome-brand"><span className="wordmark-text">PACT</span><span className="tag">{tag}</span></div>
    <nav aria-label="Primary navigation">{NAV.map((item) => <span key={item} className={item === active ? 'nav-link active' : 'nav-link'} aria-current={item === active ? 'page' : undefined}>{item}</span>)}</nav>
    <span className="chrome-spacer" />
  </header>;
}
