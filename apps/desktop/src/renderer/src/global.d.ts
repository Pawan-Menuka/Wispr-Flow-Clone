/// <reference types="vite/client" />

import type { FlowBridge } from '@flow/shared';

declare global {
  interface Window {
    flow: FlowBridge;
  }
}

export {};
