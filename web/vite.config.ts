import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { pwaOptions } from '@freeappstore/sdk/pwa-config';
export default defineConfig({ plugins: [react(), tailwindcss(), VitePWA(pwaOptions({ workbox: { globPatterns: ['**/*.{js,css,html,png,jpg,svg,ico,woff2}', 'sounds/*.sf3', 'sounds/*.txt'], globIgnores: ['songs/**'], navigateFallbackDenylist: [/^\/(?:songs|sounds)(?:\/|$)/] } }))] });
