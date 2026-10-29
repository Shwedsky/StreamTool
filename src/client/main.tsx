import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { TwitchConnectionWidget } from './TwitchConnectionWidget';
import { VkVideoConnectionWidget } from './VkVideoConnectionWidget';
import './styles.css';
import './reports.css';
import './phase1-tuning.css';
import './twitch-connect.css';
import './brand.css';

const showConnections = !['/compact', '/reports'].includes(window.location.pathname);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    {showConnections && (
      <div className="connection-stack">
        <TwitchConnectionWidget />
        <VkVideoConnectionWidget />
      </div>
    )}
  </StrictMode>
);