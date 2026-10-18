import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { Screens } from './screens';
import type { ScreenName } from './screens';
import './styles.css';

const params = new URLSearchParams(window.location.search);
const screen = params.get('screen');
const isScreen = screen === 'tv' || screen === 'phone' || screen === 'tablet';

createRoot(document.getElementById('root')!).render(<StrictMode>{isScreen ? <Screens name={screen as ScreenName} params={params} /> : <App />}</StrictMode>);
