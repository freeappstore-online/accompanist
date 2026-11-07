# PWA integration

Requires @freeappstore/sdk >=0.16.39 and vite-plugin-pwa ^1.0.0.
In web/vite.config.ts import pwaOptions from ./fas-pwa-config
and use VitePWA(pwaOptions({ /* your existing options */ })).
Import ./fas-capabilities/pwa from web/src/main.tsx.
The recipe disables PWA initialization in Vite development; use build + preview to verify installation/offline behavior.
Register pwa.addBusyGuard callbacks for dirty forms, recordings and transfers.
Keep the public manifest, icons and app-specific denylist. Review custom runtimeCaching:
never cache authenticated responses; the shared defaults cache only build assets.
Keep page zoom enabled; restrict gestures only on a canvas element.
See https://github.com/freeappstore-online/platform/blob/main/docs/pwa-lifecycle.md
