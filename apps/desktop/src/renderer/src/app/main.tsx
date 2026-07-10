import React from 'react';
import { createRoot } from 'react-dom/client';
import '@flow/ui/tokens.css';
import { wireAudio } from '../audio/wire';
import { App } from './App';

// This window hosts mic capture even while hidden (BLUEPRINT §7.2).
wireAudio();

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
