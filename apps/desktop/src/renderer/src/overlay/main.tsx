import React from 'react';
import { createRoot } from 'react-dom/client';
import '@flow/ui/tokens.css';
import './overlay.css';
import { OverlayPill } from './OverlayPill';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <OverlayPill />
  </React.StrictMode>,
);
