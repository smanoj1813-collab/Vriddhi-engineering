// /admin/timetable-approvals — ops drafts a branch timetable, the branch HOD
// approves it, and the principal can approve as a fallback with a reason.
// Only approved timetables reach students and faculty.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, CheckCircle2, Copy, Pencil, Plus, Send, Trash2, Undo2 } from 'lucide-react'
import { useAuth } from '@/modules/auth/context/AuthContext'
import { Badge, Empty, Loading, PageHeader, btn, errMsg } from '../../office/components/officeUi'
import { fetchBranchesFromStudents, fetchFacultyList } from '../api/scheduleApi'
import {
  callCopyLiveToDraft,
  callMarkLegacyTimetablesApproved,
  callReviewTimetable,
  callSaveTimetableDraft,
  callSubmitTimetable,
  branchKeyOf,
  listApprovals,
  listDrafts,
  type ApprovalRow,
  type DraftSlot,
  type SlotInput,
} from '../api/timetableApprovalApi'
import { timetableApprovalId, type TimetableApprovalStatus } from '../utils/timetableApproval'

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const TYPES = ['lecture', 'lab', 'tutorial', 'seminar', 'workshop']
const SEMESTERS = [1, 2, 3, 4, 5, 6, 7, 8]

const STATUS_TONE: Record<TimetableApprovalStatus, 'slate' | 'amber' | 'red' | 'green' | 'blue'> = {
  draft: 'slate',
  submitted: 'amber',
  returned: 'red',
  approved: 'green',
}
const STATUS_LABEL: Record<TimetableApprovalStatus, string> = {
  draft: 'Draft',
  submitted: 'Waiting for HOD',
  returned: 'Returned',
  approved: 'Approved (live)',
}

const blankSlot = (): SlotInput => ({
  dayOfWeek: 'monday', startTime: '09:00', endTime: '10:00', subject: '', subjectCode: '',
  facultyId: '', facultyName: '', room: '', batch: '', division: '', type: 'lecture',
})

export default function TimetableApprovals() {
  const { user } = useAuth()
  const role = user?.role ?? ''
  const collegeId = user?.collegeId || localStorage.getItem('vriddhi_college_id') || ''
  const isOps = role === 'operations' || role === 'superadmin'
  const isHod = role === 'hod'
  const isPrincipal = role === 'principal'
  const hodDepartment = isHod ? (user?.department ?? '') : ''

  const [rows, setRows] = useState<ApprovalRow[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [selected, setSelected] = useState<ApprovalRow | null>(null)
  const [drafts, setDrafts] = useState<DraftSlot[]>([])
  const [editing, setEditing] = useState<SlotInput[] | null>(null)
  const [branches, setBranches] = useState<string[]>([])
  const [faculty, setFaculty] = useState<{ id: string; name: string }[]>([])
  const [newBranch, setNewBranch] = useState('')
  const [newSemester, setNewSemester] = useState(1)
  const [note, setNote] = useState('')
  const [fallback, setFallback] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null)
  const [legacyResult, setLegacyResult] = useState('')

  const refresh = useCallback(async () => {
    if (!collegeId) return
    try {
      setLoadError('')
      setRows(await listApprovals(collegeId, isHod ? hodDepartment : undefined))
    } catch (e) {
      setLoadError(errMsg(e))
    }
  }, [collegeId, isHod, hodDepartment])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    if (!collegeId || !isOps) return
    fetchBranchesFromStudents(collegeId).then(setBranches).catch(() => setBranches([]))
    fetchFacultyList(collegeId).then(list => setFaculty(list.map(f => ({ id: f.id, name: f.name })))).catch(() => setFaculty([]))
  }, [collegeId, isOps])

  const visibleRows = useMemo(() => {
    if (!rows) return []
    // HODs see only their branch (also enforced by the rules); ops and principal see all.
    return rows
  }, [rows])

  const open = async (row: ApprovalRow, forEdit = false) => {
    setSelected(row)
    setEditing(null)
    setNote('')
    setFallback('')
    setMessage(null)
    try {
      const d = await listDrafts(collegeId, row.id, isHod ? hodDepartment : undefined)
      setDrafts(d)
      if (forEdit) setEditing(d.map(toInput))
    } catch (e) {
      setDrafts([])
      setMessage({ tone: 'err', text: errMsg(e) })
    }
  }

  const startNew = () => {
    const branch = newBranch.trim()
    if (!branch) { setMessage({ tone: 'err', text: 'Choose a branch first.' }); return }
    const id = timetableApprovalId(collegeId, branch, newSemester)
    const existing = rows?.find(r => r.id === id)
    if (existing) { void open(existing, true); return }
    setSelected({ id, collegeId, branch, branchKey: branchKeyOf(branch), semester: newSemester, status: 'draft', version: 0 })
    setDrafts([])
    setEditing([blankSlot()])
    setMessage(null)
  }

  const scope = selected ? { collegeId, branch: selected.branch, semester: selected.semester } : null

  const run = async (label: string, fn: () => Promise<string>) => {
    setBusy(true)
    setMessage(null)
    try {
      const text = await fn()
      setMessage({ tone: 'ok', text })
      await refresh()
      if (scope) {
        const updated = (await listApprovals(collegeId, isHod ? hodDepartment : undefined)).find(r => r.id === selected?.id)
        if (updated) setSelected(updated)
      }
    } catch (e) {
      setMessage({ tone: 'err', text: `${label}: ${errMsg(e)}` })
    } finally {
      setBusy(false)
    }
  }

  const saveDraft = () => run('Save draft', async () => {
    if (!scope || !editing) return ''
    const result = await callSaveTimetableDraft({ ...scope, slots: editing })
    setDrafts(await listDrafts(collegeId, selected!.id))
    setEditing(null)
    return `Draft saved with ${result.draftCount} class${result.draftCount === 1 ? '' : 'es'}.`
  })

  const submit = () => run('Submit', async () => {
    if (!scope) return ''
    if (editing) {
      await callSaveTimetableDraft({ ...scope, slots: editing })
      setEditing(null)
    }
    const result = await callSubmitTimetable(scope)
    setDrafts(await listDrafts(collegeId, selected!.id))
    return `Sent to the HOD for ${scope.branch}, semester ${scope.semester} (version ${result.version}).`
  })

  const copyLive = () => run('Copy from live', async () => {
    if (!scope) return ''
    const result = await callCopyLiveToDraft(scope)
    setDrafts(await listDrafts(collegeId, selected!.id))
    setEditing(null)
    return `Copied ${result.draftCount} live class${result.draftCount === 1 ? '' : 'es'} into the draft.`
  })

  const review = (decision: 'approve' | 'return') => run(decision === 'approve' ? 'Approve' : 'Return', async () => {
    if (!scope) return ''
    const result = await callReviewTimetable({
      ...scope,
      decision,
      note: note.trim() || undefined,
      fallbackReason: isPrincipal ? fallback.trim() || undefined : undefined,
    })
    if (decision === 'approve') {
      return `Approved. ${result.liveCount ?? 0} class${result.liveCount === 1 ? '' : 'es'} are now live for students and faculty.`
    }
    return 'Returned to operations with your note.'
  })

  const runLegacy = async () => {
    setBusy(true)
    setLegacyResult('')
    try {
      const r = await callMarkLegacyTimetablesApproved({ collegeId })
      setLegacyResult(`Marked ${r.marked} existing timetable${r.marked === 1 ? '' : 's'} as approved. ${r.skipped} already had a record.`)
      await refresh()
    } catch (e) {
      setLegacyResult(`Cut-over failed: ${errMsg(e)}`)
    } finally {
      setBusy(false)
    }
  }

  if (!collegeId) return <Empty title="No college selected" />
  if (rows === null && !loadError) return <Loading label="Loading timetable approvals…" />

  const canEdit = isOps && selected && (selected.status === 'draft' || selected.status === 'returned' || selected.status === 'approved')
  const canReview = (isHod || isPrincipal) && selected?.status === 'submitted'

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Timetable Approvals"
        subtitle={isOps
          ? 'Prepare each branch timetable by semester, then send it to the HOD.'
          : isHod
            ? `Review and approve timetables for ${user?.department || 'your branch'}.`
            : 'Review timetables. Approve as a fallback only when the HOD is unavailable.'}
        icon={<CalendarDays size={20} />}
      />

      {loadError && <div className="text-sm text-red-600">{loadError}</div>}
      {message && (
        <div className={`text-sm rounded-xl px-4 py-3 ${message.tone === 'ok' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-red-500/10 text-red-600'}`}>
          {message.text}
        </div>
      )}

      {isOps && (
        <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-vriddhi-border bg-vriddhi-card p-4">
          <label className="text-sm">
            <span className="block text-vriddhi-muted mb-1">Branch</span>
            <input
              list="timetable-branches"
              value={newBranch}
              onChange={e => setNewBranch(e.target.value)}
              placeholder="e.g. CSE"
              className="rounded-xl border border-vriddhi-border bg-transparent px-3 py-2 text-sm"
            />
            <datalist id="timetable-branches">
              {branches.map(b => <option key={b} value={b} />)}
            </datalist>
          </label>
          <label className="text-sm">
            <span className="block text-vriddhi-muted mb-1">Semester</span>
            <select value={newSemester} onChange={e => setNewSemester(Number(e.target.value))} className="rounded-xl border border-vriddhi-border bg-transparent px-3 py-2 text-sm">
              {SEMESTERS.map(s => <option key={s} value={s}>Semester {s}</option>)}
            </select>
          </label>
          <button type="button" className={btn.primary} onClick={startNew} disabled={busy}>
            <Plus size={16} /> New or open timetable
          </button>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <div className="space-y-2">
          {visibleRows.length === 0 && <Empty title="No timetables yet" hint={isOps ? 'Start one above.' : 'Nothing has been sent for review.'} />}
          {visibleRows.map(row => (
            <button
              key={row.id}
              type="button"
              onClick={() => void open(row)}
              className={`w-full text-left rounded-xl border p-3 ${selected?.id === row.id ? 'border-vriddhi-accent' : 'border-vriddhi-border'} bg-vriddhi-card`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-sm">{row.branch} · Sem {row.semester}</span>
                <Badge tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Badge>
              </div>
              <div className="text-xs text-vriddhi-muted mt-1">
                Version {row.version}{row.legacyCutover ? ' · existing timetable' : ''}
              </div>
            </button>
          ))}
        </div>

        <div className="rounded-2xl border border-vriddhi-border bg-vriddhi-card p-5 min-h-[240px]">
          {!selected && <Empty title="Select a timetable" hint="Choose one on the left, or start a new one." />}

          {selected && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold">{selected.branch} · Semester {selected.semester}</h2>
                  <p className="text-xs text-vriddhi-muted">
                    {STATUS_LABEL[selected.status]}
                    {selected.submittedAt ? ` · sent ${new Date(selected.submittedAt).toLocaleString('en-IN')}` : ''}
                    {selected.reviewNote ? ` · note: ${selected.reviewNote}` : ''}
                    {selected.fallbackReason ? ` · principal fallback: ${selected.fallbackReason}` : ''}
                  </p>
                </div>
                {canEdit && !editing && (
                  <div className="flex gap-2">
                    <button type="button" className={btn.ghost} onClick={() => setEditing(drafts.length ? drafts.map(toInput) : [blankSlot()])} disabled={busy}>
                      <Pencil size={14} /> {selected.status === 'approved' ? 'Edit (creates a new draft)' : 'Edit draft'}
                    </button>
                    <button type="button" className={btn.ghost} onClick={copyLive} disabled={busy}>
                      <Copy size={14} /> Copy from live
                    </button>
                  </div>
                )}
              </div>

              {editing && (
                <DraftEditor
                  slots={editing}
                  onChange={setEditing}
                  faculty={faculty}
                  busy={busy}
                  onSave={saveDraft}
                  onSubmit={submit}
                  onCancel={() => setEditing(null)}
                />
              )}

              {!editing && (
                <SlotTable slots={drafts} />
              )}

              {!editing && canEdit && drafts.length > 0 && selected.status !== 'approved' && (
                <div className="flex justify-end">
                  <button type="button" className={btn.primary} onClick={submit} disabled={busy}>
                    <Send size={14} /> Send to HOD
                  </button>
                </div>
              )}

              {canReview && (
                <div className="space-y-3 border-t border-vriddhi-border pt-4">
                  <label className="block text-sm">
                    <span className="block text-vriddhi-muted mb-1">Note (required when returning)</span>
                    <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} className="w-full rounded-xl border border-vriddhi-border bg-transparent px-3 py-2 text-sm" />
                  </label>
                  {isPrincipal && (
                    <label className="block text-sm">
                      <span className="block text-vriddhi-muted mb-1">Fallback reason (required: the HOD is unavailable)</span>
                      <input value={fallback} onChange={e => setFallback(e.target.value)} className="w-full rounded-xl border border-vriddhi-border bg-transparent px-3 py-2 text-sm" />
                    </label>
                  )}
                  <div className="flex flex-wrap justify-end gap-2">
                    <button type="button" className={btn.danger} onClick={() => review('return')} disabled={busy || note.trim().length < 3}>
                      <Undo2 size={14} /> Return to operations
                    </button>
                    <button
                      type="button"
                      className={btn.primary}
                      onClick={() => review('approve')}
                      disabled={busy || (isPrincipal && fallback.trim().length < 5)}
                    >
                      <CheckCircle2 size={14} /> Approve
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {isPrincipal && (
        <div className="rounded-2xl border border-vriddhi-border bg-vriddhi-card p-5 space-y-2">
          <h3 className="font-semibold text-sm">One-time cut-over for existing timetables</h3>
          <p className="text-xs text-vriddhi-muted">
            Marks every timetable already live as approved, so nothing goes dark when the approval workflow starts. Safe to run again; it skips anything already recorded.
          </p>
          <button type="button" className={btn.ghost} onClick={runLegacy} disabled={busy}>
            Mark existing timetables approved
          </button>
          {legacyResult && <p className="text-xs">{legacyResult}</p>}
        </div>
      )}
    </div>
  )
}

function toInput(d: DraftSlot): SlotInput {
  return {
    dayOfWeek: d.dayOfWeek, startTime: d.startTime, endTime: d.endTime, subject: d.subject,
    subjectCode: d.subjectCode, facultyId: d.facultyId, facultyName: d.facultyName, room: d.room,
    batch: d.batch, division: d.division, type: d.type,
  }
}

function SlotTable({ slots }: { slots: Array<SlotInput | DraftSlot> }) {
  if (slots.length === 0) return <Empty title="No classes in this timetable yet" />
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-vriddhi-muted">
          <tr>
            <th className="py-2 pr-3">Day</th><th className="pr-3">Time</th><th className="pr-3">Subject</th>
            <th className="pr-3">Faculty</th><th className="pr-3">Room</th><th className="pr-3">Batch</th><th>Type</th>
          </tr>
        </thead>
        <tbody>
          {slots.map((s, i) => (
            <tr key={i} className="border-t border-vriddhi-border">
              <td className="py-2 pr-3 capitalize">{s.dayOfWeek}</td>
              <td className="pr-3">{s.startTime}–{s.endTime}</td>
              <td className="pr-3">{s.subject}{s.subjectCode ? ` (${s.subjectCode})` : ''}</td>
              <td className="pr-3">{s.facultyName}</td>
              <td className="pr-3">{s.room || '—'}</td>
              <td className="pr-3">{s.batch || '—'}</td>
              <td className="capitalize">{s.type}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DraftEditor({ slots, onChange, faculty, busy, onSave, onSubmit, onCancel }: {
  slots: SlotInput[]
  onChange: (s: SlotInput[]) => void
  faculty: { id: string; name: string }[]
  busy: boolean
  onSave: () => void
  onSubmit: () => void
  onCancel: () => void
}) {
  const update = (i: number, patch: Partial<SlotInput>) =>
    onChange(slots.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))

  const inputCls = 'w-full rounded-lg border border-vriddhi-border bg-transparent px-2 py-1.5 text-sm'

  return (
    <div className="space-y-3">
      {slots.map((s, i) => (
        <div key={i} className="grid gap-2 rounded-xl border border-vriddhi-border p-3 md:grid-cols-6">
          <select className={inputCls} value={s.dayOfWeek} onChange={e => update(i, { dayOfWeek: e.target.value })} aria-label="Day">
            {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <input className={inputCls} type="time" value={s.startTime} onChange={e => update(i, { startTime: e.target.value })} aria-label="Start" />
          <input className={inputCls} type="time" value={s.endTime} onChange={e => update(i, { endTime: e.target.value })} aria-label="End" />
          <input className={inputCls} placeholder="Subject" value={s.subject} onChange={e => update(i, { subject: e.target.value })} aria-label="Subject" />
          <select
            className={inputCls}
            value={s.facultyId || s.facultyName}
            onChange={e => {
              const f = faculty.find(x => x.id === e.target.value || x.name === e.target.value)
              update(i, { facultyId: f?.id ?? '', facultyName: f?.name ?? e.target.value })
            }}
            aria-label="Faculty"
          >
            <option value="">Faculty…</option>
            {faculty.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            {s.facultyName && !faculty.some(f => f.name === s.facultyName) && <option value={s.facultyName}>{s.facultyName}</option>}
          </select>
          <div className="flex gap-2">
            <input className={inputCls} placeholder="Room" value={s.room} onChange={e => update(i, { room: e.target.value })} aria-label="Room" />
            <button type="button" className={btn.small} onClick={() => onChange(slots.filter((_, idx) => idx !== i))} aria-label="Remove class">
              <Trash2 size={14} />
            </button>
          </div>
          <input className={inputCls} placeholder="Subject code" value={s.subjectCode} onChange={e => update(i, { subjectCode: e.target.value })} aria-label="Subject code" />
          <input className={inputCls} placeholder="Batch" value={s.batch} onChange={e => update(i, { batch: e.target.value })} aria-label="Batch" />
          <input className={inputCls} placeholder="Division" value={s.division} onChange={e => update(i, { division: e.target.value })} aria-label="Division" />
          <select className={inputCls} value={s.type} onChange={e => update(i, { type: e.target.value })} aria-label="Type">
            {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      ))}

      <div className="flex flex-wrap justify-between gap-2">
        <button type="button" className={btn.ghost} onClick={() => onChange([...slots, blankSlot()])} disabled={busy}>
          <Plus size={14} /> Add class
        </button>
        <div className="flex gap-2">
          <button type="button" className={btn.ghost} onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className={btn.ghost} onClick={onSave} disabled={busy}>Save draft</button>
          <button type="button" className={btn.primary} onClick={onSubmit} disabled={busy || slots.length === 0}>
            <Send size={14} /> Save and send to HOD
          </button>
        </div>
      </div>
    </div>
  )
}
