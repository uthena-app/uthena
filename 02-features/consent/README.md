# 02-features/consent/

Cookie-consent management — the P11.1 (granular preferences) +
P11.2 (geo-gated banner) surface that makes the user the source of
truth for which categories of cookie Uthena is allowed to use.

## What lives here

| File | Purpose |
|---|---|
| `queries/getCurrentConsent.ts` | **P11.1.** RLS-aware read of the user's most-recent `consent_log` row. Returns the toggle shape (essential locked on; analytics + marketing from the latest decision). Fail-soft: DB error → `DEFAULT_CONSENT` so the page renders, not a 500. |
| `queries/getConsentBannerState.ts` | **P11.2.** Resolves whether the cookie banner should render. Combines GPC short-circuit + prior-decision lookup (signed-in then anon-id) + geo gate. Pure read-only; nothing written. Fail-soft at every layer — a throw-away request never crashes the layout. |
| `actions/updateConsent.ts` | **P11.1.** Server action backing the `/cookie-preferences` form. Zod-validates, persists via `recordConsent`, writes a focused before/after audit-log entry, and revalidates the page. |
| `actions/recordBannerDecision.ts` | **P11.2.** Server action backing the cookie banner CTAs. Same surface as `updateConsent` but accepts an explicit `source` enum (`banner_accept_all` / `banner_decline_non_essential` / `banner_save_preferences`) + reads geo + GPC + IP from the request headers + persists the `uthena_anon_id` cookie. |
| `lib/consentEvents.ts` | **P11.3.** Module-scoped `CONSENT_CHANGED_EVENT` window CustomEvent + `dispatchConsentChanged()` helper. Lets the form/banner notify the consent-aware analytics bridge without prop-drilling. |
| `lib/consentEffects.ts` | **P11.3.** Pure-effect helpers the bridge uses: `applyInitialConsent(initial)` + `subscribeConsentChanged(handler)` + `defaultConsentChangedHandler(detail)`. Extracted so they're unit-testable without a DOM. |
| `lib/consentEvents.test.ts` | **P11.3.** Server-no-op guard + namespaced-event constant contract. |
| `lib/consentEffects.test.ts` | **P11.3.** `applyInitialConsent` + subscribe/listener-cleanup + handler defensive-coverage tests (mocked PostHog). |
| `components/CookiePreferencesForm.tsx` | **P11.1.** Client island — the three-row toggle UI on `/cookie-preferences`. **P11.3:** fires `uthena:consent:changed` after a successful save so PostHog flips opt-in/out on the same tick. |
| `components/CookiePreferencesForm.module.css` | Token-only styles. |
| `components/CookieConsentBanner.tsx` | **P11.2.** Client island — the bottom-fixed banner with Accept all / Decline / Customize CTAs. Renders nothing when `bannerState.showBanner === false`. **P11.3:** fires `uthena:consent:changed` after a successful decision. |
| `components/CookieConsentBanner.module.css` | Token-only styles (mobile-responsive, no inline colors). |
| `components/ConsentAwareAnalytics.tsx` | **P11.3.** Client island — bridges `ConsentState` to the PostHog SDK's opt-in / opt-out API. Mounted once from the root layout; renders null. |
| `components/ConsentAwareAnalytics.module.css` | Empty (the island renders null — file exists for directory consistency). |
| `index.ts` | Public barrel. |

## How the flows work

### P11.1 — granular preferences page (`/cookie-preferences`)

```
[user]        GET /cookie-preferences
              (link from footer, or direct URL)
[server]      RSC page route (`app/cookie-preferences/page.tsx`)
                ├─ getServerSupabase().auth.getUser()  → signedIn?
                └─ getCurrentConsent()                  → initial state
              Renders <CookiePreferencesForm initial={...} hasRecord={...} signedIn={...} />
[user]        Toggle analytics + marketing
              Submit "Save preferences"
[client]      updateConsentAction({ analytics, marketing })
[server]      Zod parse (ConsentStateInput — essential absent, locked schema-side)
              Read prior consent_log row (signed-in only) for diff
              recordConsent(userId, state, ip_hash, ua, { source: 'page_save_preferences' })
                                                     → consent_log INSERT
              writeSelfAuditLog('consent_self_update', before/after)
                                                     → admin_audit_log
              revalidatePath('/cookie-preferences')
[client]      Result applied to local state; router.refresh() so any other
              RSC consumer (the footer, the privacy page summary, etc.) updates.
```

### P11.2 — geo-gated banner (mounted in root layout)

```
[visitor]     GET /*  (any page)
[server]      <CookieBannerMount /> (RSC, server-only) inside <ErrorBoundary>
                └─ getConsentBannerState()                → showBanner + reason
              Renders <CookieConsentBanner bannerState={state} />
              (returns null when showBanner=false)

  getConsentBannerState() priority (highest first):
   1. Sec-GPC: 1 → reason 'gpc_active', no banner, consent = off everywhere
   2. signed-in consent_log row found → reason 'prior_decision_user', no banner
   3. anon_id consent_log row found → reason 'prior_decision_anon_id', no banner
   4. cf-ipcountry / x-vercel-ip-country in EU_COUNTRY_CODES → reason 'show_eu_geo'
   5. geo header absent or sentinel (XX, T1) → reason 'show_unknown_geo' (PHASES.md fallback)
   6. confirmed non-EU → reason 'hide_non_eu_geo', no banner

[visitor]     Click Accept all / Decline / Customize
[client]      recordBannerDecisionAction({ analytics, marketing, source })
              dispatchConsentChanged(decision)        ← P11.3 — same tick
[server]      Zod parse (RecordBannerDecisionInput)
              Read headers → country (cdn) + gpc (Sec-GPC) + IP + UA
              ensureAnonId() — mints a fresh UUID + writes the cookie if absent
              recordConsent(userId, state, ip, ua, { country, gpc, source, anonId })
                                                    → consent_log INSERT
              revalidatePath('/', 'layout')
[client]      router.refresh() — the next RSC render resolves showBanner=false
```

### P11.3 — consent-aware analytics bridge (mounted in root layout)

```
[visitor]     GET /*  (any page)
[server]      <ConsentAwareAnalyticsBridge /> (RSC, server-only)
                └─ getConsentBannerState() → { consent }  (shared lookup with banner)
              Renders <ConsentAwareAnalytics initial={state.consent} />
              (the island renders null — pure side-effect)

[client mount]    applyInitialConsent(initial)
                    ├─ initPostHog()                      (idempotent)
                    └─ setPostHogConsent(initial.analytics)
                  subscribeConsentChanged(defaultConsentChangedHandler)
                    ↳ returns cleanup() — invoked on unmount

[visitor]     CookiePreferencesForm → submit successful save
              dispatchConsentChanged(result.consent)       (no await)
              router.refresh()                              (async)

[client]      <ConsentAwareAnalytics> listener fires
              defaultConsentChangedHandler(detail)
                ↳ setPostHogConsent(detail.analytics)  ← same tick, no RTT
```

Why the event fires BEFORE `router.refresh()`: GDPR Art. 7(3) says withdrawal
of consent must be as easy as giving it and effective immediately. Waiting
for the revalidation round-trip would leave analytics firing for the
200–500ms the refresh takes.

## Privacy contract

- **PII safe.** Neither query selects `ip_hash`, `user_agent`, or `id`. The action reads IP/UA only to feed the `recordConsent` helper, which hashes the IP before storage. Audit-log rows never carry the raw email, IP, or UA — pino's redact list is the second gate. The new `country` + `gpc` + `anon_id` columns are all low-sensitivity (2-letter code, true/false, UUID) — none are PII on their own.
- **Essential is locked.** The schema (`ConsentStateInput` + `RecordBannerDecisionInput`) doesn't expose `essential`; the form + banner lock the toggle visually + logically. A bad-actor client can't disable essential cookies.
- **Anon users.** Can read defaults + submit preferences. Their `consent_log` rows are written with `user_id = NULL` + hashed IP, matching the existing RLS policy. The `uthena_anon_id` cookie lets us correlate multiple anon decisions across pages without using the IP.
- **GPC respected.** When the browser sends `Sec-GPC: 1`, the banner is suppressed (the visitor has already declined); the audit log records `source='gpc_auto_decline'` so compliance can prove "we received the signal and acted on it."
- **Geo fallback.** PHASES.md says "fall-back to show to all". The banner is shown when geo is absent (so EU visitors behind a misconfigured proxy still get asked) and hidden for confirmed non-EU visitors.

## Spec

- `01-specs/pages/cookie-preferences.md` — P11.1 acceptance criteria + **P11.3 implementation notes** (withdrawal + immediate analytics-stop contract)
- `PHASES.md` §P11.1, §P11.2, §P11.3 — task scope
- `00-foundations/gdpr/consent.ts` — `recordConsent` helper (the contract every consent-surface row goes through)
- `00-foundations/gdpr/geo.ts` — `EU_COUNTRY_CODES` + `readCountryFromHeaders` + `isGpcEnabled`
- `00-foundations/gdpr/anon-id.ts` — `uthena_anon_id` cookie helpers
- `00-foundations/analytics/posthog.ts` — `initPostHog()` + `setPostHogConsent(granted)`
- `04-platform/migrations/0001_initial.sql` — the `consent_log` table (RLS in place)
- `04-platform/migrations/0037_consent_log_enhancements.sql` — adds `country` + `gpc` + `source` + `anon_id` columns

## What's NOT here

- **Per-category script loaders.** PostHog init reads `localStorage` + the cookie-preferences state at mount time. The `record_consent` row is the durable source of truth; the banner is the entry point that primes localStorage.
- **24-month anonymization cron** — STUB-P11.6 territory. The schema + retention map are already correct (24 months for `consent_log` per `00-foundations/gdpr/retention.ts`).
- **Per-call consent guard inside `trackEvent` / `trackTypedEvent`.** PostHog's `opt_out_capturing` is the gate; the SDK refuses capture after opt-out. A defense-in-depth per-call guard is a Phase 18 compliance-pass follow-up, not P11.3 scope.
- **`uthena:consent:changed` as a server-side signal.** P11.3 keeps the event client-side only (the audit-log row from `updateConsentAction` / `recordBannerDecisionAction` is the durable forensic record).
