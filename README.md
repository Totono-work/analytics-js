# Totono Analytics for JavaScript

Install directly from the public repository:

```sh
npm install git+https://github.com/totono-work/analytics-js.git#v0.1.0
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

## Development

```sh
npm ci
npm test
npm run build
```

The GitHub CI workflow runs tests and builds on pushes and pull requests. No credentials are required for the unit tests.
