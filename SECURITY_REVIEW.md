# Focused security review — 2026-10-27

Scope: sample-shop action/demo APIs, checkout verification, Shell notifications, and the Go action/SSRF guards. This is a source review with local regression tests, not a full penetration test or certification. Categories follow [OWASP Top 10:2025](https://top10.owasp.org/2025/).

## Fixed in sample-shop

1. **Broken access control — checkout status ownership (medium).** `GET /api/checkout/:sessionId` accepted a known Stripe session ID without verifying its owner, exposing an order's status, ID, total and currency and contacting Stripe on a stranger's request. It now checks both cart ownership and account ownership before verification. Other browsers and a logged-out account are rejected with 404. Stripe session IDs are difficult to guess, but possession is no longer treated as authorization.
2. **Resource exhaustion — anonymous demo writes (medium).** Demo creation and event-producing checks had no request, storage or lifetime bounds. They now have per-instance IP rate limiting, per-browser session quotas, global session/event caps and 24-hour retention. Production deployments with multiple instances still need a shared rate limiter if stronger distributed protection is required.

Tests cover completion, cancellation, pending status, duplicate requests, cross-browser denial, unchanged carts/orders, zero Stripe calls, quotas and checkout ownership. `npm audit --omit=dev` reported zero known dependency advisories at review time.

## Notification fixes in the related projects

Shell stored dismissals only in browser localStorage, so they did not follow an account to another device. The Go API now supports per-user server-side dismissals, restricted by the same audience/plan predicates as notification listing. Shell uses that API, scopes local usage-alert dismissals to the signed-in account, and reports failed saves. The initial unread fetch no longer replays old notifications as newly arrived. Notification read failures retain their real HTTP failure status instead of impersonating an empty successful response.

These related changes require deployment of both Shell and the Go backend, including migration `00104_notification_dismissals.sql`. They are not part of the sample-shop deployment.

## Remaining deployment risks

- **High if publicly deployed unchanged:** `db.js` intentionally seeds a documented admin account and buyer account. Replace demo credentials and remove or disable demo account seeding before using this application for real customer data. The default credentials remain for this demonstration store.
- **High for real commerce:** the Vercel entry point uses temporary `/tmp/shop.sqlite`. Accounts, sessions, orders and demo state may disappear or vary across instances. Use a persistent shared database before real purchases. Local SQLite is persistent.
- **Rate limits are process-local.** The demo and auth limiters do not coordinate across instances. They are useful for this local demo, but are not a distributed abuse-control service.

No real payment was made during review. Existing action SSRF regression tests cover blocked internal destinations and redirect restrictions; passing those tests does not establish that all application endpoints are secure.
