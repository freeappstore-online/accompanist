// Import this module once from the browser entry point after installing SDK >=0.16.39.
import { startPwa } from '@freeappstore/sdk/pwa';
// The production worker is absent during Vite development. Use build + preview for PWA QA.
export const pwa = startPwa({ enabled: import.meta.env.PROD });
// pwa.addBusyGuard(() => dirtyForm || recorder.state === 'recording');
