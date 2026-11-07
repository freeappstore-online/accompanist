# Editable FreeAppStore starter

This source is app-owned after scaffolding. Keep existing screens, layouts and data.
The SDK Shell is the supported default; a custom accessible frame is supported.
Keep a reachable Profile in both auth states, shared theme/text preferences,
keyboard navigation, visible focus, loading/error feedback and page zoom.
Public screens stay public; gate private features at their data boundary.
Share the existing SDK/Auth instance with Shell, Profile and connected features.

Choose device-local, private-account, public-shared or room storage for the feature.
Never treat collections or room broadcasts as private storage. Do not ask end users
for developer API keys: the SDK proxy supports server-side key injection.
No payments, ads or direct trackers. Preserve SDK Tailwind @source and @theme wiring.

Use fas add <capability> --dry-run for infrastructure changes. Resolve reported
package prerequisites before applying; root recipe imports need a root SDK dependency.
Keep edited capability files and review conflicts rather than overwriting them.
Keep one PWA controller and register busy guards for unsaved work and capture.

Before reporting completion, typecheck and build; exercise a real user flow,
including sequential keyboard typing (not only programmatic fill), associated
labels, save + reload, validation failures, and avatar/Profile return navigation.
Check the browser favicon separately from the PWA manifest/install icon.
Dev/build generates raster icons from the app-owned SVG using web/pwa-assets.config.ts.
Keep custom artwork, HTML and manifest paths consistent; prebuilt custom icons are supported.
Remove the generated-asset .gitignore entries if adopting prebuilt icons at those paths.
Profile is a separate route: keep drafts/reading position in app-owned route state and
pause playback or capture in effect cleanup. A PWA busy guard only guards updates.
Use available browser tooling; state explicitly when runtime checks were not run.
Practical review guide:
https://github.com/freeappstore-online/platform/blob/main/docs/app-verification.md
Optional editable form/dialog example:
https://github.com/freeappstore-online/platform/blob/main/docs/ui.md#editable-forms

Canonical source and guidance:
https://github.com/freeappstore-online/platform/blob/main/docs/composable-starter-contract.md
https://github.com/freeappstore-online/platform/blob/main/docs/starter-release.md
https://github.com/freeappstore-online/platform/blob/main/CONTRIBUTING.md#updating-the-external-app-starter-repositories
