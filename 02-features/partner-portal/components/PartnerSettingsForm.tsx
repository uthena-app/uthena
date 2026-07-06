// PartnerSettingsForm — client component. The settings form on
// /partner/settings. Inline-save server action.
//
// P6.5 Slice 1: the PayPal email field is now encrypted at rest via
// `00-foundations/security/encryption.ts`. The query returns a typed
// shape with both `paypal_email` (plaintext, for the input value) and
// `paypal_email_masked` (for read-only display). The form shows the
// masked form when the partner hasn't clicked "Edit", and reveals
// the input pre-filled with the plaintext when they do.
//
// P12.17: form extended with three new surfaces:
//   - **Headshot link**: the partner's avatar lives on `/account/profile`
//     (per spec: "those live on /account/profile and the two pages
//     never edit the same field"). This form surfaces a link card
//     pointing there so the partner knows where to update their
//     headshot without duplicating the avatar uploader.
//   - **Social links**: 5-field grid (twitter / linkedin / youtube /
//     github / website). Each is its own Zod-validated input with the
//     platform-appropriate regex. Empty inputs are sent as `''` and
//     compact to `null` server-side (DB only stores set fields).
//   - **Public profile toggle**: opt-in boolean. When true, the
//     partner's profile becomes visible on the future standalone
//     /partner/[slug] page. Disabled (with a friendly warning) when
//     `status !== 'approved'` because an unapproved partner can't
//     have a public profile.
//   - **Toast on save**: replaces the inline `.submitOk` paragraph
//     (P9.1's Toast primitive is mounted in the root layout, so any
//     client surface can call `useToast()` without prop drilling).
//
// P12.18 sub-slice: form now renders the read-only "Next payout"
// preview block inside the Payout section. Three fields from the
// spec that P6.5 Slice 1 didn't cover:
//   - `minimum_payout_cleared` — badge: green when the partner's
//     available balance is at or above `MIN_PAYOUT_REQUEST_CENTS`,
//     amber when below. Lets the partner see at a glance whether
//     they could request a payout today.
//   - `next_payout_date` — mono date of the next scheduled payout
//     run (the 1st of next month per the P6.6 schedule). Rendered
//     via the canonical date helpers so the format matches every
//     other payout surface.
//   - `next_payout_amount_cents` — mono amount that's queued for
//     the next payout (the full available balance, since v1 doesn't
//     support split payouts per `request-options.ts`). Renders as
//     a money value via the existing `@foundations/money/cents`
//     helpers.
// Bank details + Stripe Connect onboarding stay gated on the live
// Stripe / PayPal creds (STUB-053); they ship in P12.18 Slice 2.

'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Button } from '@foundations/ui/primitives/Button'
import { useToast } from '@foundations/ui/Toast'
import { updatePartnerSettingsAction } from '../actions/updatePartnerSettings'
import type { PartnerProfile } from '../queries/getMyPartnerProfile'
import type { PayoutNext } from '../lib/computePayoutNext'
import { maskTaxId } from '../format'
import { formatMoney } from '@foundations/money/cents'
import { formatDate } from '@features/payouts/format'
import styles from './PartnerSettingsForm.module.css'

export function PartnerSettingsForm({
  partner,
  payoutNext,
}: {
  partner: PartnerProfile
  payoutNext: PayoutNext
}) {
  const toast = useToast()
  const [bio, setBio] = useState(partner.bio ?? '')
  const [websiteUrl, setWebsiteUrl] = useState(partner.website_url ?? '')
  const [taxCountry, setTaxCountry] = useState(partner.tax_country ?? 'US')
  const [taxId, setTaxId] = useState(partner.tax_id ?? '')
  // P6.5 Slice 1 — payout_method is now a typed shape with
  // `paypal_email` (plaintext) + `paypal_email_masked` (display).
  // The form's local state holds the plaintext email; the read-only
  // display uses the masked form until the partner clicks "Edit".
  const [paypalEmail, setPaypalEmail] = useState(partner.payout_method.paypal_email ?? '')
  const [paypalEditing, setPaypalEditing] = useState(partner.payout_method.paypal_email == null)
  // P12.17 — social links. Local state mirrors the typed shape
  // (string | null for each field). The DB column is jsonb but the
  // form layer is a flat object — each field's input is its own
  // controlled input.
  const [socialTwitter, setSocialTwitter] = useState(partner.social_links.twitter ?? '')
  const [socialLinkedin, setSocialLinkedin] = useState(partner.social_links.linkedin ?? '')
  const [socialYoutube, setSocialYoutube] = useState(partner.social_links.youtube ?? '')
  const [socialGithub, setSocialGithub] = useState(partner.social_links.github ?? '')
  const [socialWebsite, setSocialWebsite] = useState(partner.social_links.website ?? '')
  // P12.17 — public profile toggle.
  const [isPublic, setIsPublic] = useState(partner.is_public)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // P12.17 — public profile toggle is gated on `status = 'approved'`
  // because an unapproved partner can't have a public profile. We
  // still render the toggle (read-only disabled) so the partner can
  // see why it's off.
  const canBePublic = partner.status === 'approved'

  const dirty =
    bio !== (partner.bio ?? '') ||
    websiteUrl !== (partner.website_url ?? '') ||
    taxCountry !== (partner.tax_country ?? 'US') ||
    taxId !== (partner.tax_id ?? '') ||
    paypalEmail !== (partner.payout_method.paypal_email ?? '') ||
    socialTwitter !== (partner.social_links.twitter ?? '') ||
    socialLinkedin !== (partner.social_links.linkedin ?? '') ||
    socialYoutube !== (partner.social_links.youtube ?? '') ||
    socialGithub !== (partner.social_links.github ?? '') ||
    socialWebsite !== (partner.social_links.website ?? '') ||
    isPublic !== partner.is_public

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setErrors({})
    setSubmitError(null)
    startTransition(async () => {
      const result = await updatePartnerSettingsAction({
        bio,
        website_url: websiteUrl,
        tax_country: taxCountry,
        tax_id: taxId,
        paypal_email: paypalEmail,
        social_links: {
          twitter: socialTwitter,
          linkedin: socialLinkedin,
          youtube: socialYoutube,
          github: socialGithub,
          website: socialWebsite,
        },
        is_public: isPublic,
      })
      if (!result.ok) {
        setSubmitError(result.error)
        if (result.fieldErrors) setErrors(result.fieldErrors)
        toast.error(result.error)
        return
      }
      toast.success('Settings saved.')
      // After a successful save, collapse the PayPal row back to
      // the read-only masked view.
      setPaypalEditing(false)
    })
  }

  return (
    <form onSubmit={onSubmit} className={styles.form} noValidate>
      <section className={styles.section}>
        <h2 className={styles.h2}>Profile</h2>
        <p className={styles.lede}>Public-facing profile info shown on your product pages.</p>

        {/* P12.17 — headshot link. The avatar/headshot uploader lives
            on /account/profile (per spec); this card surfaces a clear
            pointer so the partner knows where to update it. The link
            is a real <a href> via Next.js Link, no client JS. */}
        <div className={styles.field}>
          <span className={styles.label}>
            Headshot <span className={styles.optional}>(avatar)</span>
          </span>
          <Link href="/account/profile" className={styles.headshotLink}>
            <span>Edit on your profile page</span>
            <span className={styles.headshotLinkArrow} aria-hidden="true">
              →
            </span>
          </Link>
          <p className={styles.help}>
            Your headshot is shared across the partner surface and your public profile (when
            enabled below). It's edited once on the account profile page.
          </p>
        </div>

        <div className={styles.field}>
          <label htmlFor="bio" className={styles.label}>
            Bio <span className={styles.optional}>(max 500 chars)</span>
          </label>
          <textarea
            id="bio"
            className={styles.textarea}
            value={bio}
            onChange={(e) => setBio(e.target.value.slice(0, 500))}
            maxLength={500}
            rows={4}
          />
          <p className={styles.counter}>
            {bio.length} / 500
          </p>
        </div>

        <div className={styles.field}>
          <label htmlFor="website_url" className={styles.label}>
            Website URL <span className={styles.optional}>(optional)</span>
          </label>
          <input
            id="website_url"
            type="url"
            className={styles.input}
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
            placeholder="https://example.com"
          />
          {errors.website_url && (
            <p className={styles.error} role="alert">
              {errors.website_url}
            </p>
          )}
        </div>
      </section>

      {/* P12.17 — social links. 5-field 2-column grid (collapses to
          1 column at ≤ 540px). Each input is platform-specific Zod
          regex on the server (twitter 1-15 alnum + underscore;
          linkedin slug; youtube handle/URL; github username; website
          https URL). Empty inputs → omitted from DB jsonb. */}
      <section className={styles.section}>
        <h2 className={styles.h2}>Social links</h2>
        <p className={styles.lede}>
          Where buyers can find you elsewhere. Shown on your public profile when public profile is
          enabled.
        </p>
        <div className={styles.socialGrid}>
          <div className={styles.field}>
            <label htmlFor="social_twitter" className={styles.label}>
              Twitter / X
            </label>
            <input
              id="social_twitter"
              type="text"
              className={styles.input}
              value={socialTwitter}
              onChange={(e) => setSocialTwitter(e.target.value)}
              placeholder="@yourhandle"
              maxLength={50}
            />
            {errors['social_links.twitter'] && (
              <p className={styles.error} role="alert">
                {errors['social_links.twitter']}
              </p>
            )}
          </div>
          <div className={styles.field}>
            <label htmlFor="social_linkedin" className={styles.label}>
              LinkedIn
            </label>
            <input
              id="social_linkedin"
              type="text"
              className={styles.input}
              value={socialLinkedin}
              onChange={(e) => setSocialLinkedin(e.target.value)}
              placeholder="your-slug"
              maxLength={100}
            />
            {errors['social_links.linkedin'] && (
              <p className={styles.error} role="alert">
                {errors['social_links.linkedin']}
              </p>
            )}
          </div>
          <div className={styles.field}>
            <label htmlFor="social_youtube" className={styles.label}>
              YouTube
            </label>
            <input
              id="social_youtube"
              type="text"
              className={styles.input}
              value={socialYoutube}
              onChange={(e) => setSocialYoutube(e.target.value)}
              placeholder="@yourchannel or full URL"
              maxLength={200}
            />
            {errors['social_links.youtube'] && (
              <p className={styles.error} role="alert">
                {errors['social_links.youtube']}
              </p>
            )}
          </div>
          <div className={styles.field}>
            <label htmlFor="social_github" className={styles.label}>
              GitHub
            </label>
            <input
              id="social_github"
              type="text"
              className={styles.input}
              value={socialGithub}
              onChange={(e) => setSocialGithub(e.target.value)}
              placeholder="your-username"
              maxLength={50}
            />
            {errors['social_links.github'] && (
              <p className={styles.error} role="alert">
                {errors['social_links.github']}
              </p>
            )}
          </div>
          <div className={styles.field}>
            <label htmlFor="social_website" className={styles.label}>
              Website
            </label>
            <input
              id="social_website"
              type="url"
              className={styles.input}
              value={socialWebsite}
              onChange={(e) => setSocialWebsite(e.target.value)}
              placeholder="https://yoursite.com"
              maxLength={500}
            />
            {errors['social_links.website'] && (
              <p className={styles.error} role="alert">
                {errors['social_links.website']}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* P12.17 — public profile toggle. Opt-in. When `true` and
          status === 'approved', the partner's profile becomes
          queryable from the future standalone /partner/[slug] page.
          Gated on `status = 'approved'` because an unapproved
          partner cannot have a public profile. */}
      <section className={styles.section}>
        <h2 className={styles.h2}>Public profile</h2>
        <p className={styles.lede}>
          Allow buyers to find your full profile on the partner directory.
        </p>
        {!canBePublic ? (
          <p className={styles.publicProfileDisabled} role="status">
            Your partner profile is not yet approved. Public profile visibility unlocks after
            admin approval.
          </p>
        ) : (
          <div className={styles.publicProfileRow}>
            <div className={styles.publicProfileText}>
              <span className={styles.publicProfileLabel}>Show my profile publicly</span>
              <span className={styles.publicProfileHint}>
                When on, your bio, website, social links, and headshot are visible at /partner/
                {partner.public_slug ?? 'your-slug'}.
              </span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={isPublic}
              aria-label="Toggle public profile visibility"
              onClick={() => setIsPublic((v) => !v)}
              data-state={isPublic ? 'on' : 'off'}
              className={styles.editBtn}
            >
              {isPublic ? 'On' : 'Off'}
            </button>
          </div>
        )}
      </section>

      <section className={styles.section}>
        <h2 className={styles.h2}>Payout</h2>
        <p className={styles.lede}>How we pay you. PayPal is the only method in v1.</p>

        <div className={styles.field}>
          <label htmlFor="paypal_email" className={styles.label}>
            PayPal email
          </label>
          {paypalEditing ? (
            <>
              <input
                id="paypal_email"
                type="email"
                className={styles.input}
                value={paypalEmail}
                onChange={(e) => setPaypalEmail(e.target.value)}
                placeholder="you@paypal.com"
                autoFocus
              />
              {errors.paypal_email && (
                <p className={styles.error} role="alert">
                  {errors.paypal_email}
                </p>
              )}
              <p className={styles.help}>
                Must be a different address from your login email. We send payouts here on the
                1st of every month. Encrypted at rest.
              </p>
            </>
          ) : (
            <>
              <div className={styles.readonlyRow}>
                <span className={styles.masked} aria-label="PayPal email (masked)">
                  {partner.payout_method.paypal_email_masked ?? <em className={styles.empty}>Not set</em>}
                </span>
                <button
                  type="button"
                  className={styles.editBtn}
                  onClick={() => setPaypalEditing(true)}
                  aria-label="Edit PayPal email"
                >
                  Edit
                </button>
              </div>
              <p className={styles.help}>
                Encrypted at rest. We send payouts here on the 1st of every month.
              </p>
            </>
          )}
        </div>

        {/*
          P12.18 — read-only "Next payout preview" block. The
          paypal_email above is what the partner edits; the three
          fields below are derived from the ledger summary so the
          partner can see at a glance:
            (a) whether their balance clears the $50 minimum;
            (b) when the next payout is scheduled;
            (c) what would land on that payout.

          The whole block is read-only (no inputs, no buttons) so
          it doesn't contribute to the `dirty` flag below. The
          mono-date + mono-number + the badge use the same
          `data-status` CSS attribute pattern as the rest of the
          partner portal so it's visually consistent with the
          `SummaryCards` on `/partner/payouts`.
        */}
        <div
          className={styles.payoutPreviewCard}
          data-cleared={payoutNext.minimum_payout_cleared ? 'true' : 'false'}
          aria-label="Next payout preview"
        >
          <div className={styles.payoutPreviewRow}>
            <span className={styles.payoutPreviewLabel}>Status</span>
            <span
              className={styles.payoutPreviewBadge}
              data-status={payoutNext.minimum_payout_cleared ? 'success' : 'warn'}
            >
              {payoutNext.minimum_payout_cleared
                ? 'Minimum cleared'
                : `Below $50 minimum`}
            </span>
          </div>
          <div className={styles.payoutPreviewRow}>
            <span className={styles.payoutPreviewLabel}>Next payout date</span>
            <span className={styles.payoutPreviewMono}>
              {/*
                `formatDate` parses ISO via `new Date(iso)` and
                renders with Intl. We pass `timeZone: 'UTC'` so
                the calendar day shown matches the literal date
                the helper produced — a midnight UTC parse in a
                server timezone east of UTC would otherwise show
                "Jul 31" instead of "Aug 1".
              */}
              {formatDate(payoutNext.next_payout_date, 'en-US', 'UTC')}
            </span>
          </div>
          <div className={styles.payoutPreviewRow}>
            <span className={styles.payoutPreviewLabel}>Next payout amount</span>
            <span className={styles.payoutPreviewMono}>
              {formatMoney(payoutNext.next_payout_amount_cents)}
            </span>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.h2}>Tax</h2>
        <p className={styles.lede}>
          Required for issuing 1099s (US) or equivalent tax forms. We do NOT share this with
          the public.
        </p>

        <div className={styles.grid2}>
          <div className={styles.field}>
            <label htmlFor="tax_country" className={styles.label}>
              Country
            </label>
            <input
              id="tax_country"
              type="text"
              className={styles.input}
              value={taxCountry}
              onChange={(e) => setTaxCountry(e.target.value.slice(0, 2).toUpperCase())}
              maxLength={2}
              placeholder="US"
            />
            {errors.tax_country && (
              <p className={styles.error} role="alert">
                {errors.tax_country}
              </p>
            )}
          </div>
          <div className={styles.field}>
            <label htmlFor="tax_id" className={styles.label}>
              Tax ID (EIN / SSN)
            </label>
            <input
              id="tax_id"
              type="text"
              className={styles.input}
              value={taxId}
              onChange={(e) => setTaxId(e.target.value.slice(0, 64))}
              placeholder="12-3456789"
            />
            {errors.tax_id && (
              <p className={styles.error} role="alert">
                {errors.tax_id}
              </p>
            )}
            {taxId && (
              <p className={styles.help}>
                Displayed masked: <span className={styles.maskedInline}>{maskTaxId(taxId) ?? '***'}</span>
              </p>
            )}
          </div>
        </div>
      </section>

      {submitError && (
        <p className={styles.submitError} role="alert">
          {submitError}
        </p>
      )}

      <div className={styles.actions}>
        <Button type="submit" variant="primary" disabled={!dirty || isPending} loading={isPending}>
          Save changes
        </Button>
      </div>
    </form>
  )
}