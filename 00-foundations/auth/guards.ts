// Auth guards — the only way to gate access in RSC, route handlers,
// and server actions. Every page that needs auth uses one of these.
//
// Design contract:
//   - `getSessionUser()` NEVER throws — it returns null for anonymous
//     callers. Use it when the page renders different chrome for
//     logged-in vs. anonymous users (e.g. the global header).
//   - `requireUser()`, `requireRole()`, `requirePartner()`,
//     `requireAffiliate()`, `requireAdmin()`, `requireSelfOrAdmin()`
//     all use `redirect()` from `next/navigation` on failure. That
//     throws a `NEXT_REDIRECT` error internally which Next.js
//     converts to an HTTP 307. Code after `redirect()` is unreachable;
//     TypeScript knows because `redirect()` is typed `never`.
//   - On `returnTo`: the caller passes an arbitrary URL/path. We run
//     it through `safeNext()` to defeat open-redirect attacks (a
//     common phishing vector). Unsafe values fall back to a plain
//     `/login` redirect with no `next` param — the user lands on the
//     home page after signing in rather than at an attacker-controlled
//     URL.
//   - Role hierarchy: admin ⊇ super_admin ⊇ customer for "elevated"
//     operations. The explicit `allowed[]` list in `requireRole` is
//     the single source of truth — never use string comparisons.
//
// Spec source: PHASES.md §P2.1 ("Auth guards audit — requireUser,
// requireRole, requirePartner, requireAffiliate, requireAdmin all
// implemented and tested (both authorized and unauthorized paths)").

import { redirect } from 'next/navigation'
import { getServerSupabase } from '@foundations/data/supabase'
import { safeNext } from './safe-next'

export type Role = 'customer' | 'partner' | 'affiliate' | 'admin' | 'super_admin'

export type SessionUser = {
  id: string
  email: string
  role: Role
  display_name: string
}

/**
 * Returns the session user, or null if not signed in. Safe to call
 * from any RSC / route handler / server action. NEVER throws.
 *
 * - Anon callers → returns null (callers branch on it).
 * - Authed caller with no `profiles` row → returns null (defensive —
 *   should never happen because `auth.users` insert triggers a
 *   `profiles` insert via `handle_new_user`).
 * - Authed caller with profile → returns the merged SessionUser.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  // Look up the profile for role + display_name. The profiles table
  // has a unique index on user_id; the FK from auth.users is enforced.
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, display_name')
    .eq('user_id', user.id)
    .single()
  if (!profile) return null
  return {
    id: user.id,
    email: user.email ?? '',
    role: (profile.role as Role) ?? 'customer',
    display_name: profile.display_name ?? user.email ?? 'User',
  }
}

/**
 * Redirect to `/login` if not signed in. Returns the user otherwise.
 *
 * The `returnTo` parameter is an optional URL or path the caller
 * wants the user to land on after sign-in. It's run through
 * `safeNext()` to defeat open-redirect attacks; unsafe values fall
 * back to a plain `/login` redirect.
 *
 * After a successful sign-in, the `/login` page reads `?next=` and
 * forwards the user to that path.
 */
export async function requireUser(returnTo?: string): Promise<SessionUser> {
  const user = await getSessionUser()
  if (!user) {
    const safeReturn = returnTo ? safeNext(returnTo) : null
    redirect(safeReturn ? `/login?next=${encodeURIComponent(safeReturn)}` : '/login')
  }
  return user
}

/**
 * Redirect to `/login` (anon) or `/403` (wrong role). Returns the
 * user when `user.role` is in `allowed`.
 *
 * Use this when no shorthand matches your needs. For the common
 * partner / affiliate / admin cases, use the dedicated helpers
 * (`requirePartner`, `requireAffiliate`, `requireAdmin`).
 */
export async function requireRole(
  allowed: readonly Role[],
  returnTo?: string,
): Promise<SessionUser> {
  const user = await requireUser(returnTo)
  if (!allowed.includes(user.role)) {
    redirect('/403')
  }
  return user
}

/** Require admin role (admin OR super_admin). */
export async function requireAdmin(): Promise<SessionUser> {
  return requireRole(['admin', 'super_admin'])
}

/**
 * Require partner (instructor) role.
 *
 * `admin` and `super_admin` are also accepted because they need
 * partner-portal access for support workflows (e.g. an admin
 * impersonating a partner via /admin/account-switcher).
 */
export async function requirePartner(): Promise<SessionUser> {
  return requireRole(['partner', 'admin', 'super_admin'])
}

/**
 * Require affiliate role.
 *
 * `admin` and `super_admin` are also accepted for the same reason
 * as `requirePartner` — the affiliate shell is gated to role
 * `affiliate` (plus admin elevation), not to "anyone".
 */
export async function requireAffiliate(): Promise<SessionUser> {
  return requireRole(['affiliate', 'admin', 'super_admin'])
}

/**
 * Resource-owner OR admin check. Used by routes that show a
 * specific user's data (e.g. `/account/orders/[id]` shows the order
 * only if the user owns it OR is an admin; `/admin/customers/[id]`
 * shows the customer's profile only to admins).
 *
 * - Anon → redirect to `/login?next=<safe>` (or `/login` if
 *   `returnTo` is unsafe).
 * - Self (`user.id === resourceUserId`) → returns the user.
 * - Admin OR super_admin → returns the user.
 * - Everyone else → redirect to `/403`.
 */
export async function requireSelfOrAdmin(
  resourceUserId: string,
  returnTo?: string,
): Promise<SessionUser> {
  const user = await requireUser(returnTo)
  if (user.id === resourceUserId) return user
  if (user.role === 'admin' || user.role === 'super_admin') return user
  redirect('/403')
}
