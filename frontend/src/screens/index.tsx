import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './screens.css';
import { Phone } from './Phone';
import { Tablet } from './Tablet';
import { Tv } from './Tv';

export type ScreenName = 'tv' | 'phone' | 'tablet';

/** Routes `?screen=tv|phone|tablet` to the simulated device views. */
export function Screens({ name, params }: { name: ScreenName; params: URLSearchParams }) {
  const demo = params.get('demo');
  const fixture = demo === 'fresh' || demo === 'asking' || demo === 'resolved' ? demo : null;
  const still = params.has('still');
  if (name === 'phone') return <Phone fixture={fixture} />;
  if (name === 'tablet') return <Tablet fixture={fixture} />;
  return <Tv still={still} demo={params.has('demo') && !fixture} fixture={fixture} />;
}
