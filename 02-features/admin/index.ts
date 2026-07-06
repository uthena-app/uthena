// Public surface of the admin feature. Consumers (the app/admin/*
// routes) import from `@features/admin` for the shell, and
// `@features/admin/categories` for the categories page.

export { AdminShell } from './shell/AdminShell'
export { AdminSidebar, ADMIN_NAV_SECTIONS } from './shell/AdminSidebar'
export { AdminTopbar } from './shell/AdminTopbar'
export { SignOutButton } from './shell/SignOutButton'

// Re-export the categories feature so the page route can grab
// everything it needs from a single import path.
export * as categories from './categories'

// Re-export the analytics feature (P14.16) so the page route can grab
// everything it needs from a single import path. The analytics feature
// also exports its members directly via `@features/admin/analytics`
// for callers that prefer the flat shape (matches the categories
// pattern below).
export * as analytics from './analytics'
