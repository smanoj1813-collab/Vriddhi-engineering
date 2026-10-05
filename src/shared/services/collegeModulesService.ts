// src/shared/services/collegeModulesService.ts
//
// College-level optional module toggles (see functions/src/collegeModules.ts).
//
// Storage: colleges/{collegeId}/config/modules — the same pattern as the
// Coding Lab assignment flag and the Resume Builder add-on. Students and staff
// read the doc straight from Firestore so navigation can hide a module the
// college switched off without spending a Function call; writes go through the
// shared `api` function (PUT /api/config/modules), which is where role checks
// and normalisation live.
//
// Reads FAIL OPEN: a missing doc, a rules denial or a network error yields the
// defaults (every module ON). Assignments is a core product area — a transient
// error must not hide it. The server-side callables remain the authoritative
// boundary and refuse with a clear message when the module really is off.

import { doc, getDoc } from 'firebase/firestore'
import { db } from '@/Firebase/config'
import { apiUrl } from '@/shared/api/apiBase'

export type CollegeModuleId = 'assignments'

export const COLLEGE_MODULE_IDS: readonly CollegeModuleId[] = ['assignments']

export const COLLEGE_MODULE_LABELS: Record<CollegeModuleId, string> = {
  assignments: 'Assignments',
}

export const COLLEGE_MODULE_HINTS: Record<CollegeModuleId, string> = {
  assignments:
    'Faculty-created assignments, student submissions, grading and assignment analytics.',
}

export interface ModuleToggle {
  enabled: boolean
}

export type CollegeModuleSettings = Record<CollegeModuleId, ModuleToggle>

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

/** Mirror of the server normaliser: explicit `enabled: false` is the only off switch. */
export function normaliseCollegeModuleSettings(raw: unknown): CollegeModuleSettings {
  const record = asRecord(raw)
  const base = defaultCollegeModuleSettings()
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
  return settings[id]?.enabled !== false
}

/** Fail-open read for navigation gating. Empty collegeId → defaults. */
export async function fetchCollegeModuleSettings(
  collegeId: string | null | undefined
): Promise<CollegeModuleSettings> {
  const id = (collegeId || '').trim()
  if (!id) return defaultCollegeModuleSettings()
  try {
    const snapshot = await getDoc(doc(db, 'colleges', id, 'config', 'modules'))
    return normaliseCollegeModuleSettings(snapshot.exists() ? snapshot.data() : undefined)
  } catch {
    return defaultCollegeModuleSettings()
  }
}

export interface FetchCollegeModulesResponse {
  success: boolean
  collegeId: string
  configured: boolean
  modules: CollegeModuleSettings
}

/**
 * GET /api/config/modules — staff Settings panel read. The server resolves the
 * caller's college from the verified token; a superadmin may pass collegeId.
 * Falls back to defaults (fail-open) when the request itself fails.
 */
export async function fetchCollegeModuleSettingsApi(
  collegeId?: string
): Promise<FetchCollegeModulesResponse> {
  const token = await getBearerToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const qs = collegeId ? `?collegeId=${encodeURIComponent(collegeId)}` : ''
  const response = await fetch(apiUrl(`/config/modules${qs}`), { method: 'GET', headers })
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(
      (data && typeof data === 'object' && String((data as Record<string, unknown>).error || '')) ||
        `Could not load the module settings (HTTP ${response.status})`
    )
  }
  const payload = (data || {}) as Partial<FetchCollegeModulesResponse>
  return {
    success: true,
    collegeId: String(payload.collegeId || collegeId || ''),
    configured: Boolean(payload.configured),
    modules: normaliseCollegeModuleSettings(payload.modules),
  }
}

async function getBearerToken(): Promise<string | null> {
  const stored =
    localStorage.getItem('token') ||
    sessionStorage.getItem('token') ||
    localStorage.getItem('vriddhi_auth_token')
  if (stored) return stored
  try {
    const { auth } = await import('@/Firebase/config')
    if (auth.currentUser) return await auth.currentUser.getIdToken()
  } catch {
    /* fall through */
  }
  return null
}

export interface SaveCollegeModulesResponse {
  success: boolean
  collegeId: string
  modules: CollegeModuleSettings
}

/** PUT /api/config/modules — college admins / principal / HOD / superadmin. */
export async function saveCollegeModuleSettings(
  modules: CollegeModuleSettings,
  collegeId?: string
): Promise<SaveCollegeModulesResponse> {
  const token = await getBearerToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  if (collegeId) headers['X-College-Id'] = collegeId
  const response = await fetch(apiUrl('/config/modules'), {
    method: 'PUT',
    headers,
    body: JSON.stringify({ modules, ...(collegeId ? { collegeId } : {}) }),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(
      (data && typeof data === 'object' && String((data as Record<string, unknown>).error || '')) ||
        `Could not save the module settings (HTTP ${response.status})`
    )
  }
  return data as SaveCollegeModulesResponse
}
