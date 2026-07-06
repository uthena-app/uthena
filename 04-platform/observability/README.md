# 04-platform/observability/

Monitoring, logging, metrics, alerts. The things that let us know the app is healthy and the things that help us debug when it's not.

## Files

- **`logger.ts`** — structured logger (pino or similar). Every log line is JSON, with consistent fields.
- **`metrics.ts`** — Prometheus metrics. Counter, gauge, histogram helpers.
- **`tracing.ts`** — OpenTelemetry setup. Distributed tracing across Next.js, Supabase, and Bunny.
- **`sentry.ts`** — Sentry initialization. Server-side, client-side, and edge-side configs.
- **`alerts.yaml`** — alert rules. What pages the on-call, what just goes to Slack.
- **`log-schema.md`** — the canonical log line structure. All log lines conform to this.
- **`cdn-logs.ts`** — Bunny CDN access-log ingestion. Feeds the file-abuse flags. See "CDN log ingestion" below.

## The 3 signals

We monitor three things, in order of priority:

1. **Errors** (Sentry) — anything that throws or 5xx's
2. **Latency** (Prometheus) — p50, p95, p99 for key endpoints
3. **Volume** (Prometheus) — request count, conversion count, payout count

Everything else (business KPIs, dashboards) is built on top of these three. We do NOT build dashboards before we have alerts on these.

## Sentry — errors

Sentry captures:
- Unhandled exceptions in server actions
- React error boundary catches
- API route 5xx responses
- Client-side JavaScript errors
- Edge runtime errors

What we DON'T capture:
- PII (emails, names, addresses) — we configure Sentry's `sendDefaultPii: false` and scrub known fields
- Form data (could contain PII)
- Stripe / PayPal payloads (contain financial data)

The Sentry DSN is stored in Doppler / Vault. It's not in the repo. The `sentry.ts` file loads it at boot.

```ts
// sentry.ts (server)
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  sendDefaultPii: false,
  tracesSampleRate: 0.1,  // 10% of transactions
  beforeSend(event) {
    // Scrub known PII fields
    if (event.user) delete event.user.email;
    if (event.request?.cookies) delete event.request.cookies;
    return event;
  },
});
```

## Prometheus — metrics

Key metrics we track:

- **`http_requests_total`** (counter, by route, method, status)
- **`http_request_duration_seconds`** (histogram, by route, method)
- **`checkout_started_total`** (counter)
- **`checkout_completed_total`** (counter)
- **`library_access_granted_total`** (counter)
- **`signed_urls_generated_total`** (counter, by user_id, file_type)
- **`file_downloads_total`** (counter, by product_id)
- **`payouts_processed_total`** (counter, by partner_id, status)
- **`active_users_gauge`** (gauge, sampled every 5 minutes)
- **`db_query_duration_seconds`** (histogram, by query_type)

The `metrics.ts` file provides typed helpers for these:

```ts
import { counter, histogram } from '04-platform/observability/metrics';

const httpRequests = counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['route', 'method', 'status'],
});

httpRequests.inc({ route: '/api/products', method: 'GET', status: '200' });
```

The Prometheus scrape endpoint is at `/api/metrics`, gated by IP allowlist (only the Prometheus server can read it).

## Structured logging

Every log line is JSON. The `log-schema.md` defines the canonical fields:

```json
{
  "timestamp": "2026-06-15T10:23:45.123Z",
  "level": "info",
  "service": "uthena-web",
  "request_id": "req_abc123",
  "user_id": "usr_xyz789",       // NEVER log PII; user_id is a UUID
  "route": "/api/checkout",
  "method": "POST",
  "status": 200,
  "duration_ms": 234,
  "msg": "Checkout completed",
  "order_id": "ord_456def",
  "amount_cents": 49700
}
```

Required fields: `timestamp`, `level`, `service`, `msg`.
Common optional fields: `request_id`, `user_id`, `route`, `method`, `status`, `duration_ms`.
Domain fields: anything else the caller adds.

**What NEVER goes in a log line:**
- Email addresses (use `user_id` instead)
- Names (use `user_id` instead)
- IP addresses (use a hashed version if needed for abuse detection: `sha256(ip + daily_salt)`)
- Card numbers, CVV, bank account numbers
- API keys, signing keys
- Passwords, session tokens
- Full webhook payloads (could contain anything)

The `logger.ts` has a scrubber that redacts known patterns before writing. Defense in depth — even if a developer forgets, the scrubber catches it.

## OpenTelemetry — tracing

Distributed traces let us see a single user request flow through:
- Next.js (RSC + server action)
- Supabase (Postgres query, RLS check)
- Bunny (signed URL generation, CDN request)

Trace context is propagated via `traceparent` header. The `tracing.ts` file sets up the SDK:

```ts
// tracing.ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

const sdk = new NodeSDK({
  serviceName: 'uthena-web',
  traceExporter: new OTLPTraceExporter({ url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT }),
  instrumentations: [getNodeAutoInstrumentations()],
});
sdk.start();
```

We sample 10% of traces in prod (configurable). 100% in dev. Traces go to Honeycomb or a self-hosted Tempo instance.

## CDN log ingestion — file-abuse detection

The abuse flags in `00-foundations/files/README.md` ("same URL accessed from >10 distinct IPs in a day", "URL accessed >10 times in an hour") cannot be computed from our own tables — `file_downloads` records URL *generation*, not URL *access*. Access happens at Bunny's edge. So we ingest Bunny CDN access logs:

1. **Source:** Bunny CDN logging (per pull zone) — enable log forwarding or pull via the Bunny Logging API.
2. **Cadence:** `cdn-logs.ts` runs as a cron job (`04-platform/ci/scripts/cron/`) every 15 minutes. Pulls new log lines for the storage/stream pull zones.
3. **Privacy:** client IPs from CDN logs are hashed (`sha256(ip + daily_salt)` — same rule as `log-schema.md`) before being stored. Raw CDN logs are not retained on our side; aggregates only.
4. **Storage:** aggregates land in a `cdn_access_stats` table keyed by (signed-URL token hash, hour): access_count, distinct_ip_hashes. RLS: admin-only.
5. **Flags:** a query over `cdn_access_stats` joins back to `file_downloads` (the generation log carries the token hash) and raises:
   - URL accessed from > 10 distinct IPs in 24h → flag user for review
   - URL accessed > 10 times in 1 hour → flag
   Flags surface in the admin area and fire a Slack alert (severity: warn).
6. **Failure mode:** if ingestion breaks (Bunny API down, cron failing), alert after 2 missed runs — silent failure here silently disables abuse detection.

The admin response to a flag (revoke `library_grant`, force re-issue) is described in `00-foundations/files/README.md`. The emergency response to a confirmed mass leak is `05-ops/runbooks/security-incident.md`.

## Alerts

`alerts.yaml` defines alert rules. The most important ones:

```yaml
groups:
  - name: critical
    rules:
      - alert: HighErrorRate
        expr: rate(http_requests_total{status=~"5.."}[5m]) > 0.05
        for: 5m
        labels: { severity: page }
        annotations:
          summary: "Error rate above 5% for 5 minutes"

      - alert: CheckoutCompletionDropped
        expr: rate(checkout_completed_total[1h]) < rate(checkout_started_total[1h]) * 0.5
        for: 15m
        labels: { severity: page }
        annotations:
          summary: "Checkout completion below 50% of starts for 15m"

      - alert: PayoutStuck
        expr: count(payouts_pending_total{age_hours>24}) > 0
        for: 1h
        labels: { severity: page }

      - alert: DatabaseConnectionsHigh
        expr: pg_stat_activity_count > 80
        for: 5m
        labels: { severity: warn }
```

Alerts page the on-call engineer via PagerDuty. Lower-priority alerts go to a Slack channel. The on-call rotation is documented in `05-ops/runbooks/incident-response.md`.

## What does NOT go here

- Business analytics dashboards (Mixpanel, PostHog, or self-hosted) — those are a separate system
- User behavior tracking — Plausible or self-hosted PostHog, also separate
- A/B testing framework — separate
- Customer support tools (Zendesk, etc.) — separate

Observability is about **the system**. Not about users. If you're tracking "user X clicked button Y," that's analytics, not observability. The line: observability is what you need at 3am when the site is down. Analytics is what you need on Monday when you're planning the next sprint.
