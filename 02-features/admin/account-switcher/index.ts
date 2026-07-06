// Public surface for the account-switcher feature module. Pages
// import from here, not from the inner files (the barrel keeps the
// page's import surface small + future-proof).

export { ImpersonationSearch } from './components/ImpersonationSearch'
export { ImpersonationResults } from './components/ImpersonationResults'
export { SwitchToUserButton } from './components/SwitchToUserButton'
export { RecentSessions } from './components/RecentSessions'
export { MIN_REASON_LEN, MAX_REASON_LEN } from './constants'
export type { ImpersonatableUser } from './queries/searchUsersForImpersonation'
export type { ImpersonationSessionRow } from './queries/listRecentImpersonationSessions'
