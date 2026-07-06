// Public surface of the account shell module. The route layout
// (`app/account/layout.tsx`) imports `AccountShell` from this barrel.
//
// The deeper account feature (`account/profile/`) is the legacy
// self-edit surface (profile/settings/orders/refunds/etc.); it has
// its own barrel at `account/profile/`. The shell + the profile
// module are siblings — both under `02-features/account/`.

export { AccountShell } from './AccountShell'
export { AccountSidebarActive } from './AccountSidebarActive'