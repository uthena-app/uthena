# Cookie preferences — `/cookie-preferences`

## What this page does

The granular cookie-consent management page. Lets a visitor flip each
non-essential cookie category on or off (analytics, marketing) and save
the decision. Essential is always on (the site can't run without it).

Reachable from the global footer ("Cookie preferences" link in the
Company column) and from any direct URL. Works for both signed-in and
anonymous visitors — signed-in users get cross-device sync via the
`consent_log` row, anonymous visitors see the same UI with a "sign in
to save across devices" hint.

Distinct from the consent banner (PH12 / P11.2 territory). The banner
is the first-prompt entry point; this page is the always-available
preferences surface for users who already said yes/no once and now
want to revisit.

## Data this page shows

| Field | Source | Format | Sort/filter |
|---|---|---|---|
| Essential toggle state | `getCurrentConsent()` (or `DEFAULT_CONSENT`) | always `true` | n/a |
| Analytics toggle state | `getCurrentConsent()` (or `DEFAULT_CONSENT`) | boolean | n/a |
| Marketing toggle state | `getCurrentConsent()` (or `DEFAULT_CONSENT`) | boolean | n/a |
| `hasRecord` (has prior consent row?) | `getCurrentConsent()` | boolean | n/a |
| `signedIn` (is the user signed in?) | `supabase.auth.getUser()` | boolean | n/a |

The form also reads the `lastSavedAt` timestamp from the most recent
consent_log row, but only displays the *time-ago* phrasing computed
in the form (not a precise timestamp).

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Toggle analytics | Click analytics row switch | Local state flips; Save button enables | Anyone |
| Toggle marketing | Click marketing row switch | Local state flips; Save button enables | Anyone |
| Reset | Click "Reset" button | Local state reverts to the server-known initial | Anyone |
| Save preferences | Click "Save preferences" button | `updateConsentAction({ analytics, marketing })` server action persists the row + writes audit log + revalidates the page | Anyone |

## What this page does NOT do

- **Display a cookie banner.** The banner is P11.2. This page is reachable
  only via the footer link or a direct URL in P11.1.
- **Persist preferences for anon users in a way that survives across
  devices.** Anon writes land in `consent_log` with `user_id = NULL` +
  hashed IP — the `consent_log_self_read` policy allows reading them
  via `user_id IS NULL`, but a future P11.2 cookie banner will introduce
  an anon-ID cookie for cross-device persistence. P11.1 ships the
  server-side write for anon, and the page surfaces a hint telling anon
  users to sign in for cross-device sync.
- **Edit individual scripts.** The page is per-category, not per-script.
  P11.5 (cookie scanner) + the future admin tools own that surface.
- **Toggle essential off.** Impossible — locked at the schema (essential
  isn't in the input shape), the form (no toggle, "Always on" badge),
  and the action (no code path reads or writes it).
- **Show the full cookie table.** The "About these categories" section
  explains each category in plain language. The canonical cookie list
  lives in the Privacy Policy (`/privacy`) and is auto-generated from
  `RETENTION_POLICIES` (P10.2 ships the related retention summary;
  cookie-by-cookie enumeration is a v2 follow-up).

## Acceptance criteria

- [ ] Three categories visible: Essential, Analytics, Marketing.
- [ ] Essential is locked ON with an "Always on" badge; there is no
      toggle UI for it; the underlying Zod schema rejects `essential`
      in the input.
- [ ] Each non-essential category has a one-paragraph description of
      what data it collects and where it goes.
- [ ] Toggling a non-essential category enables the "Save preferences"
      button; reverting all toggles to their initial values disables it.
- [ ] Submitting the form calls the `updateConsentAction` server action,
      persists a row to `consent_log`, and re-renders the page with the
      new state.
- [ ] Signed-in users see "Your preferences are saved to your account
      and apply across every device where you sign in." under the form.
- [ ] Anonymous users see "You aren't signed in, so your preferences
      are stored with a hashed identifier on this device. Sign in to
      save them to your account." with a link to
      `/login?next=/cookie-preferences`.
- [ ] Errors surface inline as a `role="alert"` block with a friendly
      message ("Please review your selections." for invalid input;
      "Could not save your preferences. Please try again." for unknown).
- [ ] On save success, the "Last saved …" timestamp updates and the
      Save button disables.
- [ ] The footer has a "Cookie preferences" link in the Company column
      pointing to `/cookie-preferences`.
- [ ] The page has OG + Twitter Card meta via `buildPageMetadata`, JSON-LD
      WebPage schema, and ISR 24h.
- [ ] Server-side render: zero client JS for the page chrome (the
      CookiePreferencesForm is the only client island).
- [ ] The `consent_log` row carries the user's `user_id` (or null for
      anon), the three boolean columns (essential always true), an IP
      hash (never the raw IP), and a user-agent string.
- [ ] Every consent change writes a focused before/after row to
      `admin_audit_log` with `action='consent_self_update'`,
      `target_kind='consent_log'`, `target_id=<user.id>`.
- [ ] The page never logs the user's email or raw IP — pino's redact
      list covers these paths.

## Design reference

No dedicated mockup. The page uses the existing legal-page shell
rhythm (`eyebrow + h1 + lede + interactive surface + detail section`)
plus the focus + token conventions from `00-foundations/ui/focus/` and
the catalog card color discipline. The toggle pill matches the
onboarding flow's switch widget. The three-row card layout mirrors the
SettingsForm section shape.

## Implementation notes

### P11.3 — Withdrawal flow + immediate analytics stop

**Scope.** The withdrawal path is the same surface the `/cookie-preferences`
form already exposes — the only thing P11.3 adds is the analytics-stop
guarantee. When the user toggles analytics OFF (whether via the page form,
or via the cookie banner's "Decline non-essential" CTA, or via the
banner's expanded "Save preferences" with analytics flipped off), the
client-side PostHog SDK flips to opt-out on the same tick — no page
reload, no waiting for the next server round-trip.

**Why a dedicated sub-spec.** P11.1 ships the form + the consent_log
write; P11.2 ships the banner + the geo gate; neither wires PostHog to
the consent state. `setPostHogConsent(granted)` exists in
`00-foundations/analytics/posthog.ts` but no caller invokes it. This
section is the bridge.

**Surface area.** Two new files (one shared event constant + one client
island that listens). Three modified files (form + banner fire the
event on save; root layout mounts the island). No new server action, no
new migration, no new env.

```
02-features/consent/lib/consentEvents.ts        — CONSENT_CHANGED_EVENT const + dispatchConsentChanged()
02-features/consent/components/ConsentAwareAnalytics.tsx  — the bridge
02-features/consent/components/CookiePreferencesForm.tsx  — fire event on save success
02-features/consent/components/CookieConsentBanner.tsx   — fire event on save success
03-app/layout.tsx + app/layout.tsx               — mount <ConsentAwareAnalytics initial={resolved.consent} />
```

**The contract.**

- `CONSENT_CHANGED_EVENT = 'uthena:consent:changed'` — a window
  `CustomEvent<{ essential: true; analytics: boolean; marketing: boolean }>`.
  Pattern mirrors `02-features/search/searchEvents.ts` (a named event
  avoids prop-drilling from RSC → client).
- `<ConsentAwareAnalytics initial={...} />` mounted once in the root
  layout. On mount: `initPostHog()` (idempotent; no-op when the env
  key is missing) then `setPostHogConsent(initial.analytics)`. On any
  `uthena:consent:changed` event: `setPostHogConsent(detail.analytics)`.
- The form + the banner fire the event **optimistically on save
  success** — the moment the server action returns `{ ok: true,
  consent: {...} }`, the client dispatches the event BEFORE
  `router.refresh()`. That guarantees the analytics stop is immediate
  (no race with revalidation).
- The initial state passed into the island is the same
  `getConsentBannerState().consent` projection the banner uses — no
  extra DB read; the layout already does the lookup.

**Edge cases.**

- **No PostHog key configured.** `initPostHog()` short-circuits when
  `NEXT_PUBLIC_POSTHOG_KEY` is empty. `setPostHogConsent()` is also a
  no-op when PostHog has not been initialized. The whole island is
  always safe to mount; the analytics surface is opt-in by design.
- **GPC active.** When the request carries `Sec-GPC: 1`,
  `getConsentBannerState` returns `consent: { analytics: false,
  marketing: false }`. The bridge reads that and PostHog stays opted
  out. The user is also never shown the banner.
- **Anon user with no prior decision.** `consent: DEFAULT_CONSENT`
  (analytics off, marketing off). PostHog stays opted out. The moment
  they accept via the banner or save via the form, the event flips
  PostHog on.
- **Server-action failure.** Form or banner reverts to the
  pre-submit state and shows an inline error. The event is NOT fired,
  so PostHog state mirrors the last known durable state.

**Acceptance criteria.**

- [ ] The footer has a "Cookie preferences" link in the Company column
      (already shipped as part of P11.1 verification; listed here for
      clarity since PHASES.md P11.3 names it).
- [ ] `<ConsentAwareAnalytics>` is mounted in the root layout (`app/layout.tsx`
      + dual-tree hardlink `03-app/layout.tsx`).
- [ ] Toggling analytics ON, then OFF, then ON, then OFF again via the
      `/cookie-preferences` form fires `uthena:consent:changed` once
      per successful save (4 events total).
- [ ] The PostHog SDK is initialized exactly once per page load (the
      `initialized` module-level guard in `posthog.ts` owns this).
- [ ] When the user withdraws analytics consent (flips the toggle
      OFF), PostHog's `opt_out_capturing` is called on the same tick
      the success toast / last-saved timestamp updates — no
      `router.refresh()` round-trip needed before analytics stops.
- [ ] When PostHog is unconfigured (`NEXT_PUBLIC_POSTHOG_KEY` empty),
      the page renders identically with no client JS errors and no
      analytics requests.
- [ ] The bridge is a no-op for signin/signout flows — PostHog is
      still tied to the device, not the user identity.
- [ ] No `window` event listener is left dangling after the layout
      unmounts (the `useEffect` cleanup runs).

**What's NOT in P11.3 Slice 1.**

- **A defense-in-depth per-call consent check** in `trackEvent` /
  `trackTypedEvent`. PostHog's `opt_out_capturing` is the documented
  gate; we trust the SDK to refuse capture after opt-out. A future
  "compliance audit" pass could add a per-call guard, but it's not
  needed for P11.3.
- **An audit-log row on withdrawal specifically.** The existing
  `consent_self_update` row from `updateConsentAction` /
  `recordBannerDecisionAction` already covers the durable record.
- **A GPC-aware server-side middleware write.** GPC is honored
  read-only today (`getConsentBannerState` reacts to `Sec-GPC: 1`).
  Persisting a `gpc_auto_decline` row is a Phase 18 follow-up.

**Open questions**

- **Q1.** Should the page be reachable from `/account/settings` (in
  addition to the footer) once P11.2 lands? Likely yes for signed-in
  users (so they can manage cookies from one place). Tracked as a
  follow-up — not in P11.1 scope.
- **Q2.** Should `consent_self_update` audit rows include the IP hash
  for forensics? Today they don't — we only log the field labels +
  before/after booleans. If support needs IP-hash correlation, that's
  a one-line addition to the metadata payload. Deferred.
- **Q3.** When the cookie banner (P11.2) lands, does it deep-link to
  this page when the user clicks "Manage preferences"? Yes — banner
  CTA → `/cookie-preferences`. That link is already wired by the
  shared `uthena:cookie-prefs:open` event surface that P11.2 will add.