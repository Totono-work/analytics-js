# Totono Analytics for JavaScript

Install directly from the public repository:

```sh
npm install git+https://github.com/totono-work/analytics-js.git#v0.2.0
```

The package builds its JavaScript and TypeScript declarations during installation. npm registry publication is separate.

```js
import { TotonoAnalytics } from '@totono/analytics';
const analytics = new TotonoAnalytics({
  endpoint: 'https://totono.work/api/public/analytics/v1/events',
  key: 'YOUR_INGESTION_KEY',
  namespace: 'YOUR_PROJECT_ID',
  appVersion: '1.0',
  environment: 'test' // Switch to production when ready.
});
analytics.track('app.opened', { source: 'website' });
analytics.identify('opaque-customer-id');
analytics.track('checkout.started', { amount: 12 });
await analytics.flush();
```

Add the website's exact origin to the project's allowed origins. The client uses random installation IDs in localStorage, a new session per instance, explicit events, bounded persistent queues, batching, and retries. Use a stable namespace unique to the project on this origin. When localStorage is unavailable, tracking continues in memory. Calling `identify` affects future events only; identity is not persisted across client instances.

`reset()` clears customer identity and generates a new installation and session. `setOptOut(true)` stops tracking and clears queued events and identity; the preference persists on this device. `setOptOut(false)` resumes with a new anonymous identity. `getInstallationId()` returns the local installation ID for a user's deletion request, or null while opted out. `dispose()` stops the flush timer; await `flush()` before disposal if pending events should be sent. An already transmitted request cannot be withdrawn by opt-out.

Production data is the default. To defer all collection until the user's preference is known, call `setOptOut(true)` before any `track` calls, then opt in when appropriate. Do not put personal information in properties. Optional `storage`, `fetch`, and `flushIntervalMs` options support host integration and testing.

## Device and environment context (0.2.0)

The 0.2.0 source requires a collector that accepts optional environment metadata. Deploy the compatible API before publishing/installing the new SDK; the existing 0.1.0 server rejects unknown fields.

Each `track()` snapshots device class (`phone`, `tablet`, `desktop`, `unknown`), best-effort OS name/exposed iOS version, the SDK release version, preferred browser BCP 47 language, system light/dark preference, and available screen dimensions/scale. `appVersion` remains caller-supplied. Screen width/height use CSS pixels for the full screen, not viewport size; `screenScale` is `devicePixelRatio` (physical-pixel ratio). Missing or blocked APIs are omitted. Models are not probed, and frozen desktop/Android OS versions are omitted. User-agent results can be reduced or spoofed.

Pass the active app preferences initially or update them for future events:

```ts
const analytics = new TotonoAnalytics({
  endpoint: 'https://totono.work/api/public/analytics/v1/events',
  key: 'YOUR_INGESTION_KEY',
  context: { language: 'cs-CZ', colorScheme: 'dark' }
});
analytics.setContext({ language: 'en-US', colorScheme: 'light' });
analytics.setContext({}); // Restore browser/system defaults.
```

`AnalyticsContext` is exported as a TypeScript type. `setContext` replaces all overrides and validates them before changing state; invalid language/appearance throws a technical error. Language tags are canonicalized. Changes do not alter queued events. Queues from older SDKs remain valid without metadata. Retries preserve the full captured payload. Opt-out prevents tracking and clears pending events. No automatic events or additional device identifiers are introduced.

Country is added by the collector using its trusted load balancer's upload-time IP country estimate, if enabled. The SDK neither collects IPs nor substitutes locale region for country. Country can remain unknown and can reflect VPNs/proxies.

## Development

```sh
npm ci
npm test
npm run build
```

The GitHub CI workflow runs tests and builds on pushes and pull requests. No credentials are required for the unit tests.

The build/test pre-step generates `src/version.ts` from the release version in `package.json`; update the package version and lockfile together before release.
