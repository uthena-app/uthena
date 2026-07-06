// ProfileForm — the editable form on /account/profile. 'use client'.
// Handles:
//   - display_name, bio, locale, timezone edits
//   - avatar display + "Remove" (no upload — STUB-017 → P9.2)
//   - read-only email + verification badge
//   - dirty-state + beforeunload (external nav) + global click
//     interceptor (in-app Link nav) guard
//   - Save → server action with toast-on-success, inline-on-error
//   - Reset → revert to last-saved
//
// Why a custom global click interceptor (not useBlocker from
// next/navigation): the useBlocker export was added to
// next/navigation in Next 14, but the shape and stability of the
// hook have varied across Next 15 minor versions. The project
// pins to Next 15.0.3 where useBlocker is not exported. A
// global click interceptor on the document is the project-wide
// fallback (the AGENTS.md "use the project's existing form
// primitives" rule). We match the same pattern the admin
// modals use: catch internal <a> clicks, intercept when the
// form is dirty, show a confirm dialog, and either let the
// navigation proceed (on confirm) or cancel it (on dismiss).
//
// Why a datalist for the timezone (not a <select>): the spec
// (`01-specs/pages/account-profile.md` line 77) calls for a
// *searchable* timezone picker. There are ~400 IANA tz values;
// a native <select> is a wall of unsearchable options. The
// datalist pattern gives free search-by-typing while keeping
// the input server-renderable (no client JS for the picker
// itself, just for the surrounding form).
'use client'

import { useCallback, useEffect, useId, useMemo, useState, useTransition } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Button, Input } from '@foundations/ui/primitives/Button'
import { useToast } from '@foundations/ui/Toast'
import { SUPPORTED_LOCALES, type ProfileWithEmail } from '../types'
import { updateProfileAction } from '../actions/updateProfile'
import { AvatarUploader } from './AvatarUploader'
import { EmailVerifyBadge } from './EmailVerifyBadge'
import styles from './ProfileForm.module.css'

type FormState = {
  display_name: string
  bio: string
  locale: string
  timezone: string
  avatar_url: string | null
}

function initialForm(p: ProfileWithEmail): FormState {
  return {
    display_name: p.display_name,
    bio: p.bio ?? '',
    locale: p.locale || 'en',
    timezone: p.timezone || 'UTC',
    avatar_url: p.avatar_url,
  }
}

export function ProfileForm({ profile }: { profile: ProfileWithEmail }) {
  const router = useRouter()
  const pathname = usePathname()
  const toast = useToast()
  const [state, setState] = useState<FormState>(() => initialForm(profile))
  const [savedState, setSavedState] = useState<FormState>(() => initialForm(profile))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const tzListId = useId()

  // Deep equality is fine here — FormState is small and JSON stable.
  // We avoid pulling a deep-equal dep just for this.
  const dirty = useMemo(
    () => JSON.stringify(state) !== JSON.stringify(savedState),
    [state, savedState],
  )

  // External navigation: beforeunload handles tab close / refresh /
  // external link. We only need to set `returnValue` for the
  // browser to show its native confirm.
  useEffect(() => {
    if (!dirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  // In-app navigation: Next.js <Link> clicks do not trigger
  // beforeunload. We catch them with a document-level click
  // interceptor. The interceptor is a no-op when the form is
  // clean. When dirty, it shows a confirm dialog and either
  // (a) lets the click proceed (user confirmed) or (b) prevents
  // it (user dismissed).
  //
  // We intentionally match the same "be liberal with internal
  // links" approach the rest of the app uses: only intercept
  // <a> clicks (not programmatic router.push), skip external
  // links (http/https/mailto), and skip modifier-key clicks
  // (ctrl/cmd/shift/alt) so users can open links in a new tab.
  useEffect(() => {
    if (!dirty) return
    const handler = (e: MouseEvent) => {
      if (e.defaultPrevented) return
      if (e.button !== 0) return
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const target = e.target as HTMLElement | null
      const anchor = target?.closest('a')
      if (!anchor) return
      const href = anchor.getAttribute('href')
      if (!href) return
      if (
        href.startsWith('http://') ||
        href.startsWith('https://') ||
        href.startsWith('mailto:') ||
        href.startsWith('tel:') ||
        href.startsWith('#')
      ) {
        return
      }
      if (anchor.target && anchor.target !== '_self') return
      // Normalize the link's path (strip query/hash) and skip
      // same-page links.
      const nextPath = href.split('?')[0]?.split('#')[0] ?? ''
      if (nextPath === pathname) return
      const ok = window.confirm(
        'You have unsaved changes on your profile. Leave this page anyway?',
      )
      if (!ok) {
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()
      }
    }
    document.addEventListener('click', handler, true)
    return () => document.removeEventListener('click', handler, true)
  }, [dirty, pathname])

  const onChange = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setState((s) => ({ ...s, [key]: value }))
    setErrors((e) => {
      if (!e[key]) return e
      const { [key]: _drop, ...rest } = e
      return rest
    })
  }, [])

  const onReset = useCallback(() => {
    setState(savedState)
    setErrors({})
    setSubmitError(null)
  }, [savedState])

  const onSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      if (!dirty) return
      setSubmitError(null)
      startTransition(async () => {
        const result = await updateProfileAction({
          display_name: state.display_name,
          bio: state.bio,
          locale: state.locale,
          timezone: state.timezone,
          avatar_url: state.avatar_url,
        })
        if (!result.ok) {
          setErrors(result.fieldErrors ?? {})
          setSubmitError(result.error)
          return
        }
        setSavedState(state)
        toast.success('Profile saved.')
        // Server may have normalized the value (e.g. trimmed). Refresh
        // the RSC so the page header (display_name) reflects the new
        // value.
        router.refresh()
      })
    },
    [dirty, state, router, toast],
  )

  return (
    <form onSubmit={onSubmit} className={styles.form} noValidate>
      <section className={styles.section}>
        <h2 className={styles.h2}>Profile</h2>
        <p className={styles.lede}>
          Tell other users a little about you. This information is private to your account.
        </p>

        <div className={styles.avatarRow}>
          <AvatarUploader
            avatarUrl={state.avatar_url}
            initials={(state.display_name || profile.email).slice(0, 1)}
            onUploaded={(publicUrl) => {
              // Update local form state — the avatar URL won't be
              // committed to `profiles` until the user clicks Save.
              onChange('avatar_url', publicUrl)
            }}
          />
          <div className={styles.avatarActions}>
            <p className={styles.avatarLabel}>
              {state.avatar_url ? 'Avatar set' : 'No avatar yet'}
            </p>
            <p className={styles.avatarHelp}>
              {state.avatar_url
                ? 'Click the avatar to replace it, or remove it below. Your change is saved when you click Save changes.'
                : 'Click to choose an image. Your change is saved when you click Save changes.'}
            </p>
            {state.avatar_url && (
              <button
                type="button"
                className={styles.linkBtn}
                onClick={() => onChange('avatar_url', null)}
              >
                Remove avatar
              </button>
            )}
          </div>
        </div>

        <div className={styles.field}>
          <Input
            label="Display name"
            value={state.display_name}
            onChange={(e) => onChange('display_name', e.target.value)}
            maxLength={80}
            error={errors.display_name}
            autoComplete="name"
            required
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="bio" className={styles.label}>
            Bio
          </label>
          <textarea
            id="bio"
            className={styles.textarea}
            value={state.bio}
            onChange={(e) => onChange('bio', e.target.value.slice(0, 280))}
            maxLength={280}
            rows={3}
            aria-invalid={errors.bio ? 'true' : undefined}
            aria-describedby="bio_help"
          />
          <div id="bio_help" className={styles.counter}>
            <span className={errors.bio ? styles.counterErr : ''}>{state.bio.length} / 280</span>
          </div>
          {errors.bio && (
            <p className={styles.fieldError} role="alert">
              {errors.bio}
            </p>
          )}
        </div>

        <div className={styles.grid2}>
          <div className={styles.field}>
            <label htmlFor="locale" className={styles.label}>
              Language
            </label>
            <select
              id="locale"
              className={styles.select}
              value={state.locale}
              onChange={(e) => onChange('locale', e.target.value)}
            >
              {SUPPORTED_LOCALES.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor="timezone" className={styles.label}>
              Timezone
            </label>
            {/*
              Searchable timezone picker. <datalist> gives free
              search-by-typing while keeping the input a real
              text field — no client JS needed for the picker itself.
              The list is rendered once at mount from
              Intl.supportedValuesOf('timeZone') (~400 entries); the
              browser filters by substring as the user types. The
              user is also free to type any IANA tz that exists in
              the list (the server-side Zod validator accepts any
              Intl-recognized value; we don't gate on the
              datalist being the canonical source).
            */}
            <input
              id="timezone"
              list={tzListId}
              className={styles.textInput}
              value={state.timezone}
              onChange={(e) => onChange('timezone', e.target.value)}
              autoComplete="off"
              spellCheck={false}
              aria-describedby="tz_help"
            />
            <datalist id={tzListId}>
              {Intl.supportedValuesOf('timeZone').map((tz) => (
                <option key={tz} value={tz} />
              ))}
            </datalist>
            <p id="tz_help" className={styles.hint}>
              Search by city or region (e.g. "Tokyo", "Europe/Paris")
            </p>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.h2}>Email</h2>
        <div className={styles.emailRow}>
          <div>
            <p className={styles.email}>{profile.email}</p>
            <p className={styles.emailHelp}>
              Email is private and not shown to other users. To change it, head to Settings
              (in a future slice).
            </p>
          </div>
          <EmailVerifyBadge verified={profile.email_verified} />
        </div>
        <div className={styles.changePwRow}>
          <a className={styles.linkBtn} href="/update-password">
            Change password
          </a>
        </div>
      </section>

      <div className={styles.actions}>
        {submitError && (
          <p className={styles.submitError} role="alert">
            {submitError}
          </p>
        )}
        <Button type="button" variant="ghost" onClick={onReset} disabled={!dirty || isPending}>
          Reset
        </Button>
        <Button type="submit" variant="primary" disabled={!dirty || isPending} loading={isPending}>
          Save changes
        </Button>
      </div>
    </form>
  )
}
