import React from 'react';
import { createRoot } from 'react-dom/client';
import '@flow/ui/tokens.css';
import { App } from './App';

// Dark until theme plumbing lands with the settings UI (Phase 11).
document.documentElement.dataset['theme'] = 'dark';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
