// refund-proof-upload-constants.test.ts — pure unit tests for the
// refund-proof upload constants + sanitizer.
//
// Coverage:
//   - REFUND_PROOF_MAX_BYTES = 10 MiB (matches the spec)
//   - REFUND_PROOF_MIME_TYPES is exactly {jpeg, png, pdf}
//   - extForRefundProofMime returns jpg/png/pdf; null for unknown
//   - sanitizeRefundProofFilename:
//       - happy path: strips directories + replaces bad chars
//       - path-traversal: `../../etc/passwd` → 'passwd'
//       - Windows separators: `C:\\foo\\bar.png` → 'bar.png'
//       - empty / null / undefined → 'unnamed'
//       - all-bad chars (e.g. emoji-only) → 'unnamed'
//       - leading/trailing dots and underscores stripped
//       - long filenames capped at 120 chars
//       - collapses runs of underscores

import { describe, expect, it } from 'vitest'
import {
  REFUND_PROOF_MAX_BYTES,
  REFUND_PROOF_MIME_TYPES,
  REFUND_PROOF_PATH_PREFIX,
  extForRefundProofMime,
  sanitizeRefundProofFilename,
} from './refund-proof-upload-constants'

describe('REFUND_PROOF_MAX_BYTES', () => {
  it('is 10 MiB (10 * 1024 * 1024 = 10485760)', () => {
    expect(REFUND_PROOF_MAX_BYTES).toBe(10 * 1024 * 1024)
  })
})

describe('REFUND_PROOF_MIME_TYPES', () => {
  it('is exactly {image/jpeg, image/png, application/pdf}', () => {
    expect(REFUND_PROOF_MIME_TYPES).toEqual([
      'image/jpeg',
      'image/png',
      'application/pdf',
    ])
  })
})

describe('REFUND_PROOF_PATH_PREFIX', () => {
  it('is "refund-proofs"', () => {
    expect(REFUND_PROOF_PATH_PREFIX).toBe('refund-proofs')
  })
})

describe('extForRefundProofMime', () => {
  it('maps image/jpeg to jpg', () => {
    expect(extForRefundProofMime('image/jpeg')).toBe('jpg')
  })
  it('maps image/png to png', () => {
    expect(extForRefundProofMime('image/png')).toBe('png')
  })
  it('maps application/pdf to pdf', () => {
    expect(extForRefundProofMime('application/pdf')).toBe('pdf')
  })
  it('returns null for unknown mime (defense)', () => {
    expect(extForRefundProofMime('image/gif')).toBeNull()
    expect(extForRefundProofMime('application/zip')).toBeNull()
    expect(extForRefundProofMime('')).toBeNull()
  })
})

describe('sanitizeRefundProofFilename — happy path', () => {
  it('passes through a clean alphanumeric filename', () => {
    expect(sanitizeRefundProofFilename('receipt.pdf')).toBe('receipt.pdf')
    expect(sanitizeRefundProofFilename('Screen Shot 2026-06-29.png')).toBe(
      'Screen_Shot_2026-06-29.png',
    )
  })

  it('strips path traversal sequences', () => {
    expect(sanitizeRefundProofFilename('../../etc/passwd')).toBe('passwd')
    expect(sanitizeRefundProofFilename('../../../../etc/shadow')).toBe('shadow')
    expect(sanitizeRefundProofFilename('a/../../b/../c.pdf')).toBe('c.pdf')
  })

  it('strips Windows-style separators', () => {
    expect(sanitizeRefundProofFilename('C:\\foo\\bar.png')).toBe('bar.png')
    expect(sanitizeRefundProofFilename('D:\\Users\\me\\file.pdf')).toBe('file.pdf')
    expect(sanitizeRefundProofFilename('mixed/and\\separators.jpg')).toBe('separators.jpg')
  })

  it('replaces every disallowed character with underscore', () => {
    expect(sanitizeRefundProofFilename('my file!.pdf')).toBe('my_file_.pdf')
    expect(sanitizeRefundProofFilename('with spaces.png')).toBe('with_spaces.png')
    expect(sanitizeRefundProofFilename('quote".pdf')).toBe('quote_.pdf')
    expect(sanitizeRefundProofFilename('angle<bracket>.pdf')).toBe('angle_bracket_.pdf')
  })

  it('collapses runs of underscores', () => {
    // The sanitizer collapses `_` runs (contiguous underscores) into
    // a single `_`. It deliberately does NOT collapse `..` because
    // dots are part of valid filename structure (extension separator,
    // version numbers like `myapp.v2.pdf`).
    expect(sanitizeRefundProofFilename('my..file___name.pdf')).toBe('my..file_name.pdf')
    expect(sanitizeRefundProofFilename('@@!!@@.pdf')).toBe('unnamed.pdf')
    expect(sanitizeRefundProofFilename('multiple    spaces.pdf')).toBe(
      'multiple_spaces.pdf',
    )
  })

  it('strips leading + trailing dots and underscores', () => {
    expect(sanitizeRefundProofFilename('..hidden.png')).toBe('hidden.png')
    expect(sanitizeRefundProofFilename('___leading.pdf')).toBe('leading.pdf')
    expect(sanitizeRefundProofFilename('trailing...')).toBe('trailing')
  })
})

describe('sanitizeRefundProofFilename — defensive', () => {
  it('returns "unnamed" for null', () => {
    expect(sanitizeRefundProofFilename(null)).toBe('unnamed')
  })
  it('returns "unnamed" for undefined', () => {
    expect(sanitizeRefundProofFilename(undefined)).toBe('unnamed')
  })
  it('returns "unnamed" for empty string', () => {
    expect(sanitizeRefundProofFilename('')).toBe('unnamed')
  })
  it('returns "unnamed" for whitespace-only', () => {
    expect(sanitizeRefundProofFilename('   ')).toBe('unnamed')
  })
  it('returns the extension-only fallback for all-bad-character names', () => {
    // When the entire base-name portion of the file is composed of
    // disallowed characters, only the extension survives. We surface
    // that as `unnamed.<ext>` rather than a bare extension so admins
    // see "this is unnamed" instead of a confusing `pdf` with no
    // context.
    expect(sanitizeRefundProofFilename('🎉🎉🎉.pdf')).toBe('unnamed.pdf')
    expect(sanitizeRefundProofFilename('🎉🎉🎉🎉🎉.png')).toBe('unnamed.png')
    expect(sanitizeRefundProofFilename('🎉.jpg')).toBe('unnamed.jpg')
  })
})

describe('sanitizeRefundProofFilename — length cap', () => {
  it('caps filenames at 120 characters', () => {
    const long = 'a'.repeat(200) + '.pdf'
    const out = sanitizeRefundProofFilename(long)
    expect(out.length).toBeLessThanOrEqual(120)
    expect(out.length).toBe(120)
  })

  it('does NOT cap short filenames', () => {
    const short = 'a'.repeat(50) + '.pdf'
    const out = sanitizeRefundProofFilename(short)
    expect(out.length).toBeLessThanOrEqual(120)
    expect(out).toBe(short)
  })
})

describe('sanitizeRefundProofFilename — output invariants', () => {
  it('output never contains path separators', () => {
    const samples = [
      '../../../etc/passwd',
      'C:\\Windows\\System32\\evil.exe',
      'normal/file.pdf',
      'mixed\\and/slash.jpg',
      'a/b\\c/d.pdf',
    ]
    for (const s of samples) {
      const out = sanitizeRefundProofFilename(s)
      expect(out).not.toMatch(/[\\/]/)
    }
  })

  it('output never contains a newline or control character', () => {
    const samples = [
      'file\nname.pdf',
      'file\rname.pdf',
      'file\tname.pdf',
      'file\x00name.pdf',
      'file;rm -rf /.pdf',
    ]
    for (const s of samples) {
      const out = sanitizeRefundProofFilename(s)
      expect(out).not.toMatch(/[\n\r\t\x00]/)
      // Shell-injection-ish sequences: the `;` is replaced with `_`.
      expect(out).not.toMatch(/[;|`$]/)
    }
  })
})