// Barrel re-export for the security module.
// Spec: 01-specs/pages/security-headers.md.

export {
  CSP_DIRECTIVES,
  CSP_VALUE,
  HSTS_VALUE,
  PERMISSIONS_POLICY_VALUE,
  UNIVERSAL_HEADERS,
  HTML_PAGE_EXTRA_HEADERS,
  classifyPath,
  getSecurityHeaders,
  applySecurityHeaders,
} from './headers'

export type {
  SecurityHeaders,
  SecurityHeaderVariant,
  GetSecurityHeadersOptions,
} from './headers'

// P12.19 — partner API token hashing. Used by
// `02-features/partner-portal/api-tokens/actions/*` and (future)
// `/api/v1/partner/*` middleware. The plaintext generator is
// exported for the create-action; the hash function is the canonical
// reference for both write (store) + read (lookup) paths.
export {
  API_TOKEN_PLAINTEXT_PREFIX,
  API_TOKEN_DISPLAY_PREFIX_CHARS,
  generateApiTokenPlaintext,
  buildApiTokenDisplayPrefix,
  hashApiToken,
  isApiTokenPepperConfigured,
} from './api-token'