// scripts/prep-import-lib.mjs
//
// Pure helpers for the previous-year-question-paper (PYQ) import pipeline.
//
// WHY THIS EXISTS
// The corpus arrives as a ZIP of PDFs (English + Kannada, digital and scanned).
// Before anything is parsed, uploaded or sent to an AI provider we need a
// honest triage of what is actually inside: how many files, which language,
// does the PDF have a usable text layer, or is it a scan / a legacy-font
// (Nudi / KGP) file that only a vision model can read.
//
// Everything here is deliberately dependency-free and side-effect-free so it
// can run on the operator's Windows PC (`node scripts/prep-import.mjs`) and in
// `node:test` without installing anything.
//
// Nothing in this file touches Firestore, Storage, the network or the disk.

import { inflateRawSync } from 'node:zlib'

// ─── Catalogue constants (mirrors of the TypeScript source of truth) ─────────
//
// These MUST match functions/src/prepPapers.ts. The unit test
// scripts/prep-import-lib.test.mjs parses the TypeScript file and fails if the
// two drift, so this duplication can never go stale silently.

/** PREP_PAPER_UNIVERSITIES codes (functions/src/prepPapers.ts). */
export const PREP_UNIVERSITY_CODES = [
  'bcu',
  'bu',
  'bnu',
  'kud',
  'mu',
  'kuvempu',
  'uom',
  'tu',
  'dvu',
  'rcub',
  'vsku',
  'gug',
  'stagnes-mu',
]

/** PREP_PROGRAM_CATALOG codes (functions/src/prepShared.ts). */
export const PREP_PROGRAM_CODES = ['bba', 'bcom', 'bca', 'bsc', 'ba', 'cse', 'ece', 'eee', 'me', 'mba', 'mcom', 'mca']

/** University full names → code, longest first so "Bengaluru North" wins over "Bangalore". */
const UNIVERSITY_NAME_HINTS = [
  ['bengaluru north', 'bnu'],
  ['bangalore north', 'bnu'],
  ['bengaluru city', 'bcu'],
  ['bangalore city', 'bcu'],
  ['bangalore university', 'bu'],
  ['karnatak university', 'kud'],
  ['karnataka university', 'kud'],
  ['mangalore university', 'mu'],
  ['mangaluru university', 'mu'],
  ['kuvempu', 'kuvempu'],
  ['mysore', 'uom'],
  ['tumkur', 'tu'],
  ['davangere', 'dvu'],
  ['rani channamma', 'rcub'],
  ['vijayanagara', 'vsku'],
  ['vsk', 'vsku'],
  ['gulbarga', 'gug'],
  ['kalaburagi', 'gug'],
  ['st agnes', 'stagnes-mu'],
]

const MONTHS = {
  jan: { n: 1, name: 'January' },
  january: { n: 1, name: 'January' },
  feb: { n: 2, name: 'February' },
  february: { n: 2, name: 'February' },
  mar: { n: 3, name: 'March' },
  march: { n: 3, name: 'March' },
  apr: { n: 4, name: 'April' },
  april: { n: 4, name: 'April' },
  may: { n: 5, name: 'May' },
  jun: { n: 6, name: 'June' },
  june: { n: 6, name: 'June' },
  jul: { n: 7, name: 'July' },
  july: { n: 7, name: 'July' },
  aug: { n: 8, name: 'August' },
  august: { n: 8, name: 'August' },
  sep: { n: 9, name: 'September' },
  sept: { n: 9, name: 'September' },
  september: { n: 9, name: 'September' },
  oct: { n: 10, name: 'October' },
  october: { n: 10, name: 'October' },
  nov: { n: 11, name: 'November' },
  november: { n: 11, name: 'November' },
  dec: { n: 12, name: 'December' },
  december: { n: 12, name: 'December' },
}

// ─── Script / language detection ─────────────────────────────────────────────

/** Indic scripts the app supports, as [code, start, end] inclusive ranges. */
const SCRIPT_RANGES = [
  ['kn', 0x0c80, 0x0cff], // Kannada
  ['hi', 0x0900, 0x097f], // Devanagari
  ['ta', 0x0b80, 0x0bff], // Tamil
  ['te', 0x0c00, 0x0c7f], // Telugu
  ['ml', 0x0d00, 0x0d7f], // Malayalam
]

function scriptOf(cp) {
  for (const [code, lo, hi] of SCRIPT_RANGES) if (cp >= lo && cp <= hi) return code
  if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a)) return 'en'
  if (cp >= 0x00c0 && cp <= 0x024f) return 'latin-ext' // À-ÿ, Ā-ɏ
  return 'other'
}

/**
 * Counts which scripts a piece of text really uses.
 *
 * Returns `{ primary, ratios }` where ratios are fractions of the counted
 * letters (Kannada matras/viramas count as Kannada letters — a Kannada word
 * without them is not possible, and with them the ratio stays stable).
 */
export function detectScript(text) {
  const counts = {}
  let total = 0
  for (const ch of String(text || '')) {
    const cp = ch.codePointAt(0)
    if (cp === undefined) continue
    // Skip whitespace, digits and punctuation — letters only.
    if (cp <= 0x20) continue
    if (cp >= 0x30 && cp <= 0x39) continue
    if (cp >= 0x2000 && cp <= 0x206f) continue
    const code = scriptOf(cp)
    if (code === 'other') continue
    counts[code] = (counts[code] || 0) + 1
    total += 1
  }
  const ratios = {}
  for (const [code, n] of Object.entries(counts)) ratios[code] = total ? n / total : 0
  let primary = 'none'
  // An Indic script decides the pipeline even when English letters outnumber it
  // (a bilingual paper "ಭಾರತದ … Explain the …" still needs the AI/Kannada path).
  for (const [code, ,] of SCRIPT_RANGES) {
    const r = ratios[code] || 0
    if (r >= 0.1 && r > (ratios[primary] || 0)) primary = code
  }
  if (primary === 'none') {
    let best = 0
    for (const [code, r] of Object.entries(ratios)) {
      if (r > best) {
        best = r
        primary = code
      }
    }
  }
  return { primary, ratios, letters: total }
}

/** True when the text uses Kannada script at all (any meaningful share). */
export function hasKannada(text, minRatio = 0.05) {
  return (detectScript(text).ratios.kn || 0) >= minRatio
}

/**
 * Detects Karnataka's legacy-font mojibake.
 *
 * A large share of older Karnataka university papers were typeset in Nudi or
 * KGP fonts: the PDF *looks* like Kannada, but its text layer is Latin-1
 * gibberish ("PÀ£ÁðlPÀ", "¥Àæ±Éß¥ÀwæPÉ") because the font's glyphs sit on ASCII
 * code points. Extracted text from those files is unusable — the file must be
 * read visually (rendered page → vision model) instead of via the text layer.
 *
 * Signature: many Latin-1 supplement letters AND common Nudi/KGP digraphs.
 */
export function detectLegacyFont(text) {
  const s = String(text || '')
  if (!s) return { suspicious: false, hints: 0, latinExtRatio: 0 }
  const script = detectScript(s)
  const latinExt = script.ratios['latin-ext'] || 0
  const hints = (
    s.match(/(PÀ|ªÀ|£À|¥À|§À|¸À|ºÀ|AiÀ|UÀ|zÀ|æÀ|jÀ|«À|ÃÀ|Ñ|qÀ|ªÁ|PÁ|¥Á|UÁ|¨sÁ|rPÀ)/g) || []
  ).length
  const markers = /(PÀ£ÁðlPÀ|¥Àæ±Éß|¥Àæ±Éß¥ÀwæPÉ|¸ÀA¸ÉÜ|«zÁåyð)/.test(s) ? 2 : 0
  const suspicious = (latinExt >= 0.25 && hints >= 3) || markers > 0
  return { suspicious, hints: hints + markers, latinExtRatio: latinExt }
}

// ─── File classification ─────────────────────────────────────────────────────

/** Pages below this many characters per page are treated as "no text layer". */
export const MIN_CHARS_PER_PAGE = 40
/** Matches MIN_TEXT_CHARS in functions/src/paperParsing.ts (120). */
export const MIN_CHARS_TOTAL = 120

/**
 * Buckets one document by what the importer can do with it.
 *
 *   digital-en      text layer, English          → deterministic parse (free)
 *   digital-kn      text layer, mostly Kannada   → AI text parse (Kannada)
 *   digital-mixed   text layer, both scripts     → AI text parse
 *   legacy-font     Kannada paper in Nudi/KGP    → AI vision parse (render pages)
 *   scanned         no usable text layer         → AI vision parse (OCR)
 *   empty           zero-byte / unreadable page count
 *   unsupported     not a PDF/DOCX
 */
export function classifyDocument({ chars = 0, pages = 0, script = null, legacyFont = null, ext = 'pdf' } = {}) {
  const e = String(ext || '').toLowerCase().replace(/^\./, '')
  if (e && e !== 'pdf' && e !== 'docx') return 'unsupported'
  const charsPerPage = pages > 0 ? chars / pages : chars
  if (chars < MIN_CHARS_TOTAL || (pages > 0 && charsPerPage < MIN_CHARS_PER_PAGE)) {
    return pages > 0 || chars > 0 ? 'scanned' : 'empty'
  }
  if (legacyFont?.suspicious && (script?.ratios?.kn || 0) < 0.15) return 'legacy-font'
  const kn = script?.ratios?.kn || 0
  const en = script?.ratios?.en || 0
  if (kn >= 0.1 && en >= 0.1) return 'digital-mixed'
  if (kn >= 0.1) return 'digital-kn'
  return 'digital-en'
}

// ─── Filename metadata ───────────────────────────────────────────────────────

const ROMAN_SEM = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8 }

/**
 * Best-effort metadata from a filename. Filenames in these corpora are
 * usually the only structured thing present ("BCU-BCom-5th-Sem-Nov-2024.pdf",
 * "bcu_bba_3sem_2022.pdf"), so it is worth mining before any AI call — and it
 * lets the operator fix a wrong guess instead of guessing blind.
 */
export function guessPaperMetadata(fileName) {
  const raw = String(fileName || '')
  const base = raw.split(/[\\/]/).pop() || raw
  const s = base
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .toLowerCase()
    .replace(/[_+.]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')

  // Year: the last 4-digit year-looking token in a plausible range.
  let year = null
  const years = [...s.matchAll(/\b(19[89]\d|20[0-4]\d)\b/g)].map((m) => Number(m[1]))
  const plausible = years.filter((y) => y >= 2005 && y <= new Date().getFullYear() + 1)
  if (plausible.length) year = plausible[plausible.length - 1]
  else if (years.length) year = years[years.length - 1]

  // Month: first recognised month token (Jan / Nov-Dec / feb-mar all work).
  let month = null
  let monthName = null
  for (const tok of s.split('-')) {
    const key = tok.replace(/[^a-z]/g, '')
    if (MONTHS[key]) {
      month = MONTHS[key].n
      monthName = MONTHS[key].name
      break
    }
  }

  // Semester: "5th sem", "sem 5", "iii-sem", "third semester".
  let semester = null
  const numeric = s.match(/\b([1-8])\s*(?:st|nd|rd|th)?-?(?:sem|semester)\b/)
  const semFirst = s.match(/\b(?:sem|semester)-?([1-8])\b/)
  const roman = s.match(/\b(i{1,3}|iv|v|vi{1,3})-?(?:sem|semester)\b/)
  if (numeric) semester = Number(numeric[1])
  else if (semFirst) semester = Number(semFirst[1])
  else if (roman) semester = ROMAN_SEM[roman[1]] || null

  // Program: token-boundary matches only, longest first ("b.com" before "ba").
  let program = null
  let legacyProgram = null
  const token = s.split('-')
  for (const t of token) {
    const compact = t.replace(/\./g, '')
    if (compact === 'bcom' || compact === 'bcom') program = 'bcom'
    else if (compact === 'bba') program = 'bba'
    else if (compact === 'bbm') {
      program = 'bba'
      legacyProgram = 'bbm'
    } else if (compact === 'bsc') program = 'bsc'
    else if (compact === 'bca') program = 'bca'
    else if (compact === 'cse') program = 'cse'
    else if (compact === 'ece') program = 'ece'
    else if (compact === 'eee') program = 'eee'
    else if (compact === 'mech' || compact === 'mechanical') program = 'me'
    else if (compact === 'ba') program = 'ba'
    else if (compact === 'mcom') program = 'mcom'
    else if (compact === 'mba') program = 'mba'
    else if (compact === 'mca') program = 'mca'
    if (program) break
  }
  // 'me' is short and overloaded (BBA/MBA files also use it for Managerial
  // Economics), so it only names the Mechanical program when no other program
  // token appears anywhere in the filename.
  if (!program && token.some((t) => t.replace(/\./g, '') === 'me')) program = 'me'

  // University: exact code token first, then a full-name hint.
  let universityCode = null
  for (const t of token) {
    const compact = t.replace(/\./g, '')
    if (PREP_UNIVERSITY_CODES.includes(compact)) {
      universityCode = compact
      break
    }
  }
  if (!universityCode) {
    const flat = s.replace(/-/g, ' ')
    for (const [needle, code] of UNIVERSITY_NAME_HINTS) {
      if (flat.includes(needle)) {
        universityCode = code
        break
      }
    }
  }

  const missing = []
  if (!universityCode) missing.push('university')
  if (!program) missing.push('program')
  if (!semester) missing.push('semester')
  if (!year) missing.push('year')
  if (!month) missing.push('month')

  return { fileName: base, universityCode, program, legacyProgram, semester, year, month, monthName, missing }
}

// ─── Minimal ZIP reader (no dependencies) ───────────────────────────────────

const SIG_EOCD = 0x06054b50
const SIG_CENTRAL = 0x02014b50
const SIG_LOCAL = 0x04034b50
const SIG_ZIP64_EOCD = 0x06064b50

function decodeName(buf, flags) {
  // Bit 11 = the name is UTF-8. Without it the name is CP437, which for the
  // handful of bytes that matter (ASCII) is identical to latin1.
  if (flags & 0x0800) return buf.toString('utf8')
  const utf8 = buf.toString('utf8')
  return utf8.includes('\uFFFD') ? buf.toString('latin1') : utf8
}

function findEocd(buf) {
  const min = Math.max(0, buf.length - 66_000)
  for (let i = buf.length - 22; i >= min; i -= 1) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i
  }
  return -1
}

/**
 * Reads the central directory of a ZIP file.
 *
 * Only the central directory is trusted for sizes/offsets: entries written with
 * a data descriptor (bit 3) carry zeroed sizes in the local header, which is
 * the classic way a hand-rolled ZIP reader silently returns empty files.
 */
export function readZipEntries(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
  const eocd = findEocd(buf)
  if (eocd < 0) throw new Error('Not a ZIP file (no end-of-central-directory record found).')
  const total = buf.readUInt16LE(eocd + 10)
  const cdOffset = buf.readUInt32LE(eocd + 16)
  const zip64 = buf.readUInt32LE(Math.max(0, eocd - 20)) === SIG_ZIP64_EOCD
  const entries = []
  let p = cdOffset
  for (let i = 0; i < total; i += 1) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_CENTRAL) break
    const flags = buf.readUInt16LE(p + 8)
    const method = buf.readUInt16LE(p + 10)
    const compSize = buf.readUInt32LE(p + 20)
    const size = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOffset = buf.readUInt32LE(p + 42)
    const name = decodeName(buf.subarray(p + 46, p + 46 + nameLen), flags)
    entries.push({
      name,
      method,
      flags,
      compSize,
      size,
      localOffset,
      isDir: name.endsWith('/'),
      zip64: size === 0xffffffff || compSize === 0xffffffff || localOffset === 0xffffffff,
    })
    p += 46 + nameLen + extraLen + commentLen
  }
  return { entries, total, zip64 }
}

/** Extracts one entry's bytes (stored or deflated). */
export function readZipEntryData(buffer, entry) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
  if (!entry || entry.isDir) return Buffer.alloc(0)
  if (entry.zip64) throw new Error(`ZIP64 entries are not supported (${entry.name}); re-zip without ZIP64.`)
  if (buf.readUInt32LE(entry.localOffset) !== SIG_LOCAL) {
    throw new Error(`Corrupt local header for "${entry.name}".`)
  }
  const nameLen = buf.readUInt16LE(entry.localOffset + 26)
  const extraLen = buf.readUInt16LE(entry.localOffset + 28)
  const start = entry.localOffset + 30 + nameLen + extraLen
  const raw = buf.subarray(start, start + entry.compSize)
  if (entry.method === 0) return Buffer.from(raw)
  if (entry.method === 8) return inflateRawSync(raw)
  throw new Error(`Unsupported ZIP compression method ${entry.method} for "${entry.name}".`)
}

/** Files worth looking at; junk and the macOS resource forks are dropped. */
export function isCandidateEntry(name) {
  const n = String(name || '')
  if (!n || n.endsWith('/')) return false
  if (n.startsWith('__MACOSX/') || n.includes('/__MACOSX/')) return false
  if (/(^|\/)\._/.test(n) || /(^|\/)\.DS_Store$/i.test(n)) return false
  if (/\.(pdf|docx?|zip)$/i.test(n) === false) return false
  return true
}

// ─── Manifest summary ────────────────────────────────────────────────────────

/** Rolls a manifest of rows into the counts the operator needs to decide. */
export function summariseManifest(rows) {
  const buckets = {}
  const universities = {}
  const programs = {}
  let bytes = 0
  let pages = 0
  let chars = 0
  for (const r of rows || []) {
    buckets[r.bucket] = (buckets[r.bucket] || 0) + 1
    bytes += Number(r.bytes) || 0
    pages += Number(r.pages) || 0
    chars += Number(r.chars) || 0
    if (r.guess?.universityCode) universities[r.guess.universityCode] = (universities[r.guess.universityCode] || 0) + 1
    if (r.guess?.program) programs[r.guess.program] = (programs[r.guess.program] || 0) + 1
  }
  const needsAiVision = (buckets['scanned'] || 0) + (buckets['legacy-font'] || 0)
  return {
    files: (rows || []).length,
    bytes,
    pages,
    chars,
    buckets,
    universities,
    programs,
    needsAiVision,
    freeDeterministic: buckets['digital-en'] || 0,
  }
}
