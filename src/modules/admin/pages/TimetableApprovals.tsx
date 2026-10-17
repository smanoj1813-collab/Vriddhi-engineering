// /admin/timetable-approvals — the approval queue. Operations builds the branch
// timetable in Class Schedule (saved as drafts) and sends it here; the branch HOD
// approves it, and the principal can approve as a fallback with a reason.
// Only approved timetables reach students and faculty.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, CheckCircle2, Copy, Send, Undo2 } from 'lucide-react'
import { useAuth } from '@/modules/auth/context/AuthContext'
import { Badge, Empty, Loading, PageHeader, btn, errMsg } from '../../office/components/officeUi'
import {
  callCopyLiveToDraft,
  callMarkLegacyTimetablesApproved,
  callReviewTimetable,
  callSubmitTimetable,
  listApprovals,
  listDrafts,
  type ApprovalRow,
  type DraftSlot,
} from '../api/timetableApprovalApi'
import type { TimetableApprovalStatus } from '../utils/timetableApproval'

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

  // HODs see only their branch (also enforced by the rules); ops and principal see all.
  const visibleRows = useMemo(() => rows ?? [], [rows])

  const open = async (row: ApprovalRow) => {
    setSelected(row)
    setNote('')
    setFallback('')
    setMessage(null)
    try {
      setDrafts(await listDrafts(collegeId, row.id, isHod ? hodDepartment : undefined))
    } catch (e) {
      setDrafts([])
      setMessage({ tone: 'err', text: errMsg(e) })
    }
  }

  const scope = selected ? { collegeId, branch: selected.branch, semester: selected.semester } : null

  const run = async (label: string, fn: () => Promise<string>) => {
    setBusy(true)
    setMessage(null)
    try {
      const text = await fn()
      setMessage({ tone: 'ok', text })
      await refresh()
      if (selected) {
        const updated = (await listApprovals(collegeId, isHod ? hodDepartment : undefined)).find(r => r.id === selected.id)
        if (updated) setSelected(updated)
        setDrafts(await listDrafts(collegeId, selected.id, isHod ? hodDepartment : undefined))
      }
    } catch (e) {
      setMessage({ tone: 'err', text: `${label}: ${errMsg(e)}` })
    } finally {
      setBusy(false)
    }
  }

  const submit = () => run('Send to HOD', async () => {
    if (!scope) return ''
    const result = await callSubmitTimetable(scope)
    return `Sent to the HOD for ${scope.branch}, semester ${scope.semester} (version ${result.version}).`
  })

  const copyLive = () => run('Copy from live', async () => {
    if (!scope) return ''
    const result = await callCopyLiveToDraft(scope)
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

  const canSend = isOps && selected && (selected.status === 'draft' || selected.status === 'returned')
  const canCopy = isOps && selected && selected.status !== 'submitted'
  const canReview = (isHod || isPrincipal) && selected?.status === 'submitted'

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Timetable Approvals"
        subtitle={isOps
          ? 'Send each branch and semester to the HOD once its classes are ready in Class Schedule.'
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

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <div className="space-y-2">
          {visibleRows.length === 0 && (
            <Empty
              title="No timetables yet"
              hint={isOps ? 'Build classes in Class Schedule Manager. They appear here once saved.' : 'Nothing has been sent for review.'}
            />
          )}
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
          {!selected && <Empty title="Select a timetable" hint="Choose one on the left." />}

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
                {canCopy && (
                  <div className="flex gap-2">
                    <button type="button" className={btn.ghost} onClick={copyLive} disabled={busy}>
                      <Copy size={14} /> Copy from live
                    </button>
                  </div>
                )}
              </div>

              <SlotTable slots={drafts} />

              {canSend && drafts.length > 0 && (
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

function SlotTable({ slots }: { slots: DraftSlot[] }) {
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
