import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// NOTE: React.StrictMode intentionally disabled — jchat-ws-client lifecycle
// has a known race condition under double-mount (sendSubscribe pending entry
// vs ack lookup mismatch). Production builds don't run StrictMode anyway, so
// disabling here gives accurate dev-time behavior matching prod.
ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
