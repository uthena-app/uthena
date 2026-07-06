// upload-kinds.test.ts — unit tests for the per-kind mime allowlist +
// size cap + filename sanitizer (P12.8 Slice 1 pure module).

import { describe, expect, it } from 'vitest'
import {
  allowedMimesForUploadKind,
  buildPartnerStoragePath,
  defaultExtensionForKind,
  extensionFromFilename,
  isMimeAllowedFor,
  maxBytesForUploadKind,
  sanitizePartnerFilename,
  UPLOAD_FILENAME_MAX_LENGTH,
  UPLOAD_SALES_MATERIAL_MIME_TYPES,
  UPLOAD_SALES_MATERIAL_MAX_BYTES,
  UPLOAD_SOURCE_MIME_TYPES,
  UPLOAD_SOURCE_MAX_BYTES,
  UPLOAD_VIDEO_MIME_TYPES,
  UPLOAD_VIDEO_MAX_BYTES,
} from './upload-kinds'

describe('upload-kinds constants', () => {
  it('video allowlist is exactly {mp4, mov}', () => {
    expect([...UPLOAD_VIDEO_MIME_TYPES].sort()).toEqual(['video/mp4', 'video/quicktime'].sort())
  })
  it('source allowlist matches the spec (PDF/PPTX/DOCX/ZIP)', () => {
    expect([...UPLOAD_SOURCE_MIME_TYPES].sort()).toEqual(
      [
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/zip',
        'application/x-zip-compressed',
      ].sort(),
    )
  })
  it('sales_material allowlist matches the spec (PDF/ZIP/JPEG/PNG)', () => {
    expect([...UPLOAD_SALES_MATERIAL_MIME_TYPES].sort()).toEqual(
      ['application/pdf', 'application/zip', 'application/x-zip-compressed', 'image/jpeg', 'image/png'].sort(),
    )
  })
  it('video cap is 50 GiB (spec hard cap)', () => {
    expect(UPLOAD_VIDEO_MAX_BYTES).toBe(50 * 1024 * 1024 * 1024)
  })
  it('source cap is 2 GiB', () => {
    expect(UPLOAD_SOURCE_MAX_BYTES).toBe(2 * 1024 * 1024 * 1024)
  })
  it('sales_material cap is 200 MiB', () => {
    expect(UPLOAD_SALES_MATERIAL_MAX_BYTES).toBe(200 * 1024 * 1024)
  })
})

describe('maxBytesForUploadKind', () => {
  it('returns the video cap for kind=video', () => {
    expect(maxBytesForUploadKind('video')).toBe(UPLOAD_VIDEO_MAX_BYTES)
  })
  it('returns the source cap for kind=source', () => {
    expect(maxBytesForUploadKind('source')).toBe(UPLOAD_SOURCE_MAX_BYTES)
  })
  it('returns the sales_material cap for kind=sales_material', () => {
    expect(maxBytesForUploadKind('sales_material')).toBe(UPLOAD_SALES_MATERIAL_MAX_BYTES)
  })
})

describe('allowedMimesForUploadKind', () => {
  it('returns the video allowlist for kind=video', () => {
    expect(allowedMimesForUploadKind('video')).toEqual(UPLOAD_VIDEO_MIME_TYPES)
  })
  it('returns the source allowlist for kind=source', () => {
    expect(allowedMimesForUploadKind('source')).toEqual(UPLOAD_SOURCE_MIME_TYPES)
  })
  it('returns the sales allowlist for kind=sales_material', () => {
    expect(allowedMimesForUploadKind('sales_material')).toEqual(UPLOAD_SALES_MATERIAL_MIME_TYPES)
  })
})

describe('isMimeAllowedFor', () => {
  it('accepts video/mp4 for video', () => {
    expect(isMimeAllowedFor('video', 'video/mp4')).toBe(true)
  })
  it('accepts video/quicktime for video', () => {
    expect(isMimeAllowedFor('video', 'video/quicktime')).toBe(true)
  })
  it('rejects non-video mimes for video', () => {
    expect(isMimeAllowedFor('video', 'application/pdf')).toBe(false)
  })
  it('accepts application/pdf for source', () => {
    expect(isMimeAllowedFor('source', 'application/pdf')).toBe(true)
  })
  it('rejects image/jpeg for source', () => {
    expect(isMimeAllowedFor('source', 'image/jpeg')).toBe(false)
  })
  it('accepts image/png for sales_material', () => {
    expect(isMimeAllowedFor('sales_material', 'image/png')).toBe(true)
  })
  it('normalizes case (uppercase mimes OK)', () => {
    expect(isMimeAllowedFor('video', 'VIDEO/MP4')).toBe(true)
  })
  it('trims whitespace', () => {
    expect(isMimeAllowedFor('video', '  video/mp4  ')).toBe(true)
  })
  it('rejects unknown mime (typo)', () => {
    expect(isMimeAllowedFor('video', 'video/x-fake')).toBe(false)
  })
})

describe('defaultExtensionForKind', () => {
  it("video default is 'mp4'", () => {
    expect(defaultExtensionForKind('video')).toBe('mp4')
  })
  it("source default is 'zip'", () => {
    expect(defaultExtensionForKind('source')).toBe('zip')
  })
  it("sales_material default is 'pdf'", () => {
    expect(defaultExtensionForKind('sales_material')).toBe('pdf')
  })
})

describe('extensionFromFilename', () => {
  it('extracts the lowercase extension', () => {
    expect(extensionFromFilename('lead-magnet.PDF')).toBe('pdf')
  })
  it('handles dotted names (last dot wins)', () => {
    expect(extensionFromFilename('Q4.2026.lead-magnet.pdf')).toBe('pdf')
  })
  it('returns null when no extension', () => {
    expect(extensionFromFilename('no-extension-here')).toBeNull()
  })
  it('returns null for empty extension', () => {
    expect(extensionFromFilename('trailing.')).toBeNull()
  })
  it('rejects too-long extensions (>16 chars)', () => {
    expect(extensionFromFilename('a.aaaaaaaaaaaaaaaaa')).toBeNull()
  })
  it('rejects extensions with non-letters/digits', () => {
    expect(extensionFromFilename('file.tar.gz')).toBe('gz')
    expect(extensionFromFilename('file.pdf!')).toBeNull() // ! is not a letter/digit
  })
  it('rejects shell injection attempts in extension', () => {
    expect(extensionFromFilename('file.p;rm -rf')).toBeNull()
    expect(extensionFromFilename('file.pdf; ls')).toBeNull()
  })
})

describe('sanitizePartnerFilename', () => {
  it('keeps a normal filename unchanged', () => {
    expect(sanitizePartnerFilename('lead-magnet.pdf', 'sales_material', 1_700_000_000_000))
      .toBe('lead-magnet.pdf')
  })
  it('substitutes POSIX path components (NOT splitting — preserves the bytes as _)', () => {
    expect(sanitizePartnerFilename('/etc/passwd.pdf', 'sales_material', 1))
      .toBe('_etc_passwd.pdf')
  })
  it('substitutes Windows path components the same way (slashes only — `:` is a legal filename char on Linux)', () => {
    // C: stays as C:; the backslashes become underscores.
    expect(sanitizePartnerFilename('C:\\Users\\klaas\\Desktop\\x.pdf', 'sales_material', 1))
      .toBe('C:_Users_klaas_Desktop_x.pdf')
  })
  it('substitutes path-traversal attempts (the bytes stay, but no slashes = no traversal)', () => {
    expect(sanitizePartnerFilename('../../../etc/passwd.pdf', 'sales_material', 1))
      .toBe('.._.._.._etc_passwd.pdf')
  })
  it('replaces shell metacharacters with _', () => {
    expect(sanitizePartnerFilename('evil;rm -rf x.pdf', 'sales_material', 1))
      .toBe('evil_rm -rf x.pdf') // ; stripped; spaces preserved
  })
  it('replaces forward + back slashes with _', () => {
    expect(sanitizePartnerFilename('a/b\\c.pdf', 'sales_material', 1)).toBe('a_b_c.pdf')
  })
  it('replaces zero-width Unicode with _', () => {
    expect(sanitizePartnerFilename('a\u200Bb\u200Cc.pdf', 'sales_material', 1))
      .toBe('a_b_c.pdf')
  })
  it('replaces RTL-override with _', () => {
    expect(sanitizePartnerFilename('a\u202Eb.pdf', 'sales_material', 1)).toBe('a_b.pdf')
  })
  it('replaces NUL control bytes with _', () => {
    expect(sanitizePartnerFilename('a\x00b.pdf', 'sales_material', 1)).toBe('a_b.pdf')
  })
  it('replaces newline + tab with _', () => {
    expect(sanitizePartnerFilename('a\nb\tc.pdf', 'sales_material', 1)).toBe('a_b_c.pdf')
  })
  it('preserves spaces + dot + dash + underscore', () => {
    expect(sanitizePartnerFilename('Q4 2026 - Final_v3.pdf', 'sales_material', 1))
      .toBe('Q4 2026 - Final_v3.pdf')
  })
  it('caps length at UPLOAD_FILENAME_MAX_LENGTH while preserving the extension', () => {
    const longName = `${'x'.repeat(UPLOAD_FILENAME_MAX_LENGTH + 50)}.pdf`
    const result = sanitizePartnerFilename(longName, 'sales_material', 1)
    expect(result.length).toBeLessThanOrEqual(UPLOAD_FILENAME_MAX_LENGTH)
    expect(result.endsWith('.pdf')).toBe(true)
  })
  it('caps length on a no-extension input too', () => {
    const longName = `${'x'.repeat(UPLOAD_FILENAME_MAX_LENGTH + 50)}`
    const result = sanitizePartnerFilename(longName, 'sales_material', 1)
    expect(result.length).toBeLessThanOrEqual(UPLOAD_FILENAME_MAX_LENGTH)
  })
  it('synthesizes a fallback when the result is empty', () => {
    expect(sanitizePartnerFilename('', 'video', 1_700_000_000_000)).toMatch(/^file-video-/)
  })
  it('synthesizes a fallback when the result is just dots', () => {
    expect(sanitizePartnerFilename('...', 'video', 1_700_000_000_000)).toMatch(/^file-video-/)
  })
  it('synthesizes a fallback when the result is only whitespace', () => {
    expect(sanitizePartnerFilename('   ', 'video', 1_700_000_000_000)).toMatch(/^file-video-/)
  })
  it('uses the kind-specific default extension in the fallback', () => {
    expect(sanitizePartnerFilename('', 'video', 1_700_000_000_000)).toMatch(/\.mp4$/)
    expect(sanitizePartnerFilename('', 'source', 1_700_000_000_000)).toMatch(/\.zip$/)
    expect(sanitizePartnerFilename('', 'sales_material', 1_700_000_000_000)).toMatch(/\.pdf$/)
  })
})

describe('buildPartnerStoragePath', () => {
  it('returns the spec layout exactly', () => {
    expect(
      buildPartnerStoragePath({
        partnerId: '42',
        uploadId: '12345',
        fileId: 'uuid-abc',
        filename: 'lead-magnet.pdf',
        kind: 'sales_material',
      }),
    ).toBe('partner-uploads/42/12345/uuid-abc.pdf')
  })
  it('uses the kind default ext when filename has no extension', () => {
    expect(
      buildPartnerStoragePath({
        partnerId: '42',
        uploadId: '12345',
        fileId: 'uuid-abc',
        filename: 'no-ext',
        kind: 'video',
      }),
    ).toBe('partner-uploads/42/12345/uuid-abc.mp4')
  })
  it('lowercases the extension', () => {
    expect(
      buildPartnerStoragePath({
        partnerId: '42',
        uploadId: '12345',
        fileId: 'uuid-abc',
        filename: 'lead-magnet.PDF',
        kind: 'sales_material',
      }),
    ).toBe('partner-uploads/42/12345/uuid-abc.pdf')
  })
  it('strips a weird extension that fails the extensionFromFilename regex (falls back to kind default)', () => {
    expect(
      buildPartnerStoragePath({
        partnerId: '42',
        uploadId: '12345',
        fileId: 'uuid-abc',
        filename: 'file.pdf; ls',
        kind: 'sales_material',
      }),
    ).toBe('partner-uploads/42/12345/uuid-abc.pdf')
  })
})
