// functions/src/collegeModules.ts
// ─── College-level optional module toggles ───────────────────────────────────
//
// Not every technical college uses every Vriddhi module. Modules that a
// college can opt out of are switched off per college — the code stays, the
// UI hides, and the callables refuse politely.
//
// This follows the SAME storage pattern as the other college-level feature
// switches (Resume Builder add-on, Coding Lab assignment):
//
//   colleges/{collegeId}/config/modules
//     {
//       assignments: { enabled: boolean },
//       updatedAt: Timestamp,
//       updatedBy: string,
//     }
//
// Defaults: optional modules are ON until a college says otherwise. These are
// core product areas that existing colleges already use — a missing config
// document must never silently switch a live module off. Enforcement is
// server-side in the callables themselves (failed-precondition); the UI hiding
// is a courtesy, not the security boundary.
//
// Read/write paths:
//   • Students and staff read the doc directly from Firestore (same fail-closed
//     read as config/codingLab) so navigation can hide without a Function call.
//   • Staff UIs may also read GET /api/config/modules and write
//     PUT /api/config/modules (mounted on the shared `api` function — no extra
//     Cloud Run service, which matters under the current CPU quota).

import { getFirestore } from 'firebase-admin/firestore'
import { getApps, initializeApp } from 'firebase-admin/app'
if (!getApps().length) initializeApp()
import admin from 'firebase-admin'
import { HttpsError } from 'firebase-functions/v2/https'

export type CollegeModuleId = 'assignments'

/** Registry of modules that colleges may toggle. Extend here, nowhere else. */
export const COLLEGE_MODULE_IDS: readonly CollegeModuleId[] = ['assignments']

export const MODULE_LABELS: Record<CollegeModuleId, string> = {
  assignments: 'Assignments',
}

export interface ModuleToggle {
  enabled: boolean
}

export type CollegeModuleSettings = Record<CollegeModuleId, ModuleToggle>

/** Optional modules default to ON: toggles exist so colleges can opt OUT. */
export function defaultCollegeModuleSettings(): CollegeModuleSettings {
  return COLLEGE_MODULE_IDS.reduce((settings, id) => {
    settings[id] = { enabled: true }
    return settings
  }, {} as CollegeModuleSettings)
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/**
 * Accepts whatever is in Firestore (or a PUT body) and returns a complete
 * settings object. Unknown keys are ignored; an explicit `enabled: false`
 * is the ONLY thing that switches a module off.
 */
export function normaliseCollegeModuleSettings(
  raw: unknown,
  base: CollegeModuleSettings = defaultCollegeModuleSettings()
): CollegeModuleSettings {
  const record = asRecord(raw)
  return COLLEGE_MODULE_IDS.reduce((settings, id) => {
    const toggle = asRecord(record[id])
    settings[id] = {
      enabled: typeof toggle.enabled === 'boolean' ? toggle.enabled : base[id].enabled,
    }
    return settings
  }, {} as CollegeModuleSettings)
}

export function isCollegeModuleEnabled(
  settings: CollegeModuleSettings | null | undefined,
  id: CollegeModuleId
): boolean {
  if (!settings) return true
  const toggle = settings[id]
  return toggle ? toggle.enabled !== false : true
}

export const MODULES_CONFIG_DOC = 'modules'

/**
 * Reads the college's module settings. A missing document (the common case
 * until a college customises) yields the defaults — every module ON.
 */
export async function readCollegeModuleSettings(
  collegeId: string
): Promise<CollegeModuleSettings> {
  const trimmed = String(collegeId || '').trim()
  if (!trimmed) return defaultCollegeModuleSettings()
  const doc = await getFirestore(admin.app(), 'default')
    .collection('colleges')
    .doc(trimmed)
    .collection('config')
    .doc(MODULES_CONFIG_DOC)
    .get()
  return normaliseCollegeModuleSettings(doc.exists ? doc.data() : undefined)
}

/**
 * Gate for assignment callables. Throws failed-precondition with a message
 * that is safe to show to end users. Missing config = module stays on.
 */
export async function assertAssignmentsEnabled(collegeId: string): Promise<void> {
  const settings = await readCollegeModuleSettings(collegeId)
  if (!isCollegeModuleEnabled(settings, 'assignments')) {
    throw new HttpsError(
      'failed-precondition',
      'Assignments is switched off for this college. Ask your college administrator to enable it in Settings → Modules.'
    )
  }
}
