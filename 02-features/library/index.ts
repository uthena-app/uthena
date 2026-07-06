// Public surface of the library feature.
//
// Two barrels:
//   - `./` (this file) — server API + RSC-safe component re-exports.
//     Pulled into RSC pages (`/library/page.tsx`, `/library/downloads`,
//     `/library/watch/demo`). Re-exports queries, actions, types,
//     RSC primitives, AND the small client components that don't
//     pull heavy deps (LibraryRow, VaultItem, etc. — Next.js splits
//     them to a small client chunk).
//   - `./client` — heavy client components that pull deps not wanted
//     in the landing-page bundle. Currently just `VideoPlayer`,
//     because it imports `hls.js` at module top-level. Import from
//     `@features/library/client` to keep hls.js code-split to the
//     watch route only.
//
// This split mirrors the established pattern from
// `02-features/search/client.ts` (P0.4 + P0.5).

export { getUserLibrary, type AccessibleProduct } from './queries/getUserLibrary'
export { getUserAccessibleFiles, type VaultFile } from './queries/getUserAccessibleFiles'
export {
  getLibraryProduct,
  type LibraryProductPageData,
  type LibraryProductSummary,
  type LibraryProductAccess,
  type LibraryProductFile,
  type AccessSource,
} from './queries/getLibraryProduct'
export { getContinueWatching, type ContinueWatchingEntry } from './queries/getContinueWatching'
export {
  getSubscriptionCatalogAccess,
  type SubscriptionCatalogAccess,
} from './queries/getSubscriptionCatalogAccess'
export {
  getDownloadHistory,
  DEFAULT_HISTORY_WINDOW_DAYS,
  MAX_HISTORY_ROWS,
  windowSince,
  type DownloadHistoryEntry,
  type DownloadHistoryFilters,
  type DownloadHistoryResult,
} from './queries/getDownloadHistory'
export { maskIp, shortUserAgent } from './queries/formatIp'
export { countActiveStreams } from './queries/countActiveStreams'

export { mintDownloadUrlAction, type MintResult } from './actions/mintDownloadUrl'
export { mintStreamUrlAction, type StreamMintResult } from './actions/mintStreamUrl'

export { LibraryRow } from './components/LibraryRow'
export { VaultItem } from './components/VaultItem'
export { GenerateLinkButton } from './components/GenerateLinkButton'
export { EmptyLibraryState } from './components/EmptyLibraryState'
export { LibraryStats, type LibraryStatsData } from './components/LibraryStats'
export { DownloadHistoryTable } from './components/DownloadHistoryTable'
export { DownloadHistoryFilterBar } from './components/DownloadHistoryFilters'
export { VaultFilterBar, type VaultProductOption } from './components/VaultFilterBar'
export { BulkDownloadBar, type BulkDownloadBarProps } from './components/BulkDownloadBar'

// P7.2 — per-product detail page on /library/[slug]. Slice 1
// ships the route + access gate + header + files + sharing sections
// + lesson/certificate placeholders. The lessons + certificate
// surfaces swap to real implementations when Phase 15 lands.
export { LibraryProductHeader } from './components/LibraryProductHeader'
export { LibraryProductFiles } from './components/LibraryProductFiles'
export { LibraryProductSharing } from './components/LibraryProductSharing'
export { LibraryProductLessons } from './components/LibraryProductLessons'
export { LibraryProductCertificate } from './components/LibraryProductCertificate'

// VideoPlayer is re-exported from `./client` ONLY — see the
// client.ts barrel header for why (hls.js dep). The pure helpers
// (PLAYBACK_RATES, DEFAULT_QUALITIES, isHlsSrc, formatTime, etc.)
// are safe to import from anywhere because VideoPlayer.types has no
// React / DOM / hls.js dependencies.
export {
  PLAYBACK_RATES,
  DEFAULT_QUALITIES,
  isHlsSrc,
  formatTime,
  buildQualityPresets,
  keyToAction,
  parseResumeSeconds,
  RESUME_SECONDS_MAX,
  type VideoPlayerProps,
  type VideoPlayerQuality,
  type VideoPlayerCaptions,
  type VideoPlayerState,
  type KeySeekResult,
} from './components/VideoPlayer.types'

export { groupVaultFilesByProduct, type VaultGroup } from './groupVaultFilesByProduct'
export { filterVaultFiles, type VaultFilterOptions } from './filterVaultFiles'

export { formatDuration, formatBytes } from './format'