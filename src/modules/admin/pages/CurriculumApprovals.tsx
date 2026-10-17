// /admin/curriculum-approvals — course lists assigned by the superadmin.
// Operations (or admin) verifies each branch and semester list before its classes
// are scheduled. The principal reviews it (approve or return). HODs can read it.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { BookOpen, CheckCircle2, ShieldCheck, Undo2 } from 'lucide-react'
import { useAuth } from '@/modules/auth/context/AuthContext'
import { Badge, Empty, Loading, PageHeader, btn, errMsg } from '../../office/components/officeUi'
import {
  callReviewCurriculumApproval,
  callVerifyCurriculumList,
  listCurriculumApprovals,
  listCurriculumScopes,
  type CurriculumApprovalRow,
  type CurriculumScope,
} from '../api/curriculumApprovalApi'
import { curriculumApprovalId, normaliseCurriculumBranch } from '../utils/curriculumApproval'

export default function CurriculumApprovals() {
  const { user } = useAuth()
  const role = user?.role ?? ''
  const collegeId = user?.collegeId || localStorage.getItem('vriddhi_college_id') || ''
  const canVerify = role === 'operations' || role === 'admin' || role === 'superadmin'
  const isPrincipal = role === 'principal'
  const isHod = role === 'hod'
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
      .map(scope => {
        const id = curriculumApprovalId(collegeId, scope.branch, scope.semester)
        const approval = byId.get(id) ?? null
        // Verified, but the list has been edited since (or a verify is missing).
        const verified = !!approval?.verifiedAt
        const changedSinceVerify = verified && !!scope.latestUpdate && scope.latestUpdate > (approval?.verifiedAt ?? '')
        return { scope, id, approval, verified, changedSinceVerify }
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
        subtitle={canVerify
          ? 'Verify each course list before its classes are scheduled. The principal reviews it too.'
          : isPrincipal
            ? 'Review the course list for each branch and semester. Approve or return it.'
            : 'Course lists for your branch. Read only.'}
        icon={<BookOpen size={20} />}
      />

      {loadError && <div className="text-sm text-red-600">{loadError}</div>}
      {message && (
        <div className={`text-sm rounded-xl px-4 py-3 ${message.tone === 'ok' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-red-500/10 text-red-600'}`}>
          {message.text}
        </div>
      )}

      {rows.length === 0 && (
        <Empty title="No course lists yet" hint="The superadmin assigns course lists to the college. They appear here." />
      )}

      <div className="space-y-3">
        {rows.map(({ scope, id, approval, verified, changedSinceVerify }) => {
          const busy = busyId === id
          const note = notes[id] ?? ''
          const reviewStatus = approval?.reviewStatus ?? 'pending'
          const verifyLabel = !verified ? 'Not verified' : changedSinceVerify ? 'Changed since verified' : 'Verified'
          const verifyTone = !verified ? 'red' : changedSinceVerify ? 'amber' : 'green'
          const reviewLabel = reviewStatus === 'approved' ? 'Principal approved' : reviewStatus === 'returned' ? 'Returned by principal' : 'Awaiting principal'
          const reviewTone = reviewStatus === 'approved' ? 'green' : reviewStatus === 'returned' ? 'red' : 'slate'
          return (
            <div key={id} className="rounded-2xl border border-vriddhi-border bg-vriddhi-card p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-medium text-sm">{scope.branch} · Semester {scope.semester}</div>
                  <div className="text-xs text-vriddhi-muted">
                    {scope.courseCount} course{scope.courseCount === 1 ? '' : 's'}
                    {approval?.verifiedAt ? ` · verified ${new Date(approval.verifiedAt).toLocaleString('en-IN')}` : ''}
                    {approval?.reviewNote ? ` · note: ${approval.reviewNote}` : ''}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={verifyTone}>{verifyLabel}</Badge>
                  <Badge tone={reviewTone}>{reviewLabel}</Badge>
                  {canVerify && (
                    <button
                      type="button"
                      className={btn.primary}
                      disabled={busy}
                      onClick={() => run(id, 'Verify', async () => {
                        const r = await callVerifyCurriculumList({ collegeId, branch: scope.branch, semester: scope.semester })
                        return `Verified ${scope.branch}, semester ${scope.semester} (${r.courseCount} courses). Classes can now be scheduled.`
                      })}
                    >
                      <ShieldCheck size={14} /> {verified ? 'Verify again' : 'Verify'}
                    </button>
                  )}
                </div>
              </div>

              {isPrincipal && (
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
                        setNotes(n => ({ ...n, [id]: '' }))
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
