import { getFirestore } from 'firebase-admin/firestore';
import { getApps, initializeApp } from 'firebase-admin/app';
if (!getApps().length) initializeApp();
// ─────────────────────────────────────────────────────────────────────────────
// University Scheme Packs — persistence (G1)
//
// WHY THIS EXISTS
// Karnataka's ~33 state universities each publish a different scheme of
// examination (marks split, IA composition, attendance slabs, pass floors,
// grade tables). The pack content lives client-side as presets and evaluates
// through src/shared/utils/schemeEngine.ts; THIS module owns trust:
//   saveSchemePack           — admins author/edit custom packs for their
//                              college (cloned from a preset or from scratch).
//                              Server-side validation rejects malformed packs
//                              (slab gaps, >100% totals, inverted ranges).
//   assignCollegeSchemePack  — binds a pack (preset code or custom doc) to a
//                              college: colleges/{id}.schemePackId. Every
//                              consumer (result importer, hall tickets,
//                              compliance dashboard) resolves through this.
//
// Reads stay client-side (schemePacks is read-only for clients; rules allow
// reads scoped to the college, writes never) — that keeps the Scheme Packs
// page fast and the write path single-door.
// ─────────────────────────────────────────────────────────────────────────────

import * as admin from 'firebase-admin'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { resolveSchedulingStaff } from './classSchedule'

// ═════════════════════════════════════════════════════════════════════════════
// Pure validation (unit tested, no Firestore)
// ═════════════════════════════════════════════════════════════════════════════

export interface SchemePackDoc {
  code: string
  name: string
  universityName: string
  schemeName: string
  applicableProgrammes: string[]
  attendance: {
    minimumPercentage: number
    marksSlabs: { min: number; max: number; marks: number; label: string }[]
    blocksExamEligibility: boolean
  }
  internalAssessment: {
    totalMarks: number
    test: { count: number; maxMarksEach: number; bestOf: number; weightInTotal: number }
    attendanceMaxMarks: number
    assignmentMaxMarks: number
  }
  semesterEndExam: { defaultMaxMarks: number; durationMinutes: number; passPercentage: number; scaleFrom?: number }
  passCriteria: {
    aggregatePassPercentage: number
    minimumInternalPercentage: number
    requireSemesterEndPass: boolean
  }
  gradeTable: { grade: string; gradePoint: number; minPercentage: number; description: string }[]
  mediums: string[]
  status: 'active' | 'draft' | 'archived'
  sourceNote?: string
  engineering?: EngineeringSchemePackDoc
}

export interface EngineeringSchemePackDoc {
  courseTypes?: Record<string, {
    internal: number
    external: number
    heads?: string[]
    internalSplit?: Record<string, number>
    internalOnly?: boolean
  }>
  grading?: {
    method: 'absolute' | 'relative'
    relativeBands?: Array<{
      grade: string
      gradePoint: number
      minPercentile: number
      absoluteMinPercentage?: number
      description?: string
    }>
    minCohortSizeForRelative?: number
  }
  percentageConversion?: {
    expression: string
    note?: string
    batchRules?: Array<{
      admissionYears?: number[]
      fromAdmissionYear?: number
      throughAdmissionYear?: number
      expression: string
      note?: string
    }>
  }
  paperTemplate?: {
    code: string
    modules?: number
    questionsPerModule?: number
    marksPerFullQuestion?: number
    maxSubQuestions?: number
    sections?: Array<{
      code: string
      label: string
      questions: number
      toAttempt: number
      marksEach: number
    }>
    rawTotal: number
    durationMinutes: number
    minHigherOrderPercentage?: number
    difficultyTarget?: number
  }
  attainment?: {
    enabled: boolean
    framework?: string
    levels?: Array<{ level: number; minPercentStudents: number }>
    coThresholdPercentage?: number
    directWeight?: number
    indirectWeight?: number
    correlationScale?: number[]
  }
}

const CODE_RE = /^[A-Za-z0-9_]{3,40}$/

function boundedNumber(value: unknown, field: string, min: number, max: number): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new HttpsError('invalid-argument', `${field} must be a number between ${min} and ${max}`)
  }
  return n
}

function boundedString(value: unknown, field: string, maximum: number, required = true): string {
  const s = String(value ?? '').trim()
  if (required && !s) throw new HttpsError('invalid-argument', `${field} is required`)
  if (s.length > maximum) throw new HttpsError('invalid-argument', `${field} is too long (max ${maximum})`)
  return s
}

function stringArray(value: unknown, field: string, maxItems: number): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((v) => String(v ?? '').trim())
    .filter(Boolean)
    .slice(0, maxItems)
}

function safeConversionExpression(value: unknown, field: string): string {
  const expression = boundedString(value, field, 120)
  // Keep the server validator in lockstep with the non-eval shared helper.
  const offset = /^\s*\(\s*CGPA\s*[+-]\s*\d+(?:\.\d+)?\s*\)\s*\*\s*\d+(?:\.\d+)?\s*$/i
  const direct = /^\s*CGPA\s*\*\s*\d+(?:\.\d+)?\s*$/i
  if (!offset.test(expression) && !direct.test(expression)) {
    throw new HttpsError('invalid-argument', `${field} must be a supported CGPA arithmetic formula`)
  }
  return expression
}

function validateEngineeringDoc(value: unknown): EngineeringSchemePackDoc | undefined {
  if (value == null) return undefined
  const raw = (value || {}) as Record<string, unknown>
  const result: EngineeringSchemePackDoc = {}

  if (raw.courseTypes != null) {
    const courseTypesRaw = raw.courseTypes as Record<string, unknown>
    if (!courseTypesRaw || typeof courseTypesRaw !== 'object' || Array.isArray(courseTypesRaw)) {
      throw new HttpsError('invalid-argument', 'engineering.courseTypes must be an object')
    }
    const entries = Object.entries(courseTypesRaw)
    if (entries.length > 40) throw new HttpsError('invalid-argument', 'engineering.courseTypes allows at most 40 types')
    result.courseTypes = {}
    for (const [rawKey, rawType] of entries) {
      const key = rawKey.trim()
      if (!/^[A-Za-z0-9_-]{1,50}$/.test(key)) {
        throw new HttpsError('invalid-argument', `Invalid engineering.courseTypes key: ${rawKey}`)
      }
      const type = (rawType || {}) as Record<string, unknown>
      const internal = boundedNumber(type.internal, `engineering.courseTypes.${key}.internal`, 0, 200)
      const external = boundedNumber(type.external, `engineering.courseTypes.${key}.external`, 0, 200)
      let internalSplit: Record<string, number> | undefined
      if (type.internalSplit != null) {
        const splits = type.internalSplit as Record<string, unknown>
        if (!splits || typeof splits !== 'object' || Array.isArray(splits)) {
          throw new HttpsError('invalid-argument', `engineering.courseTypes.${key}.internalSplit must be an object`)
        }
        const splitEntries = Object.entries(splits)
        if (splitEntries.length > 12) throw new HttpsError('invalid-argument', `engineering.courseTypes.${key}.internalSplit allows at most 12 heads`)
        internalSplit = Object.fromEntries(splitEntries.map(([head, marks]) => [
          boundedString(head, `engineering.courseTypes.${key}.internalSplit head`, 40),
          boundedNumber(marks, `engineering.courseTypes.${key}.internalSplit.${head}`, 0, internal),
        ]))
      }
      result.courseTypes[key] = {
        internal,
        external,
        ...(Array.isArray(type.heads) ? { heads: stringArray(type.heads, `engineering.courseTypes.${key}.heads`, 12) } : {}),
        ...(internalSplit ? { internalSplit } : {}),
        ...(type.internalOnly === true ? { internalOnly: true } : {}),
      }
    }
  }

  if (raw.grading != null) {
    const grading = (raw.grading || {}) as Record<string, unknown>
    const method = grading.method === 'relative' ? 'relative' : 'absolute'
    const bandsRaw = Array.isArray(grading.relativeBands) ? grading.relativeBands : []
    if (bandsRaw.length > 14) throw new HttpsError('invalid-argument', 'engineering.grading.relativeBands allows at most 14 rows')
    const relativeBands = bandsRaw.map((band, index) => {
      const row = (band || {}) as Record<string, unknown>
      return {
        grade: boundedString(row.grade, `engineering.grading.relativeBands[${index}].grade`, 6),
        gradePoint: boundedNumber(row.gradePoint, `engineering.grading.relativeBands[${index}].gradePoint`, 0, 10),
        minPercentile: boundedNumber(row.minPercentile, `engineering.grading.relativeBands[${index}].minPercentile`, 0, 100),
        ...(row.absoluteMinPercentage == null ? {} : {
          absoluteMinPercentage: boundedNumber(row.absoluteMinPercentage, `engineering.grading.relativeBands[${index}].absoluteMinPercentage`, 0, 100),
        }),
        ...(typeof row.description === 'string' ? { description: row.description.trim().slice(0, 80) } : {}),
      }
    }).sort((a, b) => b.minPercentile - a.minPercentile)
    if (method === 'relative' && relativeBands.length === 0) {
      throw new HttpsError('invalid-argument', 'Relative grading requires at least one relative grade band')
    }
    result.grading = {
      method,
      ...(relativeBands.length ? { relativeBands } : {}),
      minCohortSizeForRelative: boundedNumber(
        grading.minCohortSizeForRelative ?? 30,
        'engineering.grading.minCohortSizeForRelative',
        2,
        100000,
      ),
    }
  }

  if (raw.percentageConversion != null) {
    const conversion = (raw.percentageConversion || {}) as Record<string, unknown>
    const expression = safeConversionExpression(conversion.expression, 'engineering.percentageConversion.expression')
    const rulesRaw = Array.isArray(conversion.batchRules) ? conversion.batchRules : []
    if (rulesRaw.length > 30) throw new HttpsError('invalid-argument', 'engineering.percentageConversion.batchRules allows at most 30 rows')
    const batchRules = rulesRaw.map((rule, index) => {
      const row = (rule || {}) as Record<string, unknown>
      const years = Array.isArray(row.admissionYears)
        ? row.admissionYears.map((year, yearIndex) => {
            const n = boundedNumber(year, `engineering.percentageConversion.batchRules[${index}].admissionYears[${yearIndex}]`, 1900, 2200)
            if (!Number.isInteger(n)) throw new HttpsError('invalid-argument', 'Admission years must be integers')
            return n
          }).slice(0, 40)
        : undefined
      const fromAdmissionYear = row.fromAdmissionYear == null
        ? undefined
        : boundedNumber(row.fromAdmissionYear, `engineering.percentageConversion.batchRules[${index}].fromAdmissionYear`, 1900, 2200)
      const throughAdmissionYear = row.throughAdmissionYear == null
        ? undefined
        : boundedNumber(row.throughAdmissionYear, `engineering.percentageConversion.batchRules[${index}].throughAdmissionYear`, 1900, 2200)
      if (!years?.length && fromAdmissionYear == null && throughAdmissionYear == null) {
        throw new HttpsError('invalid-argument', `engineering.percentageConversion.batchRules[${index}] requires an admission-year selector`)
      }
      if (fromAdmissionYear != null && throughAdmissionYear != null && fromAdmissionYear > throughAdmissionYear) {
        throw new HttpsError('invalid-argument', 'Admission-year range start cannot exceed its end')
      }
      return {
        ...(years?.length ? { admissionYears: [...new Set(years)] } : {}),
        ...(fromAdmissionYear == null ? {} : { fromAdmissionYear }),
        ...(throughAdmissionYear == null ? {} : { throughAdmissionYear }),
        expression: safeConversionExpression(row.expression, `engineering.percentageConversion.batchRules[${index}].expression`),
        ...(typeof row.note === 'string' && row.note.trim() ? { note: row.note.trim().slice(0, 240) } : {}),
      }
    })
    result.percentageConversion = {
      expression,
      ...(typeof conversion.note === 'string' && conversion.note.trim() ? { note: conversion.note.trim().slice(0, 240) } : {}),
      ...(batchRules.length ? { batchRules } : {}),
    }
  }

  if (raw.paperTemplate != null) {
    const paper = (raw.paperTemplate || {}) as Record<string, unknown>
    const sectionsRaw = Array.isArray(paper.sections) ? paper.sections : []
    if (sectionsRaw.length > 20) throw new HttpsError('invalid-argument', 'engineering.paperTemplate.sections allows at most 20 rows')
    const sections = sectionsRaw.map((section, index) => {
      const row = (section || {}) as Record<string, unknown>
      const questions = boundedNumber(row.questions, `engineering.paperTemplate.sections[${index}].questions`, 1, 100)
      const toAttempt = boundedNumber(row.toAttempt, `engineering.paperTemplate.sections[${index}].toAttempt`, 1, 100)
      if (toAttempt > questions) throw new HttpsError('invalid-argument', 'A paper section cannot require more questions than it contains')
      return {
        code: boundedString(row.code, `engineering.paperTemplate.sections[${index}].code`, 20),
        label: boundedString(row.label, `engineering.paperTemplate.sections[${index}].label`, 80),
        questions,
        toAttempt,
        marksEach: boundedNumber(row.marksEach, `engineering.paperTemplate.sections[${index}].marksEach`, 1, 100),
      }
    })
    const modules = paper.modules == null ? undefined : boundedNumber(paper.modules, 'engineering.paperTemplate.modules', 1, 40)
    const questionsPerModule = paper.questionsPerModule == null ? undefined : boundedNumber(paper.questionsPerModule, 'engineering.paperTemplate.questionsPerModule', 1, 40)
    const marksPerFullQuestion = paper.marksPerFullQuestion == null ? undefined : boundedNumber(paper.marksPerFullQuestion, 'engineering.paperTemplate.marksPerFullQuestion', 1, 100)
    if (modules == null && sections.length === 0) {
      throw new HttpsError('invalid-argument', 'A paper template requires modules or at least one section')
    }
    result.paperTemplate = {
      code: boundedString(paper.code, 'engineering.paperTemplate.code', 60),
      ...(modules == null ? {} : { modules }),
      ...(questionsPerModule == null ? {} : { questionsPerModule }),
      ...(marksPerFullQuestion == null ? {} : { marksPerFullQuestion }),
      ...(paper.maxSubQuestions == null ? {} : { maxSubQuestions: boundedNumber(paper.maxSubQuestions, 'engineering.paperTemplate.maxSubQuestions', 1, 40) }),
      ...(sections.length ? { sections } : {}),
      rawTotal: boundedNumber(paper.rawTotal, 'engineering.paperTemplate.rawTotal', 1, 1000),
      durationMinutes: boundedNumber(paper.durationMinutes, 'engineering.paperTemplate.durationMinutes', 30, 600),
      ...(paper.minHigherOrderPercentage == null ? {} : { minHigherOrderPercentage: boundedNumber(paper.minHigherOrderPercentage, 'engineering.paperTemplate.minHigherOrderPercentage', 0, 100) }),
      ...(paper.difficultyTarget == null ? {} : { difficultyTarget: boundedNumber(paper.difficultyTarget, 'engineering.paperTemplate.difficultyTarget', 0, 1) }),
    }
  }

  if (raw.attainment != null) {
    const attainment = (raw.attainment || {}) as Record<string, unknown>
    const levelsRaw = Array.isArray(attainment.levels) ? attainment.levels : []
    if (levelsRaw.length > 8) throw new HttpsError('invalid-argument', 'engineering.attainment.levels allows at most 8 rows')
    result.attainment = {
      enabled: attainment.enabled === true,
      ...(typeof attainment.framework === 'string' && attainment.framework.trim() ? { framework: attainment.framework.trim().slice(0, 40) } : {}),
      ...(levelsRaw.length ? { levels: levelsRaw.map((level, index) => {
        const row = (level || {}) as Record<string, unknown>
        return {
          level: boundedNumber(row.level, `engineering.attainment.levels[${index}].level`, 1, 4),
          minPercentStudents: boundedNumber(row.minPercentStudents, `engineering.attainment.levels[${index}].minPercentStudents`, 0, 100),
        }
      }) } : {}),
      ...(attainment.coThresholdPercentage == null ? {} : { coThresholdPercentage: boundedNumber(attainment.coThresholdPercentage, 'engineering.attainment.coThresholdPercentage', 0, 100) }),
      ...(attainment.directWeight == null ? {} : { directWeight: boundedNumber(attainment.directWeight, 'engineering.attainment.directWeight', 0, 1) }),
      ...(attainment.indirectWeight == null ? {} : { indirectWeight: boundedNumber(attainment.indirectWeight, 'engineering.attainment.indirectWeight', 0, 1) }),
      ...(Array.isArray(attainment.correlationScale) ? { correlationScale: attainment.correlationScale.slice(0, 10).map((weight, index) => boundedNumber(weight, `engineering.attainment.correlationScale[${index}]`, 0, 10)) } : {}),
    }
  }

  return result
}

/**
 * Structural validation for a pack a human (or the clone-preset UI) submits.
 * Numeric sanity only — the engine normalises/absorbs anything else.
 */
export function validateSchemePackDoc(raw: unknown): SchemePackDoc {
  const input = (raw || {}) as Record<string, unknown>

  const code = boundedString(input.code, 'code', 40).toUpperCase()
  if (!CODE_RE.test(code)) {
    throw new HttpsError('invalid-argument', 'code must be 3-40 chars, letters/digits/underscore')
  }

  // Attendance
  const at = (input.attendance || {}) as Record<string, unknown>
  const minimumPercentage = boundedNumber(at.minimumPercentage, 'attendance.minimumPercentage', 1, 100)
  const slabsRaw = Array.isArray(at.marksSlabs) ? at.marksSlabs : []
  if (slabsRaw.length === 0) {
    throw new HttpsError('invalid-argument', 'attendance.marksSlabs must have at least one slab')
  }
  if (slabsRaw.length > 8) {
    throw new HttpsError('invalid-argument', 'attendance.marksSlabs allows at most 8 slabs')
  }
  const marksSlabs = slabsRaw.map((s, i) => {
    const row = (s || {}) as Record<string, unknown>
    const min = boundedNumber(row.min, `marksSlabs[${i}].min`, 0, 100)
    const max = boundedNumber(row.max, `marksSlabs[${i}].max`, 0, 100)
    if (min > max) throw new HttpsError('invalid-argument', `marksSlabs[${i}]: min must be ≤ max`)
    return {
      min,
      max,
      marks: boundedNumber(row.marks, `marksSlabs[${i}].marks`, 0, 50),
      label: boundedString(row.label, `marksSlabs[${i}].label`, 60, false) || `${marksNote(min, max)}`,
    }
  })
  // First slab must start at the eligibility floor — otherwise "just above
  // the minimum" earns nothing while the rules imply it should.
  if (Math.min(...marksSlabs.map((s) => s.min)) > minimumPercentage + 1.5) {
    throw new HttpsError(
      'invalid-argument',
      'attendance slabs should start at (or just above) the minimumPercentage',
    )
  }

  // IA
  const iaRaw = (input.internalAssessment || {}) as Record<string, unknown>
  const testRaw = (iaRaw.test || {}) as Record<string, unknown>
  const iaTotal = boundedNumber(iaRaw.totalMarks, 'internalAssessment.totalMarks', 1, 100)
  const test = {
    count: boundedNumber(testRaw.count, 'internalAssessment.test.count', 1, 8),
    maxMarksEach: boundedNumber(testRaw.maxMarksEach, 'internalAssessment.test.maxMarksEach', 1, 100),
    bestOf: boundedNumber(testRaw.bestOf, 'internalAssessment.test.bestOf', 1, 8),
    weightInTotal: boundedNumber(testRaw.weightInTotal, 'internalAssessment.test.weightInTotal', 0, 100),
  }
  if (test.bestOf > test.count) {
    throw new HttpsError('invalid-argument', 'internalAssessment.test.bestOf cannot exceed test.count')
  }
  const internalAssessment = {
    totalMarks: iaTotal,
    test,
    attendanceMaxMarks: boundedNumber(iaRaw.attendanceMaxMarks, 'internalAssessment.attendanceMaxMarks', 0, 50),
    assignmentMaxMarks: boundedNumber(iaRaw.assignmentMaxMarks, 'internalAssessment.assignmentMaxMarks', 0, 50),
  }
  if (Math.abs(test.weightInTotal + internalAssessment.attendanceMaxMarks + internalAssessment.assignmentMaxMarks - iaTotal) > 0.51) {
    throw new HttpsError(
      'invalid-argument',
      'IA components (test weight + attendance + assignment) must add up to totalMarks',
    )
  }

  // SEE
  const seeRaw = (input.semesterEndExam || {}) as Record<string, unknown>
  const semesterEndExam = {
    defaultMaxMarks: boundedNumber(seeRaw.defaultMaxMarks, 'semesterEndExam.defaultMaxMarks', 10, 200),
    durationMinutes: boundedNumber(seeRaw.durationMinutes, 'semesterEndExam.durationMinutes', 30, 420),
    passPercentage: boundedNumber(seeRaw.passPercentage, 'semesterEndExam.passPercentage', 0, 100),
    ...(seeRaw.scaleFrom == null ? {} : { scaleFrom: boundedNumber(seeRaw.scaleFrom, 'semesterEndExam.scaleFrom', 1, 500) }),
  }

  // Pass criteria
  const pcRaw = (input.passCriteria || {}) as Record<string, unknown>
  const passCriteria = {
    aggregatePassPercentage: boundedNumber(pcRaw.aggregatePassPercentage, 'passCriteria.aggregatePassPercentage', 0, 100),
    minimumInternalPercentage: boundedNumber(pcRaw.minimumInternalPercentage ?? 0, 'passCriteria.minimumInternalPercentage', 0, 100),
    requireSemesterEndPass: pcRaw.requireSemesterEndPass !== false,
  }

  // Grades
  const gradesRaw = Array.isArray(input.gradeTable) ? input.gradeTable : []
  if (gradesRaw.length < 2 || gradesRaw.length > 14) {
    throw new HttpsError('invalid-argument', 'gradeTable must have between 2 and 14 rows')
  }
  const gradeTable = gradesRaw.map((g, i) => {
    const row = (g || {}) as Record<string, unknown>
    return {
      grade: boundedString(row.grade, `gradeTable[${i}].grade`, 6),
      gradePoint: boundedNumber(row.gradePoint, `gradeTable[${i}].gradePoint`, 0, 10),
      minPercentage: boundedNumber(row.minPercentage, `gradeTable[${i}].minPercentage`, 0, 100),
      description: boundedString(row.description, `gradeTable[${i}].description`, 60, false),
    }
  })

  const statusRaw = String(input.status ?? 'active').trim()
  const status = statusRaw === 'draft' || statusRaw === 'archived' ? statusRaw : 'active'
  const engineering = validateEngineeringDoc(input.engineering)

  return {
    code,
    name: boundedString(input.name, 'name', 120),
    universityName: boundedString(input.universityName, 'universityName', 120),
    schemeName: boundedString(input.schemeName, 'schemeName', 60),
    applicableProgrammes: stringArray(input.applicableProgrammes, 'applicableProgrammes', 20),
    attendance: {
      minimumPercentage,
      marksSlabs,
      blocksExamEligibility: at.blocksExamEligibility !== false,
    },
    internalAssessment,
    semesterEndExam,
    passCriteria,
    gradeTable: [...gradeTable].sort((a, b) => b.minPercentage - a.minPercentage),
    mediums: stringArray(input.mediums, 'mediums', 6),
    status,
    ...(engineering ? { engineering } : {}),
    ...(typeof input.sourceNote === 'string' && input.sourceNote.trim()
      ? { sourceNote: input.sourceNote.trim().slice(0, 300) }
      : {}),
  }
}

function marksNote(min: number, max: number): string {
  return `${min}%–${max}%`
}

// ═════════════════════════════════════════════════════════════════════════════
// Callables
// ═════════════════════════════════════════════════════════════════════════════

const REGION = { region: 'asia-south1' as const }

/** Built-in preset codes mirrored server-side so an "assign" of a preset
 *  needs no Firestore doc — keep in sync with src/shared/types/schemePack.ts. */
export const PRESET_SCHEME_CODES = [
  'BCU_SEP_2024',
  'KUD_NEP_CBAE',
  'GENERIC_NEP_2020',
  'VTU_2022_BE_BTECH',
  'VTU_BE_2022_5050',
  'AUTONOMOUS_ENGINEERING_5050',
]
// VTU_2022_BE_BTECH is the client preset id (src/shared/types/schemePack.ts);
// VTU_BE_2022_5050 is kept for rows seeded under the older id.
export const ENGINEERING_PRESET_CODES = ['VTU_2022_BE_BTECH', 'VTU_BE_2022_5050', 'AUTONOMOUS_ENGINEERING_5050'] as const

export interface SchemePackResolveContext {
  programId?: string | null
  branchId?: string | null
  admissionBatch?: string | null
}

export interface StoredSchemePackAssignment extends SchemePackResolveContext {
  id?: string
  schemePackId: string
  programId: string
  updatedAt?: unknown
}

export interface ResolvedSchemePack extends Partial<SchemePackDoc> {
  id: string
  code: string
  collegeId?: string | null
  resolution: 'cohort' | 'programme' | 'college' | 'platform'
}

function scopeValue(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

function updatedTimestamp(value: unknown): number {
  if (value instanceof Date) return value.getTime()
  if (value && typeof value === 'object') {
    const timestamp = value as { toMillis?: () => number; toDate?: () => Date }
    if (typeof timestamp.toMillis === 'function') return timestamp.toMillis()
    if (typeof timestamp.toDate === 'function') return timestamp.toDate().getTime()
  }
  const parsed = new Date(String(value ?? '')).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

/** Pure selector shared by Firestore resolution and its unit tests. */
export function selectSchemePackAssignment(
  assignments: readonly StoredSchemePackAssignment[] | null | undefined,
  context: SchemePackResolveContext,
): StoredSchemePackAssignment | null {
  const program = scopeValue(context.programId)
  if (!program || !Array.isArray(assignments)) return null
  const candidates = assignments.filter((assignment) => scopeValue(assignment.programId) === program)
  const branch = scopeValue(context.branchId)
  const batch = scopeValue(context.admissionBatch)
  const cohort = branch && batch
    ? candidates.filter((assignment) => scopeValue(assignment.branchId) === branch && scopeValue(assignment.admissionBatch) === batch)
    : []
  const programme = candidates.filter((assignment) => !scopeValue(assignment.branchId) && !scopeValue(assignment.admissionBatch))
  const matches = cohort.length ? cohort : programme
  return [...matches].sort((left, right) => updatedTimestamp(right.updatedAt) - updatedTimestamp(left.updatedAt))[0] ?? null
}

function customPackDocId(collegeId: string, code: string): string {
  return `${collegeId}__${code}`
}

// Engineering product: an unassigned college resolves to the VTU 2022 preset
// (bundled client-side, so it needs no Firestore row).
const PLATFORM_DEFAULT_PACK: ResolvedSchemePack = {
  id: 'VTU_2022_BE_BTECH',
  code: 'VTU_2022_BE_BTECH',
  resolution: 'platform',
}

/** Resolve cohort override → programme override → college default → platform BCU. */
export async function resolveSchemePackForCollege(
  collegeId: string,
  context: SchemePackResolveContext = {},
): Promise<ResolvedSchemePack> {
  const db = getFirestore(admin.app(), 'default')
  const collegeSnap = await db.collection('colleges').doc(collegeId).get()
  const college = (collegeSnap.data() || {}) as Record<string, unknown>
  const assignments = Array.isArray(college.schemePackAssignments)
    ? college.schemePackAssignments as StoredSchemePackAssignment[]
    : []
  const scoped = selectSchemePackAssignment(assignments, context)
  const collegeDefaultId = String(college.schemePackId ?? '').trim()
  const packId = String(scoped?.schemePackId ?? (collegeDefaultId || PLATFORM_DEFAULT_PACK.id)).trim()
  const resolution: ResolvedSchemePack['resolution'] = scoped
    ? (scopeValue(scoped.branchId) && scopeValue(scoped.admissionBatch) ? 'cohort' : 'programme')
    : collegeDefaultId ? 'college' : 'platform'

  const packSnap = await db.collection('schemePacks').doc(packId).get()
  if (!packSnap.exists) {
    // The non-engineering presets remain bundled in the shared client and do
    // not need duplicate Firestore rows. Preserve their selected identity for
    // assessment snapshots; engineering presets require their seeded globals.
    if (PRESET_SCHEME_CODES.includes(packId) && !ENGINEERING_PRESET_CODES.includes(packId as typeof ENGINEERING_PRESET_CODES[number])) {
      return { ...PLATFORM_DEFAULT_PACK, id: packId, code: packId, resolution }
    }
    // A missing custom pack or unseeded engineering preset fails closed to BCU.
    return { ...PLATFORM_DEFAULT_PACK, resolution: 'platform' }
  }
  const data = (packSnap.data() || {}) as Record<string, unknown>
  const owner = String(data.collegeId ?? '').trim()
  const isGlobal = data.global === true || data.scope === 'platform' || !owner
  if (owner && owner !== collegeId && !isGlobal) {
    return { ...PLATFORM_DEFAULT_PACK, resolution: 'platform' }
  }
  return {
    ...(data as Partial<SchemePackDoc>),
    id: packId,
    code: String(data.code || packId),
    collegeId: owner || null,
    resolution,
  }
}

/**
 * saveSchemePack { pack, collegeId? }
 * Upserts a custom pack under the caller's college. The doc id is
 * `${collegeId}__${CODE}` so a college can never overwrite another tenant's
 * pack (or a global preset).
 */
export const saveSchemePack = onCall(REGION, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Authentication is required')
  const staff = await resolveSchedulingStaff(uid, request.auth?.token || {})

  const raw = (request.data || {}) as Record<string, unknown>
  const isGlobal = staff.role === 'superadmin' && raw.global === true
  const collegeId = isGlobal ? '' : staff.role === 'superadmin' ? String(raw.collegeId ?? '').trim() : staff.collegeId
  if (!isGlobal && !collegeId) throw new HttpsError('invalid-argument', 'No college is associated with this account')
  const submittedCode = String((raw.pack as Record<string, unknown> | undefined)?.code ?? '').toUpperCase()
  if (PRESET_SCHEME_CODES.includes(submittedCode) && !(isGlobal && ENGINEERING_PRESET_CODES.includes(submittedCode as typeof ENGINEERING_PRESET_CODES[number]))) {
    throw new HttpsError('invalid-argument', 'Preset codes are reserved — pick a custom code')
  }
  if (isGlobal && !ENGINEERING_PRESET_CODES.includes(submittedCode as typeof ENGINEERING_PRESET_CODES[number])) {
    throw new HttpsError('invalid-argument', 'Only the engineering presets may be saved as global packs')
  }

  const pack = validateSchemePackDoc(raw.pack)
  const db = getFirestore(admin.app(), 'default')
  const docId = isGlobal ? pack.code : customPackDocId(collegeId, pack.code)
  const ref = db.collection('schemePacks').doc(docId)
  const existing = await ref.get()
  if (existing.exists) {
    const existingData = existing.data() || {}
    if (isGlobal ? existingData.global !== true : existingData.global === true || String(existingData.collegeId ?? '') !== collegeId) {
      throw new HttpsError('permission-denied', 'This scheme pack belongs to another scope')
    }
  }

  const now = admin.firestore.FieldValue.serverTimestamp()
  await ref.set(
    {
      ...pack,
      id: docId,
      ...(isGlobal ? { collegeId: null, global: true, scope: 'platform' } : { collegeId }),
      updatedAt: now,
      updatedBy: staff.name || uid,
      ...(existing.exists ? {} : { createdAt: now, createdBy: staff.name || uid }),
    },
    { merge: true },
  )
  return { id: docId, code: pack.code, name: pack.name, updated: existing.exists, global: isGlobal }
})

interface NormalizedAssignmentScope {
  programId: string
  branchId: string
  admissionBatch: string
}

export function normalizeSchemePackAssignmentScope(value: unknown): NormalizedAssignmentScope | null {
  if (value == null) return null
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpsError('invalid-argument', 'scope must be an object')
  }
  const raw = value as Record<string, unknown>
  const programId = boundedString(raw.programId, 'scope.programId', 80, false).replace(/\s+/g, ' ')
  const branchId = boundedString(raw.branchId, 'scope.branchId', 100, false).replace(/\s+/g, ' ')
  const admissionBatch = boundedString(raw.admissionBatch, 'scope.admissionBatch', 60, false).replace(/\s+/g, ' ')
  if (!programId && !branchId && !admissionBatch) return null
  if (!programId) throw new HttpsError('invalid-argument', 'scope.programId is required')
  if (Boolean(branchId) !== Boolean(admissionBatch)) {
    throw new HttpsError('invalid-argument', 'Specify both branch and admission batch, or leave both blank for a programme-wide assignment')
  }
  return { programId, branchId, admissionBatch }
}

function sameAssignmentScope(left: SchemePackResolveContext, right: SchemePackResolveContext): boolean {
  return scopeValue(left.programId) === scopeValue(right.programId)
    && scopeValue(left.branchId) === scopeValue(right.branchId)
    && scopeValue(left.admissionBatch) === scopeValue(right.admissionBatch)
}

/**
 * assignCollegeSchemePack { schemePackId, collegeId?, scope? }
 * Binds a college default or scoped pack assignment. A scoped empty pack id
 * removes only that override; an unscoped empty id clears the college default.
 */
export const assignCollegeSchemePack = onCall(REGION, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Authentication is required')
  const staff = await resolveSchedulingStaff(uid, request.auth?.token || {})

  const raw = (request.data || {}) as Record<string, unknown>
  const collegeId = staff.role === 'superadmin' ? String(raw.collegeId ?? '').trim() : staff.collegeId
  if (!collegeId) throw new HttpsError('invalid-argument', 'No college is associated with this account')
  const schemePackId = String(raw.schemePackId ?? '').trim()
  const scope = normalizeSchemePackAssignmentScope(raw.scope)
  const db = getFirestore(admin.app(), 'default')

  let resolvedName = 'default (BCU)'
  if (schemePackId) {
    if (PRESET_SCHEME_CODES.includes(schemePackId)) {
      if (ENGINEERING_PRESET_CODES.includes(schemePackId as typeof ENGINEERING_PRESET_CODES[number])) {
        const globalPack = await db.collection('schemePacks').doc(schemePackId).get()
        const data = globalPack.data() || {}
        if (!globalPack.exists || data.global !== true || data.scope !== 'platform') {
          throw new HttpsError('not-found', 'Engineering preset has not been seeded as a global scheme pack yet')
        }
      }
      resolvedName = `preset ${schemePackId}`
    } else {
      const snap = await db.collection('schemePacks').doc(schemePackId).get()
      if (!snap.exists) throw new HttpsError('not-found', 'Scheme pack not found')
      if (String(snap.data()?.collegeId ?? '') !== collegeId || snap.data()?.global === true) {
        throw new HttpsError('permission-denied', 'This scheme pack belongs to another college')
      }
      resolvedName = String(snap.data()?.name || schemePackId)
    }
  }

  const collegeRef = db.collection('colleges').doc(collegeId)
  const now = admin.firestore.FieldValue.serverTimestamp()
  if (!scope) {
    await collegeRef.set({ schemePackId: schemePackId || null, updatedAt: now }, { merge: true })
  } else {
    const collegeSnap = await collegeRef.get()
    const college = (collegeSnap.data() || {}) as Record<string, unknown>
    const current = Array.isArray(college.schemePackAssignments)
      ? college.schemePackAssignments as StoredSchemePackAssignment[]
      : []
    const next = current.filter((assignment) => !sameAssignmentScope(assignment, scope))
    if (schemePackId) {
      if (next.length >= 100) throw new HttpsError('resource-exhausted', 'A college may have at most 100 scoped scheme-pack assignments')
      next.push({ ...scope, schemePackId, updatedAt: now })
    }
    await collegeRef.set({ schemePackAssignments: next, updatedAt: now }, { merge: true })
  }
  return { collegeId, schemePackId: schemePackId || null, scope, resolvedName }
})
