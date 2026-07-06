// Barrel for the error-boundary helpers. Used by app/error.tsx,
// app/global-error.tsx, and every per-route error.tsx file.
//
// Why a shared module (per DRY + the constitution's "code elegant"):
//   - ERR_ID_ALPHABET + generateErrorId + WarnGlyph were previously
//     duplicated across app/error.tsx and app/global-error.tsx
//     (per P0.23 tick). When we add per-route boundaries (P2.11),
//     the duplication compounds. One source of truth is the
//     maintainable shape.
//   - The shared module is server-only + tree-shaken; the per-route
//     files that import it stay RSC-friendly with the existing
//     `'use client'` boundary above them.

export { ERR_ID_ALPHABET, ERR_ID_LENGTH, generateErrorId, makeErrorReference } from './generate-error-id'
export { WarnGlyph } from './WarnGlyph'
export { RouteError, type RouteErrorConfig } from './RouteError'