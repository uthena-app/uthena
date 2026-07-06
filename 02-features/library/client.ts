// Client-safe barrel for the library feature. Use this from any
// component marked `'use client'` — re-exports only the client
// components, NOT any server-only modules (queries / actions /
// server utilities). The server barrel `02-features/library/index.ts`
// re-exports everything; pulling from there in a client component
// would transitively pull in `import "server-only"` and break the
// build (the P0.5 mobile-nav lesson — see `Memory.md`).
//
// The split mirrors the established pattern from
// `02-features/search/client.ts` (P0.4 + P0.5).

export { LibraryRow } from './components/LibraryRow'
export { VaultItem } from './components/VaultItem'
export { GenerateLinkButton } from './components/GenerateLinkButton'
export { EmptyLibraryState } from './components/EmptyLibraryState'
export { LibraryStats, type LibraryStatsData } from './components/LibraryStats'
export { DownloadHistoryTable } from './components/DownloadHistoryTable'
export { DownloadHistoryFilterBar } from './components/DownloadHistoryFilters'
export { VaultFilterBar, type VaultProductOption } from './components/VaultFilterBar'
export { BulkDownloadBar, type BulkDownloadBarProps } from './components/BulkDownloadBar'
export { VideoPlayer } from './components/VideoPlayer'