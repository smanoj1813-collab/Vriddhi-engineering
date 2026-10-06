// src/modules/admin/api/testTemplateApi.ts
// Create Test — client-direct Firestore API. No callables, no new Cloud Run
// service, no new collection, NO COMPOSITE INDEX (every query is equality-only
// and sorted in memory — see docs/ASSESSMENT_CREATE_TEST_FLOW.md §1).
//
//   college tests  → papers/{id}         + docKind: 'test_template'
//   platform tests → paperTemplates/{id} + scope: 'platform'   (all colleges)
//
// papers/{id} rules force `status: 'draft'` and `verificationStatus: 'draft'`
// at create and forbid changing them on update, so the authoring lifecycle
// lives in our own `testStatus` field. Scheduling stays the existing callable.

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore'
import { db } from '@/Firebase/config'
import {
  TEST_TEMPLATE_DOC_KIND,
  defaultDeliverySettings,
  type TestSection,
  type TestTemplate,
} from '@/shared/types/testTemplate'
import { duplicateTemplate, lifecycleFor, normalizeTestCode } from '@/shared/utils/testTemplate'

const PAPERS = 'papers'
const PLATFORM_TEMPLATES = 'paperTemplates'
const LIST_LIMIT = 200

export interface TestAuthor {
  uid: string
  name: string
  collegeId: string
}

function isoFrom(value: unknown): string | undefined {
  if (!value) return undefined
  if (typeof value === 'string') return value
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object' && 'toDate' in (value as object)) {
    try {
      return (value as { toDate: () => Date }).toDate().toISOString()
    } catch {
      return undefined
    }
  }
  return undefined
}

/** Firestore row → TestTemplate, tolerant of partially written legacy docs. */
export function toTestTemplate(id: string, data: Record<string, unknown>, scope: 'college' | 'platform'): TestTemplate {
  const sections = Array.isArray(data.sections) ? (data.sections as TestSection[]) : []
  return {
    id,
    title: String(data.title ?? 'Untitled test'),
    testCode: String(data.testCode ?? ''),
    kind: (data.kind as TestTemplate['kind']) ?? 'internal',
    ...(data.subject ? { subject: String(data.subject) } : {}),
    ...(data.program ? { program: String(data.program) } : {}),
    ...(data.branch ? { branch: String(data.branch) } : {}),
    ...(typeof data.semester === 'number' ? { semester: data.semester } : {}),
    description: String(data.description ?? ''),
    instructions: String(data.instructions ?? ''),
    cohorts: Array.isArray(data.cohorts) ? (data.cohorts as TestTemplate['cohorts']) : [],
    delivery: { ...defaultDeliverySettings(), ...(data.delivery as object ?? {}) },
    sections: sections.map((section, index) => ({
      ...section,
      order: section.order ?? index + 1,
      questions: Array.isArray(section.questions) ? section.questions : [],
    })),
    testStatus: (data.testStatus as TestTemplate['testStatus']) ?? 'draft',
    scope,
    collegeId: String(data.collegeId ?? ''),
    createdBy: String(data.createdBy ?? ''),
    createdByName: String(data.createdByName ?? ''),
    ...(isoFrom(data.createdAt) ? { createdAt: isoFrom(data.createdAt) } : {}),
    ...(isoFrom(data.updatedAt) ? { updatedAt: isoFrom(data.updatedAt) } : {}),
    ...(data.source ? { source: data.source as TestTemplate['source'] } : {}),
    ...(data.templateNotes ? { templateNotes: String(data.templateNotes) } : {}),
  }
}

function sortByUpdated(a: TestTemplate, b: TestTemplate): number {
  return (b.updatedAt ?? b.createdAt ?? '').localeCompare(a.updatedAt ?? a.createdAt ?? '')
}

// ─── College tests ───────────────────────────────────────────────────────────

/** Every Create Test template of this college (equality-only query). */
export async function listCollegeTests(collegeId: string): Promise<TestTemplate[]> {
  if (!collegeId) return []
  const snap = await getDocs(query(
    collection(db, PAPERS),
    where('collegeId', '==', collegeId),
    where('docKind', '==', TEST_TEMPLATE_DOC_KIND),
    limit(LIST_LIMIT),
  ))
  return snap.docs
    .map((d) => toTestTemplate(d.id, d.data() as Record<string, unknown>, 'college'))
    .filter((t) => t.testStatus !== 'archived')
    .sort(sortByUpdated)
}

export async function getCollegeTest(id: string): Promise<TestTemplate | null> {
  const snap = await getDoc(doc(db, PAPERS, id))
  if (!snap.exists()) return null
  return toTestTemplate(snap.id, snap.data() as Record<string, unknown>, 'college')
}

/** Fields the rules demand on papers/{id}, plus the Create Test payload. */
function toPaperDoc(template: Omit<TestTemplate, 'id' | 'scope'>, author: TestAuthor) {
  const sections = template.sections ?? []
  const totals = sections.reduce(
    (acc, s) => ({
      questions: acc.questions + (s.questions?.length ?? 0),
      marks: acc.marks + (s.questions ?? []).reduce((sum, q) => sum + (Number(q.marks) || 0), 0),
      minutes: acc.minutes + (Number(s.durationMinutes) || 0),
    }),
    { questions: 0, marks: 0, minutes: 0 },
  )
  return {
    docKind: TEST_TEMPLATE_DOC_KIND,
    title: template.title.trim(),
    testCode: normalizeTestCode(template.testCode),
    kind: template.kind,
    subject: template.subject ?? '',
    program: template.program ?? '',
    branch: template.branch ?? '',
    ...(typeof template.semester === 'number' ? { semester: template.semester } : {}),
    description: template.description ?? '',
    instructions: template.instructions ?? '',
    cohorts: template.cohorts ?? [],
    delivery: template.delivery,
    sections,
    // Mirrors kept so the existing paper/scheduler surfaces can read a test
    // without knowing about the Create Test flow.
    totalQuestions: totals.questions,
    totalMarks: totals.marks,
    duration: totals.minutes,
    durationMinutes: totals.minutes,
    testStatus: lifecycleFor({ title: template.title, testCode: template.testCode, sections }),
    ...(template.source ? { source: template.source } : {}),
    collegeId: author.collegeId,
    createdBy: author.uid,
    createdByName: author.name,
  }
}

/**
 * Create a college test. `status`/`verificationStatus` are pinned to 'draft'
 * because the Firestore rules require exactly that on create (and refuse any
 * later change) — our lifecycle is `testStatus`.
 */
export async function createCollegeTest(
  template: Omit<TestTemplate, 'id' | 'scope'>,
  author: TestAuthor,
): Promise<string> {
  const ref = await addDoc(collection(db, PAPERS), {
    ...toPaperDoc(template, author),
    status: 'draft',
    verificationStatus: 'draft',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return ref.id
}

/** Update an existing test. Never touches the rules-protected fields. */
export async function updateCollegeTest(
  id: string,
  template: Omit<TestTemplate, 'id' | 'scope'>,
  author: TestAuthor,
): Promise<void> {
  const payload = toPaperDoc(template, author) as Record<string, unknown>
  delete payload.collegeId
  delete payload.createdBy
  delete payload.createdByName
  await updateDoc(doc(db, PAPERS, id), { ...payload, updatedAt: serverTimestamp() })
}

/** Soft delete: archived tests drop out of every list but stay recoverable. */
export async function archiveCollegeTest(id: string): Promise<void> {
  await updateDoc(doc(db, PAPERS, id), { testStatus: 'archived', updatedAt: serverTimestamp() })
}

/** Hard delete — rules allow it for admin/superadmin while status is draft. */
export async function deleteCollegeTest(id: string): Promise<void> {
  await deleteDoc(doc(db, PAPERS, id))
}

/** Clone any test (own or platform) into a new college draft. 1 read + 1 write. */
export async function duplicateIntoCollege(
  source: TestTemplate,
  author: TestAuthor,
  overrides: { title?: string; testCode?: string } = {},
): Promise<string> {
  const copy = duplicateTemplate(source, {
    ...overrides,
    collegeId: author.collegeId,
    createdBy: author.uid,
    createdByName: author.name,
  })
  return createCollegeTest(copy, author)
}

// ─── Platform templates (visible to every college) ───────────────────────────

/**
 * The Vriddhi assessment team's shared library: one equality query, readable
 * by any signed-in staff member of any college (rules: `paperTemplates`).
 */
export async function listPlatformTemplates(): Promise<TestTemplate[]> {
  const snap = await getDocs(query(
    collection(db, PLATFORM_TEMPLATES),
    where('scope', '==', 'platform'),
    limit(LIST_LIMIT),
  ))
  return snap.docs
    .map((d) => toTestTemplate(d.id, d.data() as Record<string, unknown>, 'platform'))
    .filter((t) => t.testStatus !== 'archived')
    .sort(sortByUpdated)
}

/** Look a template up by the test ID the assessment team shares. */
export async function findPlatformTemplateByCode(code: string): Promise<TestTemplate | null> {
  const normalized = normalizeTestCode(code)
  if (!normalized) return null
  const snap = await getDocs(query(
    collection(db, PLATFORM_TEMPLATES),
    where('scope', '==', 'platform'),
    where('testCode', '==', normalized),
    limit(1),
  ))
  const first = snap.docs[0]
  return first ? toTestTemplate(first.id, first.data() as Record<string, unknown>, 'platform') : null
}

/**
 * Publish a college test to the platform library (Vriddhi assessment team /
 * superadmin action — the UI gates on role).
 *
 * NOTE: `paperTemplates` rules currently allow any college staff to write.
 * Tightening them to superadmin+employee needs a rules deploy (Java/emulator
 * on the Windows side) — tracked in docs/ASSESSMENT_CREATE_TEST_FLOW.md §9.
 */
export async function publishPlatformTemplate(
  template: TestTemplate,
  author: TestAuthor,
  notes = '',
): Promise<string> {
  const ref = await addDoc(collection(db, PLATFORM_TEMPLATES), {
    ...toPaperDoc({ ...template, source: undefined }, { ...author, collegeId: 'platform' }),
    scope: 'platform',
    visibility: 'all_colleges',
    templateNotes: notes,
    status: 'draft',
    verificationStatus: 'draft',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return ref.id
}

export async function archivePlatformTemplate(id: string): Promise<void> {
  await updateDoc(doc(db, PLATFORM_TEMPLATES, id), { testStatus: 'archived', updatedAt: serverTimestamp() })
}
