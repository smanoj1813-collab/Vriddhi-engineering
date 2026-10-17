// /admin/curriculum-approvals — the course list for each branch and semester.
// Admin, or the branch HOD, sends the active list for principal approval.
// The principal approves or returns it. Approval covers the exact list sent.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { BookOpen, CheckCircle2, Send, Undo2 } from 'lucide-react'
import { useAuth } from '@/modules/auth/context/AuthContext'
import { Badge, Empty, Loading, PageHeader, btn, errMsg } from '../../office/components/officeUi'
import {
  callReviewCurriculumApproval,
  callSubmitCurriculumForApproval,
  listCurriculumApprovals,
  listCurriculumScopes,
  type CurriculumApprovalRow,
  type CurriculumScope,
} from '../api/curriculumApprovalApi'
import {
  curriculumApprovalId,
  normaliseCurriculumBranch,
  type CurriculumApprovalStatus,
} from '../utils/curriculumApproval'

const STATUS_TONE: Record<CurriculumApprovalStatus, 'slate' | 'amber' | 'red' | 'green'> = {
  draft: 'slate',
  submitted: 'amber',
  returned: 'red',
  approved: 'green',
}
const STATUS_LABEL: Record<CurriculumApprovalStatus, string> = {
  draft: 'Not sent',
  submitted: 'Waiting for principal',
  returned: 'Returned',
  approved: 'Approved',
}

export default function CurriculumApprovals() {
  const { user } = useAuth()
  const role = user?.role ?? ''
  const collegeId = user?.collegeId || localStorage.getItem('vriddhi_college_id') || ''
  const isPrincipal = role === 'principal'
  const isHod = role === 'hod'
  const canSend = role === 'admin' || role === 'superadmin' || isHod
  const hodBranch = isHod ? normaliseCurriculumBranch(user?.department) : ''

  const [scopes, setScopes] = useState<CurriculumScope[] | null>(null)
  const [approvals, setApprovals] = useState<CurriculumApprovalRow[]>([])
  const [loadError, setLoadError] = useState('')
  const [busyId, setBusyId] = useState('')
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null)

  const refresh = useCallback(async () => {
    if (!collegeId) return
    try {
      setLoadError('')
      const [s, a] = await Promise.all([listCurriculumScopes(collegeId), listCurriculumApprovals(collegeId)])
      setScopes(s)
      setApprovals(a)
    } catch (e) {
      setLoadError(errMsg(e))
    }
  }, [collegeId])

  useEffect(() => { void refresh() }, [refresh])

  const rows = useMemo(() => {
    if (!scopes) return []
    const byId = new Map(approvals.map(a => [a.id, a]))
    return scopes
      .filter(s => !isHod || normaliseCurriculumBranch(s.branch) === hodBranch)
      .map(s => {
        const id = curriculumApprovalId(collegeId, s.branch, s.semester)
        return { scope: s, id, approval: byId.get(id) ?? null, status: (byId.get(id)?.status ?? 'draft') as CurriculumApprovalStatus }
      })
  }, [scopes, approvals, collegeId, isHod, hodBranch])

  const run = async (id: string, label: string, fn: () => Promise<string>) => {
    setBusyId(id)
    setMessage(null)
    try {
      setMessage({ tone: 'ok', text: await fn() })
      await refresh()
    } catch (e) {
      setMessage({ tone: 'err', text: `${label}: ${errMsg(e)}` })
    } finally {
      setBusyId('')
    }
  }

  if (!collegeId) return <Empty title="No college selected" />
  if (scopes === null && !loadError) return <Loading label="Loading course lists…" />

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Curriculum Approvals"
        subtitle={isPrincipal
          ? 'Approve the course list for each branch and semester. It feeds the timetable.'
          : 'Send each branch and semester course list to the principal for approval.'}
        icon={<BookOpen size={20} />}
      />

      {loadError && <div className="text-sm text-red-600">{loadError}</div>}
      {message && (
        <div className={`text-sm rounded-xl px-4 py-3 ${message.tone === 'ok' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-red-500/10 text-red-600'}`}>
          {message.text}
        </div>
      )}

      {rows.length === 0 && (
        <Empty title="No course lists yet" hint="Course lists appear here once they are assigned to this college." />
      )}

      <div className="space-y-3">
        {rows.map(({ scope, id, approval, status }) => {
          const busy = busyId === id
          const note = notes[id] ?? ''
          return (
            <div key={id} className="rounded-2xl border border-vriddhi-border bg-vriddhi-card p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-medium text-sm">{scope.branch} · Semester {scope.semester}</div>
                  <div className="text-xs text-vriddhi-muted">
                    {scope.courseCount} course{scope.courseCount === 1 ? '' : 's'}
                    {approval?.submittedAt ? ` · sent ${new Date(approval.submittedAt).toLocaleString('en-IN')}` : ''}
                    {approval?.reviewNote ? ` · note: ${approval.reviewNote}` : ''}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
                  {canSend && status !== 'submitted' && (
                    <button
                      type="button"
                      className={btn.primary}
                      disabled={busy}
                      onClick={() => run(id, 'Send for approval', async () => {
                        const r = await callSubmitCurriculumForApproval({ collegeId, branch: scope.branch, semester: scope.semester })
                        return `Sent ${scope.branch}, semester ${scope.semester} (${r.courseCount} courses) to the principal.`
                      })}
                    >
                      <Send size={14} /> {status === 'approved' ? 'Send changes for approval' : 'Send for approval'}
                    </button>
                  )}
                </div>
              </div>

              {isPrincipal && status === 'submitted' && (
                <div className="space-y-2 border-t border-vriddhi-border pt-3">
                  <label className="block text-sm">
                    <span className="block text-vriddhi-muted mb-1">Note (required when returning)</span>
                    <textarea
                      value={note}
                      onChange={e => setNotes(n => ({ ...n, [id]: e.target.value }))}
                      rows={2}
                      className="w-full rounded-xl border border-vriddhi-border bg-transparent px-3 py-2 text-sm"
                    />
                  </label>
                  <div className="flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      className={btn.danger}
                      disabled={busy || note.trim().length < 3}
                      onClick={() => run(id, 'Return', async () => {
                        await callReviewCurriculumApproval({ collegeId, branch: scope.branch, semester: scope.semester, decision: 'return', note: note.trim() })
                        setNotes(n => ({ ...n, [id]: '' }))
                        return `Returned ${scope.branch}, semester ${scope.semester} with your note.`
                      })}
                    >
                      <Undo2 size={14} /> Return
                    </button>
                    <button
                      type="button"
                      className={btn.primary}
                      disabled={busy}
                      onClick={() => run(id, 'Approve', async () => {
                        await callReviewCurriculumApproval({ collegeId, branch: scope.branch, semester: scope.semester, decision: 'approve', note: note.trim() || undefined })
                        return `Approved the course list for ${scope.branch}, semester ${scope.semester}.`
                      })}
                    >
                      <CheckCircle2 size={14} /> Approve
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
