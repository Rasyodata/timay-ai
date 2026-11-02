import { createRoot } from 'react-dom/client';
import { App } from './App';
import { Screensaver } from './Screensaver';
import './styles.css';

// ?reklam : yalnız tanıtım animasyonu (reklam videosu ve ekran gösterimi için), giriş gerekmez.
// ?reklam&ekran : Windows ekran koruyucusu (fare/klavye dokununca kapanır).
const q = new URLSearchParams(window.location.search);
const ad = q.has('reklam');
createRoot(document.getElementById('root')!).render(ad ? <Screensaver go={() => undefined} ad system={q.has('ekran')} /> : <App />);
