import { createRoot } from 'react-dom/client';
import { App } from './App';
import { Screensaver } from './Screensaver';
import './styles.css';

// ?reklam : yalnız tanıtım animasyonu (reklam videosu ve ekran gösterimi için), giriş gerekmez.
const ad = new URLSearchParams(window.location.search).has('reklam');
createRoot(document.getElementById('root')!).render(ad ? <Screensaver go={() => undefined} ad /> : <App />);
