// scripts/prep-import-lib.test.mjs
//
// Unit tests for the PYQ corpus triage helpers (scripts/prep-import-lib.mjs).
//
// Dependency-free by design: the ZIP fixtures are built in memory here, so the
// reader is proven against real archive bytes (including the data-descriptor
// case that trips most hand-rolled readers) without shipping a .zip into git.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateRawSync, deflateSync } from 'node:zlib'
import {
  PREP_PROGRAM_CODES,
  PREP_UNIVERSITY_CODES,
  classifyDocument,
  detectLegacyFont,
  detectScript,
  guessPaperMetadata,
  hasKannada,
  isCandidateEntry,
  readZipEntries,
  readZipEntryData,
  summariseManifest,
} from './prep-import-lib.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..')

// ─── in-memory ZIP writer (fixtures only) ───────────────────────────────────

function u16(v) {
  const b = Buffer.alloc(2)
  b.writeUInt16LE(v, 0)
  return b
}
function u32(v) {
  const b = Buffer.alloc(4)
  b.writeUInt32LE(v, 0)
  return b
}

/**
 * Builds a ZIP. `entries` = [{ name, data, method?, dataDescriptor? }].
 * method: 0 stored / 8 deflate. dataDescriptor: writes zeroed sizes in the
 * local header (bit 3) and the real sizes only in the central directory.
 */
function makeZip(entries) {
  const localParts = []
  const centralParts = []
  let offset = 0
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8')
    const raw = Buffer.from(e.data)
    const method = e.method === 8 ? 8 : 0
    const payload = method === 8 ? deflateRawSync(raw) : raw
    const flags = e.dataDescriptor ? 0x0008 : 0
    const localSize = e.dataDescriptor ? 0 : payload.length
    const localRaw = e.dataDescriptor ? 0 : raw.length
    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20), // version needed
      u16(flags),
      u16(method),
      u16(0),
      u16(0),
      u32(0), // crc (not checked by the reader)
      u32(localSize),
      u32(localRaw),
      u16(nameBuf.length),
      u16(0),
      nameBuf,
      payload,
    ])
    localParts.push(local)
    centralParts.push(
      Buffer.concat([
        u32(0x02014b50),
        u16(20), // version made by
        u16(20), // version needed
        u16(flags),
        u16(method),
        u16(0),
        u16(0),
        u32(0),
        u32(payload.length),
        u32(raw.length),
        u16(nameBuf.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        nameBuf,
      ])
    )
    offset += local.length
  }
  const central = Buffer.concat(centralParts)
  const eocd = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(central.length),
    u32(offset),
    u16(0),
  ])
  return Buffer.concat([...localParts, central, eocd])
}

// ─── ZIP reader ─────────────────────────────────────────────────────────────

test('readZipEntries finds stored and deflated entries', () => {
  const zip = makeZip([
    { name: 'bcu-bcom-1-sem-2024.pdf', data: 'hello-english', method: 0 },
    { name: 'bcu-kannada.pdf', data: 'PÀ£ÁðlPÀ', method: 8 },
    { name: '__MACOSX/junk', data: 'x', method: 0 },
    { name: 'folder/', data: '', method: 0 },
  ])
  const { entries } = readZipEntries(zip)
  assert.equal(entries.length, 4)
  assert.deepEqual(
    entries.map((e) => e.name),
    ['bcu-bcom-1-sem-2024.pdf', 'bcu-kannada.pdf', '__MACOSX/junk', 'folder/']
  )
  assert.equal(readZipEntryData(zip, entries[0]).toString('utf8'), 'hello-english')
  assert.equal(readZipEntryData(zip, entries[1]).toString('utf8'), 'PÀ£ÁðlPÀ')
  assert.equal(entries[3].isDir, true)
  assert.equal(readZipEntryData(zip, entries[3]).length, 0)
})

test('readZipEntries trusts the central directory when a data descriptor is used', () => {
  // Sizes are zero in the local header; a reader that trusts the local header
  // returns an empty file here (the classic silent-data-loss bug).
  const zip = makeZip([{ name: 'scan.pdf', data: 'real-content-here', method: 8, dataDescriptor: true }])
  const { entries } = readZipEntries(zip)
  assert.equal(entries.length, 1)
  assert.equal(entries[0].compSize, deflateRawSync(Buffer.from('real-content-here')).length)
  assert.equal(readZipEntryData(zip, entries[0]).toString('utf8'), 'real-content-here')
})

test('readZipEntries rejects non-ZIP input', () => {
  assert.throws(() => readZipEntries(Buffer.from('this is not a zip')), /Not a ZIP file/)
})

test('readZipEntryData rejects unsupported compression methods', () => {
  const zip = makeZip([{ name: 'a.pdf', data: 'x' }])
  const { entries } = readZipEntries(zip)
  assert.throws(() => readZipEntryData(zip, { ...entries[0], method: 99 }), /Unsupported ZIP compression/)
})

test('isCandidateEntry skips junk but keeps documents and nested zips', () => {
  assert.equal(isCandidateEntry('a/b.pdf'), true)
  assert.equal(isCandidateEntry('a/b.docx'), true)
  assert.equal(isCandidateEntry('part2.zip'), true)
  assert.equal(isCandidateEntry('__MACOSX/._a.pdf'), false)
  assert.equal(isCandidateEntry('a/.DS_Store'), false)
  assert.equal(isCandidateEntry('a/notes.txt'), false)
  assert.equal(isCandidateEntry('a/'), false)
})

// ─── script detection ───────────────────────────────────────────────────────

test('detectScript separates English, Kannada and mixed text', () => {
  assert.equal(detectScript('Explain the demographic features of India.').primary, 'en')
  const kn = detectScript('ಭಾರತದ ಜನಸಂಖ್ಯಾ ಲಕ್ಷಣಗಳನ್ನು ವಿವರಿಸಿ.')
  assert.equal(kn.primary, 'kn')
  assert.ok(kn.ratios.kn > 0.9)
  const mixed = detectScript('ಭಾರತದ ಜನಸಂಖ್ಯಾ ಲಕ್ಷಣಗಳನ್ನು ವಿವರಿಸಿ Explain the demographic features of India in detail.')
  assert.equal(mixed.primary, 'kn')
  assert.ok(mixed.ratios.en > 0.15)
  assert.equal(detectScript('').primary, 'none')
  assert.equal(detectScript('12345 67890').primary, 'none')
})

test('hasKannada is true only above the ratio floor', () => {
  assert.equal(hasKannada('ಭಾರತದ ಜನಸಂಖ್ಯೆ'), true)
  assert.equal(hasKannada('Explain the following'), false)
})

// ─── legacy font (Nudi / KGP) detection ─────────────────────────────────────

test('detectLegacyFont flags Nudi-style mojibake and leaves real Kannada alone', () => {
  const nudi =
    'PÀ£ÁðlPÀ ¸ÀPÁðgÀ ¥Àæ±Éß¥ÀwæPÉ - 2024. F ¥Àæ±ÉßUÉ ¸ÀAQë¥ÀÛ GvÀÛgÀ §gÉ¬Äj.'
  const flagged = detectLegacyFont(nudi)
  assert.equal(flagged.suspicious, true)
  assert.ok(flagged.latinExtRatio > 0.25)

  const real = 'ಕರ್ನಾಟಕ ಸರ್ಕಾರ ಪ್ರಶ್ನೆಪತ್ರಿಕೆ - 2024. ಈ ಪ್ರಶ್ನೆಗೆ ಸಂಕ್ಷಿಪ್ತ ಉತ್ತರ ಬರೆಯಿರಿ.'
  assert.equal(detectLegacyFont(real).suspicious, false)
  assert.equal(detectLegacyFont('Answer any FIVE of the following questions.').suspicious, false)
})

// ─── classification ─────────────────────────────────────────────────────────

test('classifyDocument buckets digital, scanned, legacy-font and unsupported files', () => {
  const en = detectScript('Explain the demographic features of India in about 500 words.')
  const kn = detectScript('ಭಾರತದ ಜನಸಂಖ್ಯಾ ಲಕ್ಷಣಗಳನ್ನು ವಿವರಿಸಿ ಮತ್ತು ಉದಾಹರಣೆ ನೀಡಿ.')
  const mixed = detectScript(
    'ಭಾರತದ ಜನಸಂಖ್ಯಾ ಲಕ್ಷಣಗಳನ್ನು ವಿವರಿಸಿ Explain the demographic features of India in detail.'
  )
  assert.equal(classifyDocument({ chars: 2000, pages: 4, script: en, ext: 'pdf' }), 'digital-en')
  assert.equal(classifyDocument({ chars: 2000, pages: 4, script: kn, ext: 'pdf' }), 'digital-kn')
  assert.equal(classifyDocument({ chars: 2000, pages: 4, script: mixed, ext: 'pdf' }), 'digital-mixed')
  assert.equal(classifyDocument({ chars: 30, pages: 4, script: en, ext: 'pdf' }), 'scanned')
  assert.equal(classifyDocument({ chars: 0, pages: 0, script: en, ext: 'pdf' }), 'empty')
  assert.equal(
    classifyDocument({ chars: 4000, pages: 4, script: en, legacyFont: { suspicious: true }, ext: 'pdf' }),
    'legacy-font'
  )
  assert.equal(classifyDocument({ chars: 100, pages: 1, script: en, ext: 'xlsx' }), 'unsupported')
  // A documented threshold: 40 characters per page is the floor for a text layer.
  assert.equal(classifyDocument({ chars: 100, pages: 3, script: en, ext: 'pdf' }), 'scanned')
})

// ─── filename metadata ──────────────────────────────────────────────────────

test('guessPaperMetadata reads university, program, semester, year and month', () => {
  const a = guessPaperMetadata('BCU-BCom-5th-Sem-Nov-2024.pdf')
  assert.equal(a.universityCode, 'bcu')
  assert.equal(a.program, 'bcom')
  assert.equal(a.semester, 5)
  assert.equal(a.year, 2024)
  assert.equal(a.month, 11)
  assert.deepEqual(a.missing, [])

  const b = guessPaperMetadata('bengaluru north university_bba_3sem_2022_feb-mar.pdf')
  assert.equal(b.universityCode, 'bnu')
  assert.equal(b.program, 'bba')
  assert.equal(b.semester, 3)
  assert.equal(b.year, 2022)
  assert.equal(b.month, 2)

  const c = guessPaperMetadata('KUD-BBM-II-Sem-DEC-2019.pdf')
  assert.equal(c.universityCode, 'kud')
  assert.equal(c.program, 'bba')
  assert.equal(c.legacyProgram, 'bbm')
  assert.equal(c.semester, 2)
  assert.equal(c.month, 12)

  const d = guessPaperMetadata('question paper.pdf')
  assert.equal(d.universityCode, null)
  assert.equal(d.program, null)
  assert.ok(d.missing.includes('university') && d.missing.includes('program') && d.missing.includes('year'))
})

test('guessPaperMetadata never mistakes a page or part number for a year', () => {
  const r = guessPaperMetadata('BA-1-SEM-Part-1-English-2018.pdf')
  assert.equal(r.year, 2018)
  assert.equal(r.semester, 1)
  assert.equal(r.program, 'ba')
})

test('guessPaperMetadata reads Mechanical only when no other program token is present', () => {
  // Unambiguous spellings always win.
  assert.equal(guessPaperMetadata('VTU_Mech_5th_Sem_Turbo_Machines_Jan_2025.pdf').program, 'me')
  assert.equal(guessPaperMetadata('mechanical-3rd-sem-2024.pdf').program, 'me')
  // The bare 'me' token names the program only when nothing else does…
  const me = guessPaperMetadata('VTU-ME-5th-Sem-Jan-2025.pdf')
  assert.equal(me.program, 'me')
  assert.equal(me.semester, 5)
  assert.equal(me.year, 2025)
  // …because BBA/MBA papers also use 'ME' for Managerial Economics, in any position.
  assert.equal(guessPaperMetadata('BBA-1st-Sem-ME-2023.pdf').program, 'bba')
  assert.equal(guessPaperMetadata('ME-MBA-1st-Sem-2023.pdf').program, 'mba')
  // Words that merely contain the letters are not tokens.
  assert.equal(guessPaperMetadata('BCU-BCom-Management-2022.pdf').program, 'bcom')
  assert.equal(guessPaperMetadata('readme-2022.pdf').program, null)

  // Civil: the spelled-out word or the bare CV token, only when nothing else matches.
  assert.equal(guessPaperMetadata('VTU-Civil-3rd-Sem-Surveying-2024.pdf').program, 'cv')
  assert.equal(guessPaperMetadata('CV-5th-Sem-Jan-2025.pdf').program, 'cv')
  assert.equal(guessPaperMetadata('BCom-CV-Report-2023.pdf').program, 'bcom')
})

// ─── manifest summary ───────────────────────────────────────────────────────

test('summariseManifest counts buckets, languages and what needs AI vision', () => {
  const rows = [
    { bucket: 'digital-en', bytes: 100, pages: 2, chars: 500, guess: { universityCode: 'bcu', program: 'bcom' } },
    { bucket: 'scanned', bytes: 900, pages: 4, chars: 0, guess: { universityCode: 'bcu', program: 'bcom' } },
    { bucket: 'legacy-font', bytes: 800, pages: 3, chars: 300, guess: { universityCode: 'mu', program: 'bba' } },
    { bucket: 'digital-kn', bytes: 500, pages: 3, chars: 900, guess: { universityCode: null, program: null } },
  ]
  const s = summariseManifest(rows)
  assert.equal(s.files, 4)
  assert.equal(s.bytes, 2300)
  assert.equal(s.pages, 12)
  assert.equal(s.freeDeterministic, 1)
  assert.equal(s.needsAiVision, 2)
  assert.deepEqual(s.buckets, { 'digital-en': 1, scanned: 1, 'legacy-font': 1, 'digital-kn': 1 })
  assert.equal(s.universities.bcu, 2)
  assert.equal(s.programs.bba, 1)
})

// ─── drift guard against the TypeScript catalogue ───────────────────────────

function catalogueCodes(file, marker) {
  const full = path.join(repoRoot, file)
  if (!fs.existsSync(full)) return null
  const src = fs.readFileSync(full, 'utf8')
  const start = src.indexOf(marker)
  if (start < 0) return null
  // Anchor on "= [" and the closing "\n]" — the declaration type itself
  // contains a "]" ("PrepPaperUniversity[]"), which a naive scan would hit.
  const open = src.indexOf('= [', start)
  if (open < 0) return null
  const close = src.indexOf('\n]', open)
  if (close < 0) return null
  const block = src.slice(open, close)
  return [...block.matchAll(/code: '([a-z0-9-]+)'/g)].map((m) => m[1])
}

test('university list matches functions/src/prepPapers.ts', (t) => {
  const codes = catalogueCodes('functions/src/prepPapers.ts', 'export const PREP_PAPER_UNIVERSITIES')
  if (!codes) return t.skip('functions/src/prepPapers.ts not found')
  assert.deepEqual([...codes].sort(), [...PREP_UNIVERSITY_CODES].sort())
})

test('program list matches functions/src/prepShared.ts', (t) => {
  const codes = catalogueCodes('functions/src/prepShared.ts', 'export const PREP_PROGRAM_CATALOG')
  if (!codes) return t.skip('functions/src/prepShared.ts not found')
  assert.deepEqual([...codes].sort(), [...PREP_PROGRAM_CODES].sort())
})
