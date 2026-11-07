import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

// App-owned artwork and padding/background options. Keep manifest/HTML paths in sync.
export default defineConfig({
  preset: minimal2023Preset,
  headLinkOptions: { preset: '2023' },
  images: ['public/icon.svg'],
});
