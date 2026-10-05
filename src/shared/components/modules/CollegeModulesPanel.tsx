// src/shared/components/modules/CollegeModulesPanel.tsx
//
// "Optional modules" control panel — colleges that don't use a module switch
// it off here; the code stays, the UI hides, and the callables refuse.
//
//   • College admin / principal / HOD → Settings: edits their own college.
//   • Superadmin → Colleges → {college} → Overview: pass collegeId explicitly.
//
// Reads go straight to colleges/{collegeId}/config/modules (rules allow staff
// and the college's own students); writes go through PUT /api/config/modules
// on the shared `api` function, which validates roles and normalises values.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Puzzle, Save, ShieldCheck } from 'lucide-react'
import {
  COLLEGE_MODULE_HINTS,
  COLLEGE_MODULE_IDS,
  COLLEGE_MODULE_LABELS,
  fetchCollegeModuleSettingsApi,
  saveCollegeModuleSettings,
  type CollegeModuleSettings,
} from '@/shared/services/collegeModulesService'

function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ' +
        (checked ? 'bg-teal-500' : 'bg-slate-300 dark:bg-slate-600')
      }
    >
      <span className={'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ' + (checked ? 'translate-x-5' : 'translate-x-0.5')} />
    </button>
  )
}

export interface CollegeModulesPanelProps {
  /** Omit for "my college" (college admin). Superadmin must pass one. */
  collegeId?: string
  collegeName?: string
  /** Hide the switches (read-only view). */
  canEdit?: boolean
  /** Compact variant for embedding inside another card. */
  embedded?: boolean
}

export default function CollegeModulesPanel({ collegeId, collegeName, canEdit = true, embedded = false }: CollegeModulesPanelProps) {
  const [settings, setSettings] = useState<CollegeModuleSettings | null>(null)
  const [draft, setDraft] = useState<CollegeModuleSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // Server resolves "my college" from the token; superadmin passes one.
      const res = await fetchCollegeModuleSettingsApi(collegeId)
      setSettings(res.modules)
      setDraft(res.modules)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the module settings.')
    } finally {
      setLoading(false)
    }
  }, [collegeId])

  useEffect(() => {
    void load()
  }, [load])

  const dirty = useMemo(
    () => !!settings && !!draft && JSON.stringify(settings) !== JSON.stringify(draft),
    [settings, draft]
  )

  const save = async () => {
    if (!draft || !canEdit) return
    setSaving(true)
    setNotice(null)
    setError(null)
    try {
      const res = await saveCollegeModuleSettings(draft, collegeId)
      setSettings(res.modules)
      setDraft(res.modules)
      const off = COLLEGE_MODULE_IDS.filter((id) => !res.modules[id].enabled)
      setNotice(
        off.length
          ? `Saved — switched off: ${off.map((id) => COLLEGE_MODULE_LABELS[id]).join(', ')}.`
          : 'Saved — all optional modules are on.'
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.')
    } finally {
      setSaving(false)
    }
  }

  const shell = embedded
    ? 'space-y-4'
    : 'space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-[#131b2e]'

  return (
    <section className={shell} data-testid="college-modules-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-white">
            <Puzzle className="h-4 w-4 text-teal-500" />
            Optional modules
            {collegeName ? <span className="font-medium text-slate-400">· {collegeName}</span> : null}
          </h3>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            Not every college uses every module. Switching a module off hides it from students and staff
            of this college and blocks its workflows; nothing is deleted, and it can be turned back on at any time.
          </p>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={save}
            disabled={!dirty || saving || loading}
            className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading module settings…
        </div>
      ) : !draft ? (
        <p className="text-sm text-slate-400">No settings loaded.</p>
      ) : (
        <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
          {COLLEGE_MODULE_IDS.map((id) => (
            <li key={id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{COLLEGE_MODULE_LABELS[id]}</p>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{COLLEGE_MODULE_HINTS[id]}</p>
              </div>
              <Switch
                checked={draft[id].enabled}
                disabled={!canEdit || saving}
                label={`Toggle ${COLLEGE_MODULE_LABELS[id]}`}
                onChange={(enabled) => setDraft({ ...draft, [id]: { enabled } })}
              />
            </li>
          ))}
        </ul>
      )}

      {error && <p className="text-xs font-semibold text-rose-500">{error}</p>}
      {notice && (
        <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
          <ShieldCheck className="h-3.5 w-3.5" /> {notice}
        </p>
      )}
    </section>
  )
}
