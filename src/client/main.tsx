import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { TwitchConnectionWidget } from './TwitchConnectionWidget';
import './styles.css';
import './reports.css';
import './phase1-tuning.css';
import './twitch-connect.css';

const showTwitchConnection = !['/compact', '/reports'].includes(window.location.pathname);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    {showTwitchConnection && <TwitchConnectionWidget />}
  </StrictMode>
);
