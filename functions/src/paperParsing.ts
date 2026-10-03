import { getFirestore } from 'firebase-admin/firestore';
import { getApps, initializeApp } from 'firebase-admin/app';
if (!getApps().length) initializeApp();
// functions/src/paperParsing.ts
// Slice 1 of the paper-upload parse handoff.
//
// One paper, two artefacts:
//   • original file (papers.filePath)  → the print artefact (photocopy)
//   • sections[] + question bank        → the online artefact (assessments)
//
// This module provides the two server callables that close the loop:
//
//   1. parsePaperFile — extracts text from a digital PDF / DOCX in Cloud
//      Storage and structures it. Standard printed layouts are parsed
//      DETERMINISTICALLY on the server (deterministicParse — no API key, no
//      cost, nothing leaves the server); Gemini is consulted only as a
//      fallback for unusual layouts. Parsing is ASSISTIVE ONLY:
//      it never writes to the `questions` bank, never touches the paper
//      document, and never auto-publishes anything. The result is returned
//      to the PaperUploadEditor for faculty review.
//
//   2. confirmPaperStructure — the single server-side "Confirm". It reads
//      the paper's reviewed structure from the server (the paper document is
//      the source of truth), writes the question bank documents, points the
//      paper at them via questionIds / linkedQuestionIds, recomputes totals
//      and marks Print / Online / Bank readiness. The original file is kept
//      untouched so the paper stays printable.
//
// Hard constraints implemented here:
//   • Digital PDF / DOCX only. Scanned image files are rejected — OCR is
//     Slice 2 and must never auto-publish.
//   • No invented answers: the model is prompted to transcribe only, and any
//     correctAnswer / isCorrect material it returns is stripped server-side.
//   • Default question type is short/long answer (manual grading).
//   • content/pre-assessment/*.json is content, not a Firestore seed — it is
//     never read here.
//   • Parsing is not seeded into the bank; the bank is written on Confirm.

import * as admin from 'firebase-admin'
import * as logger from 'firebase-functions/logger'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { extractRawText } from 'mammoth'
// Type-only import: erased at compile time, so pdfjs is NOT loaded here.
//
// pdfjs-dist 6.x is a heavy ESM package; requiring it at module load cost
// seconds of cold start for EVERY function (index.ts pulls this module in)
// AND tripped the deploy-time discovery step, where the CLI allows only 10s
// to enumerate backends — large deploys failed with "User code failed to
// load. Cannot determine backend specification. Timeout after 10000".
//
// Firebase's own guidance for that error is to defer initialization instead
// of raising the timeout, so the library is now imported on first PDF parse.
import type * as PdfJsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import { SchemaType, type GenerateContentRequest, type ResponseSchema } from '@google/generative-ai'
import { geminiClient } from './config/aiProviders'
import {
  type AiTier,
  generateWithGeminiFallback,
  primaryGeminiModel,
} from './config/aiModels'
import {
  EDITABLE_STATES,
  REVIEW_ROLES,
  paperReadiness,
  resolvePaperStaff,
} from './paperWorkflow'
import {
  findSchedulingProblem,
  isKnownQuestionType as sharedIsKnownQuestionType,
  SCHEDULABLE_ONLINE_TYPES,
} from './questionTypes'
import {
  containsSubpartMarker,
  isFirstSubpartMarker,
  lastSubpartRank,
  leadingSubpartMarker,
  mergeSubpartQuestions,
  prevAcceptsSubpart,
  prevOpensNumberedSubparts,
  subpartRank,
} from './subpartMerge'

// The sub-topic helpers live in ./subpartMerge so the superadmin bulk import
// (questionImport.ts) shares the exact same grouping rules as this parser.
export {
  containsSubpartMarker,
  isFirstSubpartMarker,
  lastSubpartRank,
  leadingSubpartMarker,
  mergeSubpartQuestions,
  prevAcceptsSubpart,
  prevOpensNumberedSubparts,
  subpartRank,
} from './subpartMerge'

const PDF_TYPE = 'application/pdf'
const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const MAX_FILE_BYTES = 20 * 1024 * 1024
const MAX_PARSE_CHARS = 120_000
const MIN_TEXT_CHARS = 120
const MAX_PARSE_PAGES = 80
const MAX_SECTIONS = 20
const MAX_QUESTIONS = 400
const MAX_QUESTION_TEXT = 20_000
const MAX_OPTIONS = 8
// Parsing is a QUALITY-tier job: a cheap model that mis-reads a paper costs more
// in human review than it saves in tokens. The tier list (config/aiModels.ts)
// supplies the model and its in-Gemini fallback.
const PARSE_TIER: AiTier = 'quality'

// Types the PARSER recognises (known labels are preserved; unknown ones fall
// back to short/long answer). This is NOT the same as "schedulable online" —
// `matching` is known but the online test engine does not render it, and the
// authoritative schedulable set lives in ./questionTypes (also imported by the
// schedule-time check in studentAssessments.ts). The old local copy of that
// set is exactly what let a case_based paper Confirm cleanly and then fail at
// schedule time with "Question 1 … unsupported online response type".
export const SUPPORTED_QUESTION_TYPES = new Set([
  'mcq',
  'multi_select',
  'true_false',
  'fill_in_blank',
  'short_answer',
  'long_answer',
  'numerical',
  'assertion_reason',
  'case_based',
  'matching',
])

const TYPE_ALIASES: Record<string, string> = {
  short: 'short_answer',
  shortanswer: 'short_answer',
  state: 'short_answer',
  long: 'long_answer',
  longanswer: 'long_answer',
  essay: 'long_answer',
  descriptive: 'long_answer',
  explain: 'long_answer',
  mcq: 'mcq',
  objective: 'mcq',
  multiplechoice: 'mcq',
  truefalse: 'true_false',
  tf: 'true_false',
  fillintheblank: 'fill_in_blank',
  fillintheblanks: 'fill_in_blank',
  fib: 'fill_in_blank',
  numerical: 'numerical',
  nat: 'numerical',
  assertionreason: 'assertion_reason',
  casebased: 'case_based',
  casestudy: 'case_based',
  matching: 'matching',
}

// ─── Text extraction ────────────────────────────────────────────────────────

export interface ExtractedPaperText {
  text: string
  kind: 'pdf' | 'docx'
  pages: number
}

/** Cached pdfjs namespace, loaded on first PDF parse. */
let pdfjsModule: typeof PdfJsLib | null = null

/**
 * Loads pdfjs-dist on demand. The 6.x legacy build is ESM, so the namespace
 * lands on the module object (a `.default` fallback is kept for runtime
 * interop differences rather than assumed away).
 */
async function loadPdfJs(): Promise<typeof PdfJsLib> {
  if (!pdfjsModule) {
    const loaded: any = await import('pdfjs-dist/legacy/build/pdf.mjs')
    pdfjsModule = (loaded && loaded.getDocument ? loaded : loaded?.default) as typeof PdfJsLib
  }
  return pdfjsModule
}

/**
 * Pulls readable text out of a digital PDF or DOCX buffer.
 * Throws failed-precondition when no usable text layer exists (i.e. the file
 * is a scanned image — that is Slice 2 territory, never OCR-auto-publish).
 */
export async function extractPaperText(buffer: Buffer, contentType: string): Promise<ExtractedPaperText> {
  if (contentType === PDF_TYPE) {
    const pdfjsLib = await loadPdfJs()
    // maxPages is honoured by the runtime but missing from the published
    // typings, so the params are widened for the call.
    const params = {
      data: new Uint8Array(buffer),
      verbosity: 0,
      maxPages: MAX_PARSE_PAGES,
    } as unknown as Parameters<typeof PdfJsLib.getDocument>[0]
    const task = pdfjsLib.getDocument(params)
    const doc = await task.promise
    try {
      const pageParts: string[] = []
      for (let page = 1; page <= doc.numPages; page += 1) {
        const pageObj = await doc.getPage(page)
        const content = await pageObj.getTextContent()
        let pageText = ''
        for (const item of content.items as Array<{ str?: string; hasEOL?: boolean }>) {
          if (typeof item.str === 'string') pageText += item.str
          pageText += item.hasEOL ? '\n' : ' '
        }
        pageParts.push(pageText)
      }
      return { text: pageParts.join('\n'), kind: 'pdf', pages: doc.numPages }
    } finally {
      // pdfjs 6: destroy() moved from the document proxy to the loading task.
      await task.destroy().catch(() => undefined)
    }
  }
  if (contentType === DOCX_TYPE) {
    const result = await extractRawText({ buffer })
    return { text: result.value, kind: 'docx', pages: 1 }
  }
  throw new HttpsError('invalid-argument', 'Only digital PDF and DOCX files can be parsed')
}

// ─── Gemini structuring ─────────────────────────────────────────────────────

export interface ParsedQuestion {
  text: string
  type: string
  marks: number
  topic: string
  options?: string[]
}

export interface ParsedSection {
  name: string
  instructions: string
  questions: ParsedQuestion[]
}

export interface ParsedMeta {
  title: string
  subject: string
  instructions: string
  durationMinutes: number
  totalMarks: number
}

const EMPTY_META: ParsedMeta = { title: '', subject: '', instructions: '', durationMinutes: 0, totalMarks: 0 }

const PAPER_STRUCTURE_SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    meta: {
      type: SchemaType.OBJECT,
      properties: {
        title: { type: SchemaType.STRING },
        subject: { type: SchemaType.STRING },
        instructions: { type: SchemaType.STRING },
        durationMinutes: { type: SchemaType.NUMBER },
        totalMarks: { type: SchemaType.NUMBER },
      },
    },
    note: { type: SchemaType.STRING },
    sections: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          name: { type: SchemaType.STRING },
          instructions: { type: SchemaType.STRING },
          questions: {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.OBJECT,
              properties: {
                text: { type: SchemaType.STRING },
                type: {
                  type: SchemaType.STRING,
                  format: 'enum',
                  enum: ['short_answer', 'long_answer', 'mcq', 'true_false', 'fill_in_blank', 'numerical'],
                },
                marks: { type: SchemaType.NUMBER },
                topic: { type: SchemaType.STRING },
                options: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
              },
              required: ['text', 'type', 'marks'],
            },
          },
        },
        required: ['name', 'questions'],
      },
    },
  },
  required: ['meta', 'sections'],
}

export function buildParsePrompt(extractedText: string, paper: admin.firestore.DocumentData): string {
  const context = [
    `Subject (from the paper record): ${paper.subject || 'not set'}`,
    `Exam type (from the paper record): ${paper.examType || 'not set'}`,
    `Title (from the paper record): ${paper.title || 'not set'}`,
  ].join('\n')
  return `You are transcribing the structure of a question paper that a faculty member uploaded to Vriddhi, an academic platform. A text layer was extracted from the file; it is below between === markers.

${context}

=== EXTRACTED TEXT
${extractedText}
=== END OF EXTRACTED TEXT

TASK
Transcribe the question paper structure EXACTLY as printed in the extracted text. You are a transcription tool, not an author.

Respond with ONLY a JSON object in this shape:
{
  "meta": { "title": "", "subject": "", "instructions": "", "durationMinutes": 0, "totalMarks": 0 },
  "note": "",
  "sections": [
    {
      "name": "Section A",
      "instructions": "",
      "questions": [
        { "text": "", "type": "short_answer", "marks": 0, "topic": "", "options": [] }
      ]
    }
  ]
}

RULES — follow all of them exactly:
1. Include every question exactly as printed, in order. When a question carries sub-parts or sub-topics — printed as (a), (b), (c) / (A), (B), (C) / (i), (ii), (iii) / 1), 2) etc. — return it as ONE single question whose "text" contains the full question with ALL its sub-parts in order, exactly as printed. NEVER split sub-parts into separate questions, and NEVER list them as "options". If the sub-parts carry separate printed marks, set the question's "marks" to their sum.
2. "type" per question:
   - "short_answer" for define / state / list / give / mention / any-two / difference-type questions.
   - "long_answer" for explain / describe / discuss / derive / prove / essay-type questions.
   - "mcq" ONLY when option texts are literally printed in the extracted text; transcribe the option texts verbatim, in order, into "options".
   - "true_false", "fill_in_blank" or "numerical" only when the printed question clearly uses that format.
3. "marks": copy the marks exactly as printed next to or under the question, e.g. "(5)" or "[10 marks]". If a group of questions shares one marks figure, repeat it for each question. If no marks are printed for a question, use 0.
4. NEVER output correct answers, answer keys, model answers, or any indication of which option is right — even if the file contains an answer key, ignore it completely. The "options" array holds option texts only. Do not add "correctAnswer" or similar fields.
5. "topic": a short topic or chapter label the question covers, or "" when unclear.
6. Sections: keep printed section headings (Section A, Part B, ...). If the paper has no printed sections, return a single section named "Section A".
7. "meta": fill from printed header information (title, subject, instructions, duration in minutes, total marks). Use 0 / "" when not printed.
8. If the extracted text is NOT a question paper (a notice, a syllabus, a blank page, an image with no text), return sections: [] and a one-line "note" saying why.
9. Do not invent, complete, shorten or rewrite question text. Do not add questions that are not printed.
10. Respond with the JSON object only — no markdown fences, no commentary.`
}

export function normalizeQuestionType(value: unknown): string {
  const compact = String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  if (TYPE_ALIASES[compact]) return TYPE_ALIASES[compact]
  if (SUPPORTED_QUESTION_TYPES.has(compact)) return compact
  // Never invent an objective format from an unknown label — default to the
  // agreed manual-graded types.
  return compact.startsWith('short') ? 'short_answer' : 'long_answer'
}

/** True when the raw label is recognised (alias or supported type). */
// Delegates to the shared table so the parser and the schedule-time check
// agree on what a "known" type is. The old local body compacted the input
// first, so an already-normalised canonical name like 'fill_in_blank'
// (compact → 'fillinblank') matched neither the alias table nor the
// underscored SUPPORTED_QUESTION_TYPES — a re-Confirm of a paper containing a
// fill-in-the-blank question was therefore refused.
export function isKnownQuestionType(value: unknown): boolean {
  return sharedIsKnownQuestionType(value)
}

function normalizeMarks(value: unknown): number {
  const marks = Number(value)
  if (!Number.isFinite(marks) || marks < 0) return 0
  const rounded = Math.round(marks * 100) / 100
  return Math.min(rounded, 1000)
}

export interface NormalizedParse {
  meta: ParsedMeta
  sections: ParsedSection[]
  questionCount: number
  warnings: string[]
  note: string
}

/**
 * Defensively normalises the Gemini response. Any answer-bearing material the
 * model may have slipped in (correctAnswer, isCorrect, explanation) is dropped
 * on purpose — parsing must never carry answers into the platform.
 */
export function normalizeParsedStructure(raw: unknown): NormalizedParse {
  const warnings: string[] = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { meta: { ...EMPTY_META }, sections: [], questionCount: 0, warnings: ['The AI response could not be read.'], note: '' }
  }
  const input = raw as Record<string, unknown>

  const rawMeta = (input.meta && typeof input.meta === 'object' && !Array.isArray(input.meta) ? input.meta : {}) as Record<string, unknown>
  const meta: ParsedMeta = {
    title: String(rawMeta.title || '').trim().slice(0, 200),
    subject: String(rawMeta.subject || '').trim().slice(0, 200),
    instructions: String(rawMeta.instructions || '').trim().slice(0, 10_000),
    durationMinutes: Math.max(0, Math.min(1440, Math.round(Number(rawMeta.durationMinutes) || 0))),
    totalMarks: Math.max(0, Math.min(10_000, Math.round(Number(rawMeta.totalMarks) || 0))),
  }

  const rawSections = Array.isArray(input.sections) ? input.sections : []
  if (rawSections.length > MAX_SECTIONS) {
    warnings.push(`Only the first ${MAX_SECTIONS} sections were kept.`)
  }

  const sections: ParsedSection[] = []
  let questionCount = 0
  let rawCount = 0
  let droppedTypes = 0

  for (const rawSection of rawSections.slice(0, MAX_SECTIONS)) {
    if (!rawSection || typeof rawSection !== 'object' || Array.isArray(rawSection)) continue
    const section = rawSection as Record<string, unknown>
    const sourceQuestions = Array.isArray(section.questions) ? section.questions : []
    const questions: ParsedQuestion[] = []

    for (const rawQuestion of sourceQuestions) {
      if (rawCount >= MAX_QUESTIONS) break
      if (!rawQuestion || typeof rawQuestion !== 'object' || Array.isArray(rawQuestion)) continue
      const question = rawQuestion as Record<string, unknown>
      const text = String(question.text || '').replace(/\s+/g, ' ').trim()
      if (!text) continue
      const type = normalizeQuestionType(question.type)
      if (!isKnownQuestionType(question.type)) droppedTypes += 1
      const marks = normalizeMarks(question.marks)
      const topic = String(question.topic || '').trim().slice(0, 200)
      const options = ['mcq', 'multi_select', 'true_false'].includes(type) && Array.isArray(question.options)
        ? question.options.map((option) => String(option || '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, MAX_OPTIONS)
        : undefined
      questions.push({
        text: text.slice(0, MAX_QUESTION_TEXT),
        type,
        marks,
        topic,
        ...(options && options.length > 0 ? { options } : {}),
      })
      rawCount += 1
    }

    // Merge pass: even when the model split a question's sub-topics
    // ("(a) … (b) … (c) …") into separate entries, the paper is transcribed
    // the way it is printed — ONE question carrying all its sub-topics, with
    // the sub-part marks summed.
    const merged = mergeSubpartQuestions(questions)
    questionCount += merged.length
    if (merged.length === 0) continue
    sections.push({
      name: String(section.name || section.title || '').trim().slice(0, 200) || `Section ${sections.length + 1}`,
      instructions: String(section.instructions || '').trim().slice(0, 2_000),
      questions: merged,
    })
  }

  if (droppedTypes > 0) {
    warnings.push(`${droppedTypes} question(s) had an unrecognised type and were kept as short/long answer.`)
  }
  if (rawCount >= MAX_QUESTIONS) {
    warnings.push(`Only the first ${MAX_QUESTIONS} questions were kept.`)
  }

  return {
    meta,
    sections,
    questionCount,
    warnings,
    note: String(input.note || '').trim().slice(0, 500),
  }
}

// ─── Deterministic-first parse (no AI, no key, no cost) ─────────────────────
//
// Most university question papers share the same printed line layout: section
// headers ("SECTION A — Objective Type"), numbered questions ("1." / "Q1." /
// "2)"), "A."-style option lines, and printed marks as "[2]", "(5)" or
// "[10 marks]" with occasional "Each question carries N marks" defaults. A
// small rule engine recovers the structure from that layout entirely on the
// server — no Gemini key required, no token cost, and nothing leaves the box.
//
// The output is only ACCEPTED when it finds ≥ 1 question AND the recognised
// question lines cover ≥ MIN_DETERMINISTIC_COVERAGE of the document's text;
// that coverage guard defers unusual layouts (notices, syllabi, exotic PDFs)
// to the Gemini fallback below instead of half-guessing a structure. Faculty
// review and the strict server-side Confirm are identical for both methods,
// and — like the AI path — nothing is written anywhere here: marks are never
// invented (0 stays 0) and answers are never produced.

/** Minimum share of the document's characters that must be recognised. */
export const MIN_DETERMINISTIC_COVERAGE = 0.3
/**
 * Per-question budget for absorbed continuation lines — keeps a stray "1."
 * in an unrelated document from swallowing the whole file as one giant
 * question. Continuation never counts towards coverage anyway (see below).
 */
const DET_MAX_CONTINUATION_CHARS = 600
/**
 * Compound questions (one printed question carrying sub-topics like
 * "(A) … (B) … (C) … (D) …" or "a) … b) … c) …") legitimately run much
 * longer than plain questions, so their continuation budget is wider —
 * 600 chars silently chopped the later sub-topics of university papers.
 */
const DET_COMPOUND_CONTINUATION_CHARS = 3000

const DET_SECTION_RE = /^(?:section|part)\s+[-–—:.]?\s*(?:[A-J]\b|[IVX]{1,4}\b|\d{1,2}\b)[^\n]{0,90}$/i
const DET_QUESTION_START_RE = /^(?:Q(?:uestion)?\s*[.:]?\s*)?(\d{1,3})\s*[.)]\s*(.*)$/
/** Leading marks token — float-right marks sit BEFORE the question text in a
 *  PDF/DOCX text layer even though they print to its right. */
const DET_LEADING_MARKS_RE = /^(?:\[|\()\s*(\d{1,3}(?:\.\d)?)\s*(?:marks?|mks?\.?|M\.?)?\s*(?:\]|\))\s*(.+)$/i
const DET_OPTION_RE = /^\(?\s*([A-H])\s*[.)]\s*(.+)$/
const DET_TRAILING_MARKS_RE = /(?:\[|\()\s*(\d{1,3}(?:\.\d)?)\s*(?:marks?|mks?\.?|M\.?)?\s*(?:\]|\))\s*$/i
const DET_MARKS_ONLY_RE = /^(?:\[|\()\s*(\d{1,3}(?:\.\d)?)\s*(?:marks?|mks?\.?|M\.?)?\s*(?:\]|\))$/i
const DET_DEFAULT_MARKS_RE = /\b(?:each|all|every)\b[\s\S]{0,60}?\b(?:carries|carry|carrying)\b\s*(?:up\s+to\s+)?(\d{1,3}(?:\.\d)?)\s*(?:marks?|mks?)?/i
const DET_MAX_MARKS_RE = /^(?:max(?:imum)?\.?\s*marks?|total\s*marks?)\s*[:.\-–=]?\s*(\d{1,4}(?:\.\d)?)/i
const DET_TIME_RE = /^(?:time|duration)\s*[:.\-–=]?\s*(\d{1,3}(?:\.\d)?)\s*(hours?|hrs?|h|minutes?|mins?|m)\b/i
const DET_SUBJECT_RE = /^(?:subject|sub)\s*[:.\-–=]\s*(.{2,120})$/i
const DET_DATE_LINE_RE = /^(?:date\s*[-:.]?\s*\S.*)|(?:^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$)|(?:\b(?:session|academic year)\b[^\n]*\b20\d\d\b)/i
const DET_TITLE_RE = /(?:question\s+paper|pre-?assessment|examination|mid-?sem|model\s+exam|class\s+test|end\s+semester)/i
const DET_LONG_ANSWER_RE = /^(?:explain|describe|discuss|derive|prove|evaluate|elaborate|critically\s+examine|write\s+(?:a\s+)?(?:note|essay|answer))/i

export interface DeterministicParseResult extends NormalizedParse {
  /** True when the layout matched well enough to trust without AI. */
  accepted: boolean
  /** Share (0..1) of the document's characters consumed by recognised lines. */
  coverage: number
}

interface DetDraftQuestion {
  text: string
  options: string[]
  marks: number | null
  nextOptionLetter: string | null
  continuationChars: number
  /** True when the printed question carries sub-topics ("(A)…(B)…" / "a)…b)…"). */
  compound: boolean
  /** The printed question number (used by the numbered-sub-topic merge). */
  num: number | null
}

interface DetDraftSection {
  name: string
  instructions: string[]
  defaultMarks: number
  questions: DetDraftQuestion[]
}

/** Strips a trailing marks token ("(5)", "[2 marks]") from a line. */
export function detStripMarks(line: string): { rest: string; marks: number | null } {
  const match = line.match(DET_TRAILING_MARKS_RE)
  if (!match || match.index === undefined) return { rest: line.trim(), marks: null }
  const marks = Number(match[1])
  if (!Number.isFinite(marks) || marks <= 0 || marks > 1000) return { rest: line.trim(), marks: null }
  return { rest: line.slice(0, match.index).trim(), marks }
}

function detQuestionType(question: DetDraftQuestion): string {
  if (question.options.length >= 2) return 'mcq'
  if (DET_LONG_ANSWER_RE.test(question.text) || (question.marks ?? 0) >= 6) return 'long_answer'
  return 'short_answer'
}

/** Option-shaped lines that are really sub-topics: they begin with a question
 * verb ("Define …", "Explain …") or carry their own printed marks "(5M)". */
const DET_SUBPART_DIRECTIVE_RE = /^(?:define|explain|describe|discuss|what|which|who|whom|write|state|list|mention|differentiate|distinguish|compare|contrast|compute|calculate|solve|prove|derive|elaborate|illustrate|evaluate|analyse|analyze|match|fill|choose|select|find|give|name|draw|sketch|justify|comment|expand|note|classify|identify|convert|prepare|journalise|journalize|record|show|establish|verify|examine|outline|summarise|summarize|answer|attempt|enumerate|highlight|critically|briefly)\b/i
const DET_OPTION_MARKS_RE = /[[(]\s*\d{1,3}(?:\.\d)?\s*(?:marks?|mks?\.?|M\.?)?[\])]/

/**
 * Rule-based transcription of a standard printed question paper. Deterministic
 * by construction: same text in, same structure out — and no answer-bearing
 * field is ever produced (there is nothing to strip because nothing is looked
 * for).
 */
export function deterministicParse(text: string): DeterministicParseResult {
  const warnings: string[] = []
  const lines = String(text || '').replace(/\u00a0/g, ' ').split(/\r?\n/)
  const contentLines: string[] = []
  for (const line of lines) {
    const trimmed = line.trim().replace(/\s+/g, ' ')
    if (trimmed) contentLines.push(trimmed)
  }
  const totalChars = contentLines.reduce((sum, line) => sum + line.replace(/\s+/g, '').length, 0)
  const empty: DeterministicParseResult = {
    meta: { ...EMPTY_META },
    sections: [],
    questionCount: 0,
    warnings,
    note: '',
    accepted: false,
    coverage: 0,
  }
  if (totalChars === 0) return empty

  const meta: ParsedMeta = { ...EMPTY_META }
  const sections: DetDraftSection[] = []
  let current: DetDraftSection | null = null
  let lastQuestion: DetDraftQuestion | null = null
  let questionCount = 0
  let recognisedChars = 0
  let capped = false

  const countChars = (value: string) => value.replace(/\s+/g, '').length
  const consume = (line: string) => {
    recognisedChars += countChars(line)
  }
  const ensureSection = (): DetDraftSection => {
    if (!current) {
      current = { name: `Section ${String.fromCharCode(65 + sections.length)}`, instructions: [], defaultMarks: 0, questions: [] }
      sections.push(current)
    }
    return current
  }

  for (const line of contentLines) {
    if (capped) break
    const sectionMatch = line.match(DET_SECTION_RE)
    if (sectionMatch && !DET_QUESTION_START_RE.test(line)) {
      current = { name: line.slice(0, 200), instructions: [], defaultMarks: 0, questions: [] }
      sections.push(current)
      lastQuestion = null
      consume(line)
      continue
    }

    const questionMatch = line.match(DET_QUESTION_START_RE)
    if (questionMatch) {
      let { rest, marks } = detStripMarks(questionMatch[2] || '')
      // "1." alone on a line is a numbered-cell opener (very common in
      // table/flex layouts exported to PDF/DOCX): open a pending question and
      // let the following lines fill it. A pending question with no text at
      // the end is dropped, so stray "2." lines are harmless.
      if (!rest) {
        const openerSection = ensureSection()
        if (questionCount >= MAX_QUESTIONS) {
          warnings.push(`Only the first ${MAX_QUESTIONS} questions were kept.`)
          capped = true
          break
        }
        const pending: DetDraftQuestion = {
          text: '',
          options: [],
          marks: null,
          nextOptionLetter: null,
          continuationChars: 0,
          compound: false,
          num: Number(questionMatch[1]),
        }
        openerSection.questions.push(pending)
        lastQuestion = pending
        questionCount += 1
        consume(line)
        continue
      }
      // float-right marks may lead the text: "[1] The accounting equation is:"
      const lead = rest.match(DET_LEADING_MARKS_RE)
      if (lead) {
        if (marks === null) {
          const leadMarks = Number(lead[1])
          if (Number.isFinite(leadMarks) && leadMarks > 0 && leadMarks <= 1000) marks = leadMarks
        }
        rest = lead[2]
      }
      const section = ensureSection()
      if (section.questions.length >= MAX_QUESTIONS || questionCount >= MAX_QUESTIONS) {
        warnings.push(`Only the first ${MAX_QUESTIONS} questions were kept.`)
        capped = true
        break
      }
      const question: DetDraftQuestion = {
        text: rest.slice(0, MAX_QUESTION_TEXT),
        options: [],
        marks,
        nextOptionLetter: null,
        continuationChars: 0,
        compound: containsSubpartMarker(rest),
        num: Number(questionMatch[1]),
      }
      section.questions.push(question)
      lastQuestion = question
      questionCount += 1
      consume(line)
      continue
    }

    // A pending numbered opener ("1." on its own line) is filled by the next
    // real line — either "[n] Text" (float-right marks first) or a sub-topic
    // shaped line ("(A) Define …" / "A. Explain …"), which is the body of a
    // compound question in table/flex layouts. Dropping those lines used to
    // erase entire questions; absorbing them keeps every sub-topic visible
    // for faculty review.
    if (lastQuestion && lastQuestion.text === '') {
      const lead = line.match(DET_LEADING_MARKS_RE)
      if (lead) {
        const leadMarks = Number(lead[1])
        if (lastQuestion.marks === null && Number.isFinite(leadMarks) && leadMarks > 0 && leadMarks <= 1000) {
          lastQuestion.marks = leadMarks
        }
        lastQuestion.text = lead[2].replace(/\s+/g, ' ').trim().slice(0, MAX_QUESTION_TEXT)
        lastQuestion.compound = containsSubpartMarker(lastQuestion.text)
        consume(line)
        continue
      }
      if (/^\(?\s*[A-H]\s*[.)]\s*$/.test(line)) continue // bare "A." with no text — nothing to absorb
      lastQuestion.text = line.replace(/\s+/g, ' ').trim().slice(0, MAX_QUESTION_TEXT)
      lastQuestion.compound = containsSubpartMarker(lastQuestion.text) || Boolean(leadingSubpartMarker(lastQuestion.text))
      consume(line)
      continue
    }

    const optionMatch = line.match(DET_OPTION_RE)
    if (optionMatch && lastQuestion) {
      const letter = optionMatch[1]
      const accepts =
        lastQuestion.options.length === 0
          ? letter === 'A'
          : lastQuestion.nextOptionLetter === letter
      // A lettered line that BEGINS with a question verb ("Define …",
      // "Explain …") or carries its own printed marks "(5M)" is a SUB-TOPIC
      // of the current question, not an MCQ option — let it fall through to
      // the continuation branch so it stays inside the question text.
      const looksLikeSubtopic =
        DET_SUBPART_DIRECTIVE_RE.test(optionMatch[2]) || DET_OPTION_MARKS_RE.test(optionMatch[2])
      if (accepts && !looksLikeSubtopic) {
        if (lastQuestion.options.length < MAX_OPTIONS) {
          lastQuestion.options.push(optionMatch[2].replace(/\s+/g, ' ').trim().slice(0, 2000))
        }
        lastQuestion.nextOptionLetter = String.fromCharCode(letter.charCodeAt(0) + 1)
        consume(line)
        continue
      }
    }

    const marksOnlyMatch = line.match(DET_MARKS_ONLY_RE)
    if (marksOnlyMatch && lastQuestion) {
      const marks = Number(marksOnlyMatch[1])
      if (Number.isFinite(marks) && marks > 0 && marks <= 1000 && lastQuestion.marks === null) {
        lastQuestion.marks = marks
      }
      consume(line)
      continue
    }

    // Header/meta lines: recognised structure, but not questions.
    const maxMarksMatch = line.match(DET_MAX_MARKS_RE)
    if (maxMarksMatch) {
      if (!meta.totalMarks) meta.totalMarks = Math.max(0, Math.min(10_000, Math.round(Number(maxMarksMatch[1]) || 0)))
      consume(line)
      continue
    }
    const timeMatch = line.match(DET_TIME_RE)
    if (timeMatch) {
      const value = Number(timeMatch[1])
      if (!meta.durationMinutes && Number.isFinite(value)) {
        const minutes = /^h/i.test(timeMatch[2]) ? value * 60 : value
        meta.durationMinutes = Math.max(0, Math.min(1440, Math.round(minutes)))
      }
      consume(line)
      continue
    }
    const subjectMatch = line.match(DET_SUBJECT_RE)
    if (subjectMatch) {
      if (!meta.subject) meta.subject = subjectMatch[1].trim().slice(0, 200)
      consume(line)
      continue
    }
    if (DET_DATE_LINE_RE.test(line) || (line.length <= 120 && !meta.title && DET_TITLE_RE.test(line) && !lastQuestion)) {
      if (line.length <= 120 && DET_TITLE_RE.test(line) && !meta.title && !lastQuestion) meta.title = line.slice(0, 200)
      consume(line)
      continue
    }

    if (lastQuestion) {
      // Continuation of the current question — including printed sub-parts
      // like "(a) … (b) …", which stay inside the question text on purpose.
      // Plain prose is absorbed (so wrapped questions come out complete) but
      // is NOT counted as recognised: it is not evidence of the standard
      // layout, and counting it would let a wall of text after one "1." line
      // fake its way past the coverage guard. Sub-topic lines that START with
      // a marker ("(B) …", "b) …", "(ii) …") ARE structured and count.
      const { rest, marks } = detStripMarks(line)
      if (marks !== null && lastQuestion.marks === null) lastQuestion.marks = marks
      const cap = lastQuestion.compound ? DET_COMPOUND_CONTINUATION_CHARS : DET_MAX_CONTINUATION_CHARS
      if (rest && lastQuestion.continuationChars < cap) {
        const budget = cap - lastQuestion.continuationChars
        const keep = countChars(rest) > budget ? `${rest.slice(0, budget)}…` : rest
        lastQuestion.continuationChars += countChars(keep)
        lastQuestion.text = `${lastQuestion.text} ${keep}`.replace(/\s+/g, ' ').trim().slice(0, MAX_QUESTION_TEXT)
        if (leadingSubpartMarker(rest)) {
          lastQuestion.compound = true
          consume(line)
        }
      }
      continue
    }

    const section = current
    if (section) {
      const defaultMatch = line.match(DET_DEFAULT_MARKS_RE)
      if (defaultMatch) {
        const value = Number(defaultMatch[1])
        if (Number.isFinite(value) && value > 0 && value <= 1000 && section.defaultMarks === 0) section.defaultMarks = value
        consume(line)
        continue
      }
      if (section.questions.length === 0 && line.length <= 300) {
        // Section instruction block ("Answer ALL questions …") — keep it for
        // the editor, but it never counts towards coverage on its own.
        section.instructions.push(line)
      }
    }
  }

  if (questionCount >= MAX_QUESTIONS) capped = true

  let zeroMarks = 0
  const outSections: ParsedSection[] = []
  for (const section of sections.slice(0, MAX_SECTIONS)) {
    // Merge pass: sub-topic lines that the numbered-question rule split into
    // their own drafts ("1. Answer the following :" / "1) …" / "2) …") are
    // re-combined into ONE question carrying ALL sub-topics, exactly as
    // printed. Letter/roman markers follow mergeSubpartQuestions semantics;
    // numbered drafts additionally need layout context — they merge only as a
    // consecutive chain (1 → 2 → 3) opened by a "following"-type question, so
    // papers numbered "1) 2) 3)" at the top level stay intact.
    const mergedDrafts: DetDraftQuestion[] = []
    let digitChain: number | null = null
    for (const question of section.questions) {
      // A pending opener that never got body text (a stray "2." / page number)
      // is dropped — it was not a question.
      if (!question.text.trim()) continue
      const prev = mergedDrafts[mergedDrafts.length - 1]
      const marker = leadingSubpartMarker(question.text)
      if (prev) {
        let merge = false
        // How the merged sub-topic is re-attached: letter/roman markers are
        // already part of the text; numbered drafts had their "N)" stripped
        // when the line rule created them, so it is restored here.
        let attachText = question.text
        if (marker && !/^\d+$/.test(marker)) {
          const first = isFirstSubpartMarker(marker)
          const prevRank = lastSubpartRank(prev.text)
          merge = !first || (prevAcceptsSubpart(prev.text) && (prevRank === null || prevRank < subpartRank(marker)))
        } else if (question.num !== null) {
          // A numbered chain starts at "1)" right after an "Answer the
          // following"-style opener that has no letter sub-topics of its own,
          // then continues 1 → 2 → 3 …. Top-level numbering never restarts
          // at 1 mid-section, so this cannot swallow a genuine next question.
          merge =
            digitChain !== null
              ? question.num === digitChain + 1
              : question.num === 1 &&
                prevOpensNumberedSubparts(prev.text) &&
                !containsSubpartMarker(prev.text)
          if (merge) {
            digitChain = question.num
            attachText = `${question.num}) ${question.text}`
          }
        }
        if (merge) {
          prev.text = `${prev.text} ${attachText}`.replace(/\s+/g, ' ').trim().slice(0, MAX_QUESTION_TEXT)
          prev.marks =
            prev.marks === null ? question.marks : question.marks === null ? prev.marks : prev.marks + question.marks
          prev.compound = true
          prev.continuationChars += question.continuationChars
          continue
        }
      }
      digitChain = null
      mergedDrafts.push(question)
    }

    const questions: ParsedQuestion[] = []
    for (const question of mergedDrafts) {
      const marks = question.marks ?? (section.defaultMarks || 0)
      if (marks === 0) zeroMarks += 1
      questions.push({
        text: question.text.trim(),
        // Resolve the section-default marks BEFORE typing so a compound
        // question worth 10 marks via "Each question carries 10 marks" is
        // typed long_answer, not short_answer.
        type: detQuestionType({ ...question, marks }),
        marks: normalizeMarks(marks),
        topic: '',
        ...(question.options.length > 0 ? { options: question.options.filter(Boolean) } : {}),
      })
    }
    if (questions.length === 0) continue
    outSections.push({
      name: section.name || `Section ${outSections.length + 1}`,
      instructions: section.instructions.join(' ').replace(/\s+/g, ' ').trim().slice(0, 2000),
      questions,
    })
  }
  if (sections.length > MAX_SECTIONS) warnings.push(`Only the first ${MAX_SECTIONS} sections were kept.`)

  const coverage = totalChars > 0 ? recognisedChars / totalChars : 0
  const questionCountOut = outSections.reduce((sum, section) => sum + section.questions.length, 0)
  if (questionCountOut > 0 && zeroMarks === questionCountOut) {
    warnings.push('No printed marks were recognised — every question shows 0 marks. Set the marks before confirming.')
  } else if (zeroMarks > 0) {
    warnings.push(`${zeroMarks} question(s) have no printed marks and show 0 — set them before confirming.`)
  }
  if (!capped && questionCountOut === 0) {
    warnings.push('The printed line layout did not match the standard question pattern.')
  }
  const accepted = questionCountOut >= 1 && coverage >= MIN_DETERMINISTIC_COVERAGE
  if (!accepted && questionCountOut > 0) {
    warnings.push(`Only ${Math.round(coverage * 100)}% of the document text was recognised (needs ≥ ${Math.round(MIN_DETERMINISTIC_COVERAGE * 100)}%) — deferring to the AI fallback.`)
  }

  return { meta, sections: outSections, questionCount: questionCountOut, warnings, note: '', accepted, coverage }
}

function extractJsonObject(raw: string): unknown {
  let text = String(raw || '').trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) text = fence[1].trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new HttpsError('internal', 'The AI response could not be read. Try parsing again.')
  }
  const candidate = text.slice(start, end + 1)
  try {
    return JSON.parse(candidate)
  } catch {
    throw new HttpsError('internal', 'The AI response could not be read. Try parsing again.')
  }
}

// ─── parsePaperFile — assistive parse, NO bank write, NO auto-publish ──────

export interface ParsePaperFileResult {
  status: 'parsed' | 'scanned' | 'unrecognized'
  /** Which engine produced the result — deterministic layout rules or AI. */
  method: 'deterministic' | 'gemini'
  message: string
  sections: ParsedSection[]
  meta: ParsedMeta
  questionCount: number
  warnings: string[]
  fileKind: 'pdf' | 'docx'
  textLength: number
}

export const parsePaperFile = onCall(
  { region: 'asia-south1', memory: '512MiB', timeoutSeconds: 180, minInstances: 0, maxInstances: 20 },
  async (request) => {
    const uid = request.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Authentication is required')
    const staff = await resolvePaperStaff(uid, request.auth?.token || {})
    const paperId = String(request.data?.paperId || '')
    const requestedCollege = String(request.data?.collegeId || '')
    const collegeId = staff.role === 'superadmin' ? requestedCollege : staff.collegeId
    if (!paperId || paperId.includes('/') || paperId.length > 200 || !collegeId) {
      throw new HttpsError('invalid-argument', 'Paper and college identifiers are required')
    }

    const db = getFirestore(admin.app(), 'default')
    const ref = db.collection('papers').doc(paperId)
    const snapshot = await ref.get()
    const paper = snapshot.data()
    if (!snapshot.exists || !paper) throw new HttpsError('not-found', 'Paper not found')
    if (staff.role !== 'superadmin' && paper.collegeId !== collegeId) {
      throw new HttpsError('permission-denied', 'Paper belongs to another college')
    }
    const isReviewer = REVIEW_ROLES.includes(staff.role)
    if (!isReviewer && paper.createdBy !== uid) {
      throw new HttpsError('permission-denied', 'Only the paper author or an authorized reviewer can parse this paper')
    }

    const path = String(paper.filePath || '')
    if (!path) {
      throw new HttpsError('failed-precondition', 'Attach a paper file first, save the paper, then parse it')
    }
    const bucket = admin.storage().bucket()
    const file = bucket.file(path)
    let metadata: Record<string, unknown>
    try {
      const metadataResult = await file.getMetadata()
      metadata = metadataResult[0]
    } catch {
      throw new HttpsError('failed-precondition', 'The attached paper file is no longer available')
    }
    const contentType = String(metadata.contentType || '')
    const size = Number(metadata.size || 0)
    if (size <= 0 || size > MAX_FILE_BYTES) {
      throw new HttpsError('invalid-argument', 'The paper file is empty or too large to parse')
    }
    if (contentType === 'image/jpeg' || contentType === 'image/png') {
      throw new HttpsError(
        'failed-precondition',
        'This file looks like a scanned image. Only digital PDF and DOCX can be parsed for now — upload the digital file or add the questions manually.'
      )
    }
    if (contentType !== PDF_TYPE && contentType !== DOCX_TYPE) {
      throw new HttpsError(
        'failed-precondition',
        'Only digital PDF and DOCX files can be parsed. Scanned images and legacy .doc files are not supported yet.'
      )
    }

    const [fileData] = await file.download()
    const extracted = await extractPaperText(Buffer.from(fileData), contentType)
    const text = extracted.text.split(String.fromCharCode(0)).join('').trim()
    if (text.length < MIN_TEXT_CHARS) {
      const result: ParsePaperFileResult = {
        status: 'scanned',
        method: 'deterministic',
        message:
          'No readable text was found in this file — it looks like a scanned image or an image-based PDF. ' +
          'Upload the digital PDF/DOCX instead, or type the questions in manually. Scanned-image support is planned for a later update.',
        sections: [],
        meta: { ...EMPTY_META },
        questionCount: 0,
        warnings: [],
        fileKind: extracted.kind,
        textLength: text.length,
      }
      return result
    }

    // Deterministic first: standard printed layouts parse on the server alone.
    const deterministic = deterministicParse(text)
    if (deterministic.accepted) {
      await db.collection('ai_generation_logs').add({
        userId: uid,
        collegeId,
        provider: 'none',
        model: 'deterministic-layout-parser',
        method: 'deterministic',
        kind: 'paper-parse',
        paperId,
        numQuestions: deterministic.questionCount,
        config: { fileKind: extracted.kind, textLength: text.length, coverage: Math.round(deterministic.coverage * 100) / 100 },
        generationTime: 0,
        savedIds: [],
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      })
      logger.info('[PaperParsing] Paper parsed deterministically (no AI, no writes)', {
        paperId,
        collegeId,
        questionCount: deterministic.questionCount,
        coverage: Math.round(deterministic.coverage * 100),
      })
      const result: ParsePaperFileResult = {
        status: 'parsed',
        method: 'deterministic',
        message:
          `Recognised ${deterministic.questionCount} question(s) straight from the printed layout — no AI was used. ` +
          'Review every question — especially marks — before you confirm.',
        sections: deterministic.sections,
        meta: deterministic.meta,
        questionCount: deterministic.questionCount,
        warnings: deterministic.warnings,
        fileKind: extracted.kind,
        textLength: text.length,
      }
      return result
    }

    // Unusual layout (or nothing recognised) — fall back to Gemini. With no
    // key configured the paper stays manually editable instead of failing.
    const client = geminiClient()
    if (!client) {
      const partial =
        deterministic.questionCount > 0
          ? `A rule-based pass found ${deterministic.questionCount} question(s) but the layout was too unusual to trust, `
          : ''
      const result: ParsePaperFileResult = {
        status: 'unrecognized',
        method: 'deterministic',
        message:
          `${partial}AI parsing is not configured on the server, so nothing was transcribed. Add the questions manually for now.`,
        sections: [],
        meta: { ...EMPTY_META },
        questionCount: 0,
        warnings: deterministic.warnings,
        fileKind: extracted.kind,
        textLength: text.length,
      }
      return result
    }

    const startedAt = Date.now()
    const prompt = buildParsePrompt(text.length > MAX_PARSE_CHARS ? text.slice(0, MAX_PARSE_CHARS) : text, paper)
    const parseRequest: GenerateContentRequest = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseSchema: PAPER_STRUCTURE_SCHEMA,
      },
    }
    let rawResponse: string
    let usedModel = primaryGeminiModel(PARSE_TIER)
    try {
      const generated = await generateWithGeminiFallback(PARSE_TIER, (modelId) =>
        client.getGenerativeModel({ model: modelId }).generateContent(parseRequest), {
        onFallback: ({ failedModel, nextModel, error }) =>
          logger.warn('[PaperParsing] Gemini model unavailable, trying next tier entry', {
            failedModel,
            nextModel,
            error: (error as Error)?.message,
          }),
      })
      usedModel = generated.model
      rawResponse = generated.result.response.text()
    } catch (err) {
      logger.error('[PaperParsing] Gemini parse failed', err)
      throw new HttpsError('internal', 'Parsing failed right now. Try again in a moment, or add the questions manually.')
    }

    const parsed = normalizeParsedStructure(extractJsonObject(rawResponse))

    // Audit trail: parsing never saves anything (savedIds stays empty).
    await db.collection('ai_generation_logs').add({
      userId: uid,
      collegeId,
      provider: 'gemini',
      model: usedModel,
      method: 'gemini',
      kind: 'paper-parse',
      paperId,
      numQuestions: parsed.questionCount,
      config: { fileKind: extracted.kind, textLength: text.length, deterministicCoverage: Math.round(deterministic.coverage * 100) / 100 },
      generationTime: Date.now() - startedAt,
      savedIds: [],
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    })

    logger.info('[PaperParsing] Paper parsed (no writes)', {
      paperId,
      collegeId,
      questionCount: parsed.questionCount,
      status: parsed.sections.length > 0 ? 'parsed' : parsed.note ? 'unrecognized' : 'scanned',
    })

    const result: ParsePaperFileResult = {
      status: parsed.sections.length > 0 ? 'parsed' : 'unrecognized',
      method: 'gemini',
      message:
        parsed.sections.length > 0
          ? `Transcribed ${parsed.questionCount} question(s) from the file. Review every question — especially marks — before you confirm.`
          : parsed.note || 'No questions could be found in this file. Add the questions manually, or check that the file is a digital question paper.',
      sections: parsed.sections,
      meta: parsed.meta,
      questionCount: parsed.questionCount,
      warnings: parsed.warnings,
      fileKind: extracted.kind,
      textLength: text.length,
    }
    return result
  }
)

// ─── confirmPaperStructure — the one server-side Confirm ───────────────────

export interface ConfirmSectionQuestion {
  text: string
  type: string
  marks: number
  topic: string
  options?: string[]
}

export interface ConfirmSection {
  id: string
  name: string
  questions: ConfirmSectionQuestion[]
}

/**
 * Validates the paper's stored sections into a strict confirm shape.
 * Marks must be > 0 and types must be online-schedulable — a confirmed
 * structure is what Assessments will schedule, so incomplete questions are
 * rejected here rather than surfacing later at schedule time.
 */
export function normalizeConfirmSections(sections: unknown): ConfirmSection[] {
  const source = Array.isArray(sections) ? sections.slice(0, MAX_SECTIONS) : []
  const result: ConfirmSection[] = []
  let questionCount = 0
  let order = 0
  source.forEach((rawSection, sectionIndex) => {
    if (!rawSection || typeof rawSection !== 'object' || Array.isArray(rawSection)) return
    const section = rawSection as Record<string, unknown>
    const sourceQuestions = Array.isArray(section.questions) ? section.questions : []
    const questions: ConfirmSectionQuestion[] = []
    sourceQuestions.forEach((rawQuestion) => {
      if (!rawQuestion || typeof rawQuestion !== 'object' || Array.isArray(rawQuestion)) return
      const question = rawQuestion as Record<string, unknown>
      order += 1
      const text = String(question.text || question.questionText || '').replace(/\s+/g, ' ').trim()
      if (!text) {
        throw new HttpsError('failed-precondition', `Question ${order} has no text. Open the paper editor and fix it.`)
      }
      // Confirm is strict: an unrecognised type is a data problem the faculty
      // must fix in the editor, not something to silently rewrite.
      if (!isKnownQuestionType(question.type)) {
        throw new HttpsError(
          'failed-precondition',
          `Question ${order} uses "${String(question.type || '')}", which cannot be scheduled online. Change it to a supported type (MCQ, True/False, Fill in the blank, Short/Long answer, Numerical, Assertion–Reason or Case-based).`
        )
      }
      const type = normalizeQuestionType(question.type)
      // A type the parser knows but the online engine cannot render (today:
      // matching) is rejected HERE, with the same wording the schedule-time
      // check uses, instead of passing Confirm and failing later at
      // "Assessment Schedule" after the paper was already marked onlineReady.
      if (!SCHEDULABLE_ONLINE_TYPES.has(type)) {
        const problem = findSchedulingProblem({
          order, text, type, marks: 1,
          options: type === 'assertion_reason'
            ? [{ id: 'A', text: '' }, { id: 'B', text: '' }]
            : [],
        })
        throw new HttpsError('failed-precondition', problem || `Question ${order} uses "${type}", which cannot be scheduled online.`)
      }
      const marks = Number(question.marks)
      if (!Number.isFinite(marks) || marks <= 0) {
        throw new HttpsError('failed-precondition', `Question ${order} has no marks. Set marks before confirming.`)
      }
      if (marks > 1000) {
        throw new HttpsError('failed-precondition', `Question ${order} has more than 1000 marks.`)
      }
      if (questionCount >= MAX_QUESTIONS) {
        throw new HttpsError('failed-precondition', `A paper can contain at most ${MAX_QUESTIONS} questions.`)
      }
      const topic = String(question.topic || question.chapter || '').trim().slice(0, 200)
      const options = ['mcq', 'multi_select', 'true_false'].includes(type) && Array.isArray(question.options)
        ? question.options
            .map((option: unknown) => {
              if (typeof option === 'string') return option.trim()
              const value = (option || {}) as Record<string, unknown>
              return String(value.text || value.label || '').trim()
            })
            .filter(Boolean)
            .slice(0, MAX_OPTIONS)
        : undefined
      // Choice types need at least two real options. Checked here (same
      // validator as the schedule-time gate) so a one-option MCQ cannot sail
      // through Confirm and blow up later at schedule time.
      const optionProblem = findSchedulingProblem({
        order, text, type, marks,
        options: type === 'assertion_reason'
          ? [{ id: 'A', text: '' }, { id: 'B', text: '' }]
          : (options || []).map((label, index) => ({ id: String(index), text: label })),
      })
      if (optionProblem) {
        throw new HttpsError('failed-precondition', optionProblem)
      }
      questions.push({
        text: text.slice(0, MAX_QUESTION_TEXT),
        type,
        marks: Math.round(marks * 100) / 100,
        topic,
        ...(options && options.length > 0 ? { options } : {}),
      })
      questionCount += 1
    })
    if (questions.length === 0) return
    result.push({
      id: String(section.id || '').trim().slice(0, 100) || `section-${sectionIndex + 1}`,
      name: String(section.name || section.title || '').trim().slice(0, 200) || `Section ${sectionIndex + 1}`,
      questions,
    })
  })
  if (result.length === 0) {
    throw new HttpsError('failed-precondition', 'Nothing to confirm — the paper has no structured questions yet.')
  }
  return result
}

/**
 * Which (state, actor) pairs may run the Confirm. Drafts and review-bounced
 * states behave like savePaper; "Ready to use" papers may be resynced by
 * their author or a reviewer; papers inside the approval queue may be
 * resynced by whoever is driving the submission; already-approved papers
 * may only be resynced by a reviewer.
 */
export function canConfirmPaperStructure(
  paper: { verificationStatus?: unknown; status?: unknown; createdBy?: unknown },
  staff: { role: string },
  uid: string
): boolean {
  const verificationStatus = String(paper.verificationStatus || paper.status || 'draft')
  const isReviewer = REVIEW_ROLES.includes(staff.role)
  const isAuthor = String(paper.createdBy || '') === uid
  if (EDITABLE_STATES.includes(verificationStatus)) return isReviewer || isAuthor
  if (verificationStatus === 'not-required' || verificationStatus === 'submitted-for-approval' || verificationStatus === 'pending-verification') {
    return isReviewer || isAuthor
  }
  if (verificationStatus === 'approved-by-hod' || verificationStatus === 'published') {
    return isReviewer
  }
  return false
}

export const confirmPaperStructure = onCall(
  { region: 'asia-south1', memory: '512MiB', timeoutSeconds: 180, minInstances: 0, maxInstances: 20 },
  async (request) => {
    const uid = request.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Authentication is required')
    const staff = await resolvePaperStaff(uid, request.auth?.token || {})
    const paperId = String(request.data?.paperId || '')
    const requestedCollege = String(request.data?.collegeId || '')
    const collegeId = staff.role === 'superadmin' ? requestedCollege : staff.collegeId
    if (!paperId || paperId.includes('/') || paperId.length > 200 || !collegeId) {
      throw new HttpsError('invalid-argument', 'Paper and college identifiers are required')
    }

    const db = getFirestore(admin.app(), 'default')
    const ref = db.collection('papers').doc(paperId)
    const before = await ref.get()
    const paper = before.data()
    if (!before.exists || !paper) throw new HttpsError('not-found', 'Paper not found')
    if (staff.role !== 'superadmin' && paper.collegeId !== collegeId) {
      throw new HttpsError('permission-denied', 'Paper belongs to another college')
    }
    if (!canConfirmPaperStructure(paper, staff, uid)) {
      throw new HttpsError('failed-precondition', 'This paper cannot have its structure confirmed in its current state')
    }

    // The paper document is the source of truth — never trust a client-supplied
    // structure here; the faculty already reviewed it through the editor.
    const sections = normalizeConfirmSections(paper.sections)
    const questionCount = sections.reduce((sum, section) => sum + section.questions.length, 0)
    const totalMarks = sections.reduce(
      (sum, section) => sum + section.questions.reduce((sectionSum, question) => sectionSum + question.marks, 0),
      0
    )

    // Figure out what the paper currently points at so owned bank documents
    // are cleaned up and shared bank documents are only unlinked.
    const previousIds = (Array.isArray(paper.questionIds) ? paper.questionIds : [])
      .map((id: unknown) => String(id))
      .filter(Boolean)
    const owned: string[] = []
    const shared: string[] = []
    for (let i = 0; i < previousIds.length; i += 100) {
      const chunk = previousIds.slice(i, i + 100)
      if (chunk.length === 0) break
      const docs = await db.getAll(...chunk.map((id) => db.collection('questions').doc(id)))
      docs.forEach((docSnap) => {
        const data = docSnap.data()
        if (!data) return
        if (data.source === 'paper-confirm' && String(data.paperId || '') === paperId) owned.push(docSnap.id)
        else shared.push(docSnap.id)
      })
    }

    const questionRefs: Array<FirebaseFirestore.DocumentReference> = []
    const newIds: string[] = []
    sections.forEach((section) => {
      section.questions.forEach(() => {
        const questionRef = db.collection('questions').doc()
        questionRefs.push(questionRef)
        newIds.push(questionRef.id)
      })
    })

    // ── Write plan ─────────────────────────────────────────────────────
    // Firestore transactions cap at 500 operations and a re-confirm replaces
    // the whole owned set (deletes + creates + paper update + audit). For
    // typical papers everything therefore runs in ONE atomic transaction, so
    // a failure cannot leave orphaned bank documents behind. Only unusually
    // large papers fall back to a two-phase write (batch, then the guarded
    // paper update); their owned documents carry source/paperId tags, so a
    // subsequent confirm still cleans them up.
    const operationCount = owned.length + shared.length + questionCount + 2
    const atomic = operationCount <= 480

    const questionDocData = (
      question: ConfirmSectionQuestion,
      section: ConfirmSection,
      order: number
    ): admin.firestore.DocumentData => ({
      text: question.text,
      questionText: question.text,
      type: question.type,
      questionType: question.type,
      marks: question.marks,
      negativeMarks: 0,
      topic: question.topic,
      chapter: question.topic,
      unit: question.topic,
      subject: String(paper.subject || ''),
      branch: String(paper.branch || ''),
      batch: String(paper.batch || ''),
      semester: paper.semester,
      sectionId: section.id,
      sectionName: section.name,
      order,
      difficulty: 'medium',
      status: 'active',
      reviewed: true,
      isAIGenerated: false,
      source: 'paper-confirm',
      paperId,
      linkedPaperIds: [paperId],
      usageCount: 0,
      searchKeywords: [question.text, question.topic, paper.subject]
        .filter(Boolean)
        .map((value) => String(value).toLowerCase()),
      createdBy: uid,
      createdByName: staff.name,
      collegeId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    })

    interface BankWriter {
      create: (target: FirebaseFirestore.DocumentReference, data: admin.firestore.DocumentData) => void
      update: (target: FirebaseFirestore.DocumentReference, data: admin.firestore.DocumentData) => void
      delete: (target: FirebaseFirestore.DocumentReference) => void
    }
    const writeBankDocs = (writer: BankWriter) => {
      owned.forEach((id) => writer.delete(db.collection('questions').doc(id)))
      shared.forEach((id) => {
        writer.update(db.collection('questions').doc(id), {
          linkedPaperIds: admin.firestore.FieldValue.arrayRemove(paperId),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        })
      })
      let order = 0
      sections.forEach((section) => {
        section.questions.forEach((question) => {
          order += 1
          writer.create(questionRefs[order - 1], questionDocData(question, section, order))
        })
      })
    }

    const auditRef = db.collection('paperReviewAudit').doc()
    const verificationStatus = String(paper.verificationStatus || paper.status || 'draft')
    const readiness = paperReadiness({ filePath: paper.filePath, sections, questionIds: newIds })
    const paperUpdate: admin.firestore.DocumentData = {
      // The original file (print artefact) is untouched on purpose.
      sections,
      questionIds: newIds,
      linkedQuestionIds: newIds,
      totalQuestions: questionCount,
      totalMarks,
      printReady: readiness.printReady,
      onlineReady: readiness.onlineReady,
      bankReady: readiness.bankReady,
      updatedBy: uid,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }
    const auditData = {
      paperId,
      collegeId,
      action: 'paper_structure_confirmed',
      fromStatus: verificationStatus,
      toStatus: verificationStatus,
      performedBy: uid,
      performedAt: admin.firestore.FieldValue.serverTimestamp(),
    }

    if (atomic) {
      await db.runTransaction(async (transaction) => {
        const current = await transaction.get(ref)
        if (!current.exists || current.updateTime?.isEqual(before.updateTime!) !== true) {
          throw new HttpsError('aborted', 'Paper changed while it was being confirmed; reload and try again')
        }
        writeBankDocs(transaction)
        transaction.update(ref, paperUpdate)
        transaction.create(auditRef, auditData)
      })
    } else {
      // Two-phase write for papers too large for one transaction. The owned
      // deletes are DELAYED until after the paper update succeeds, so an
      // aborted paper transaction can never leave the paper pointing at
      // deleted documents. Batch commits are chunked below the 500-operation
      // batch limit.
      type BankOp = (batch: FirebaseFirestore.WriteBatch) => void
      const ops: BankOp[] = []
      shared.forEach((id) => {
        ops.push((batch) => {
          batch.update(db.collection('questions').doc(id), {
            linkedPaperIds: admin.firestore.FieldValue.arrayRemove(paperId),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          })
        })
      })
      let order = 0
      sections.forEach((section) => {
        section.questions.forEach((question) => {
          order += 1
          const data = questionDocData(question, section, order)
          const target = questionRefs[order - 1]
          ops.push((batch) => batch.create(target, data))
        })
      })
      for (let i = 0; i < ops.length; i += 450) {
        const batch = db.batch()
        ops.slice(i, i + 450).forEach((op) => op(batch))
        await batch.commit()
      }
      await db.runTransaction(async (transaction) => {
        const current = await transaction.get(ref)
        if (!current.exists || current.updateTime?.isEqual(before.updateTime!) !== true) {
          throw new HttpsError('aborted', 'Paper changed while it was being confirmed; reload and try again')
        }
        transaction.update(ref, paperUpdate)
        transaction.create(auditRef, auditData)
      })
      const cleanup = db.batch()
      owned.forEach((id) => cleanup.delete(db.collection('questions').doc(id)))
      await cleanup.commit().catch((err) => {
        // Non-fatal: the stale docs are no longer referenced by the paper and
        // carry the source/paperId tags, so the next confirm removes them.
        logger.warn('[PaperParsing] Deferred cleanup of old question docs failed', err)
      })
    }

    logger.info('[PaperParsing] Paper structure confirmed', {
      paperId,
      collegeId,
      questionCount,
      replaced: previousIds.length,
    })

    return {
      status: 'confirmed',
      paperId,
      questionCount,
      questionIds: newIds,
      totalMarks,
      readiness,
    }
  }
)
