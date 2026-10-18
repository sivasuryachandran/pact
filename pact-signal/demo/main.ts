import { createSignal, type SignalState } from '../src/index';
import './styles.css';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <section class="demo-shell">
    <header><div><p class="eyebrow">PACT SIGNAL / PROCEDURAL STATE RENDERER</p><h1>One signal. No face.</h1><p class="lede">A shaped-particle firefly that makes assistant state visible without pretending to be a person.</p></div><span class="pill" id="state">idle</span></header>
    <div class="stage" id="stage"><div class="target phone" data-target="dad-phone"><b>Dad's phone</b><span>approval target</span></div><div class="target venue" data-target="venuebook"><b>VenueBook</b><span>add-on target</span></div></div>
    <section class="controls"><div class="button-grid">${(['idle','wake','listening','thinking','speaking','approval','allowed','denied','private'] as SignalState[]).map((state) => `<button data-state="${state}">${state}</button>`).join('')}</div><div class="row"><button id="check">morph ✓</button><button id="lock">morph lock</button><button id="fly">fly to Dad's phone</button><button id="roam">roam</button><button id="hover">hover</button></div><label>particles <input id="particles" type="range" min="3000" max="8000" step="500" value="3000"></label><p id="fps">FPS —</p></section>
  </section>`;
const stage = document.querySelector<HTMLElement>('#stage')!;
let signal = createSignal({ container: stage, particleCount: Number(new URLSearchParams(location.search).get('particles')) || 3000, mode: 'roam', cursor: true, seed: 42, avoid: ['.target'] });
const state = document.querySelector('#state')!;
signal.on('stateChange', ({ to }) => { state.textContent = to; });
document.querySelectorAll<HTMLButtonElement>('[data-state]').forEach((button) => button.onclick = () => signal.setState(button.dataset.state as SignalState));
document.querySelector('#check')!.addEventListener('click', () => signal.morph('check'));
document.querySelector('#lock')!.addEventListener('click', () => signal.morph('lock'));
document.querySelector('#fly')!.addEventListener('click', () => signal.flyTo('[data-target="dad-phone"]', { arriveState: 'approval', perch: true }));
document.querySelector('#roam')!.addEventListener('click', () => signal.setMode('roam'));
document.querySelector('#hover')!.addEventListener('click', () => signal.setMode('hover'));
document.querySelector('#particles')!.addEventListener('change', (event) => { const input = event.target as HTMLInputElement; const currentState = signal.getState(); signal.dispose(); signal = createSignal({ container: stage, particleCount: Number(input.value), mode: 'roam', cursor: true, seed: 42, avoid: ['.target'] }); signal.on('stateChange', ({ to }) => { state.textContent = to; }); signal.setState(currentState); });
let frameCount = 0; let last = performance.now(); const fps = document.querySelector('#fps')!;
const measure = (now: number) => { frameCount += 1; if (now - last > 1000) { fps.textContent = `FPS ${Math.round(frameCount * 1000 / (now - last))}`; frameCount = 0; last = now; } requestAnimationFrame(measure); }; requestAnimationFrame(measure);
