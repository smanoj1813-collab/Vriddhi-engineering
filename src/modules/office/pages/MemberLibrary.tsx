// Member-facing library (students at /student/library, faculty at
// /faculty/library). Connected live to the library office: catalogue with
// real availability, my books with due dates and fines-so-far, renewal
// requests, reservations and fines (with a link to the Fee Portal when the
// library posted the fine to the student's fee account).

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { AlertTriangle, BookMarked, Bookmark, CheckCircle2, Clock, ExternalLink, IndianRupee, Library, RefreshCw, Search, X } from 'lucide-react'
import { collection, getDocs, limit, query, where } from 'firebase/firestore'
import { db } from '@/Firebase/config'
import { useAuth } from '@/modules/auth/context/AuthContext'
import { useStudentProfile } from '@/modules/student/hooks/useStudentProfile'
import { useNotification } from '@/shared/providers/NotificationProvider'
import { Badge, Empty, Loading, PillTabs, StatCard, btn, errMsg, fmtDate, inr } from '../components/officeUi'
import {
  TITLE_TYPES,
  cancelMyReservation,
  fetchMyFines,
  fetchMyLoans,
  fetchMyReservations,
  placeReservation,
  requestRenewal,
  titleSearchText,
  type LibraryLoan,
  type LibraryTitle,
} from '../api/libraryApi'
import { computeOverdueFine, daysBetween, loanState, type MemberType } from '../utils/libraryEngine'
import { todayIso } from '../api/officeDb'
import { useCollegeId, useLibrarySettings, useLibraryTitles } from '../hooks/useLibrary'

type Tab = 'books' | 'catalogue' | 'reservations' | 'fines' | 'history'

export default function MemberLibrary({ memberType = 'student' }: { memberType?: MemberType }) {
  const { user } = useAuth()
  const cid = useCollegeId()
  const qc = useQueryClient()
  const { showSuccess, showError, showWarning } = useNotification()
  const { settings } = useLibrarySettings()
  const isStudent = memberType === 'student'
  const { profile } = useStudentProfile(isStudent ? user?.uid : undefined)
  const uid = user?.uid || ''
  const studentId = isStudent ? profile?.id || '' : ''

  // Faculty profile id (for reservations placed from the portal)
  const facultyQ = useQuery({
    queryKey: ['library', cid, 'myFacultyProfile', uid],
    enabled: !isStudent && !!uid,
    queryFn: async () => {
      try {
        const s = await getDocs(query(collection(db, 'faculty'), where('uid', '==', uid), limit(1)))
        if (s.empty) return null
        const d = s.docs[0]
        const r = d.data()
        return { id: d.id, code: String(r.facultyId || r.staffCode || r.employeeId || ''), department: String(r.department || '') }
      } catch {
        return null
      }
    },
  })

  const titlesQ = useLibraryTitles()
  const key = ['library', cid, 'me', uid, studentId]
  const loansQ = useQuery({ queryKey: [...key, 'loans'], queryFn: () => fetchMyLoans(uid, studentId || undefined), enabled: !!uid && !!cid })
  const resQ = useQuery({ queryKey: [...key, 'res'], queryFn: () => fetchMyReservations(uid, studentId || undefined), enabled: !!uid && !!cid })
  const finesQ = useQuery({ queryKey: [...key, 'fines'], queryFn: () => fetchMyFines(uid, studentId || undefined), enabled: !!uid && !!cid })
  const refresh = () => qc.invalidateQueries({ queryKey: key })

  const [tab, setTab] = useState<Tab>('books')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [busy, setBusy] = useState<string | null>(null)

  const today = todayIso()
  const policy = settings.policies[memberType]
  const loans = loansQ.data || []
  const active = loans.filter(l => l.status === 'issued')
  const history = loans.filter(l => l.status !== 'issued')
  const reservations = (resQ.data || []).filter(r => ['waiting', 'ready'].includes(r.status))
  const fines = finesQ.data || []
  const unpaid = fines.filter(f => f.status === 'pending' || f.status === 'posted')
  const unpaidTotal = unpaid.reduce((s, f) => s + f.amount, 0)
  const overdueCount = active.filter(l => loanState(l.dueDate, today) === 'overdue').length

  const titles = titlesQ.data || []
  const categories = useMemo(() => Array.from(new Set(titles.map(t => t.category).filter(Boolean))).sort(), [titles])
  const results = useMemo(() => {
    const q = search.trim().toLowerCase()
    return titles.filter(t => (category === 'all' || t.category === category) && (!q || titleSearchText(t).includes(q))).slice(0, 100)
  }, [titles, search, category])

  const fineSoFar = (l: LibraryLoan) => computeOverdueFine(l.dueDate, today, policy, settings).amount

  async function askRenewal(l: LibraryLoan) {
    setBusy(l.id)
    try {
      await requestRenewal(l.id)
      showSuccess('Renewal requested — the library will confirm the new due date.')
      refresh()
    } catch (e) {
      showError(errMsg(e))
    } finally {
      setBusy(null)
    }
  }

  async function reserve(t: LibraryTitle) {
    if (reservations.some(r => r.titleId === t.id)) return showWarning('You have already reserved this title.')
    if (active.some(l => l.titleId === t.id)) return showWarning('You already have this book.')
    if (settings.maxReservationsPerMember > 0 && reservations.length >= settings.maxReservationsPerMember) return showWarning(`You can hold at most ${settings.maxReservationsPerMember} reservations.`)
    setBusy(t.id)
    try {
      await placeReservation(t, {
        type: memberType,
        id: isStudent ? studentId || uid : facultyQ.data?.id || uid,
        uid,
        studentId,
        name: (isStudent ? profile?.name : undefined) || user?.name || user?.email || 'Member',
        code: isStudent ? String(profile?.regNo || '') : facultyQ.data?.code || '',
        department: facultyQ.data?.department || '',
        course: isStudent ? String(profile?.course || '') : '',
        batch: isStudent ? String(profile?.batch || '') : '',
      })
      showSuccess('Reserved. We’ll keep a copy aside for you when one is returned.')
      refresh()
    } catch (e) {
      showError(errMsg(e))
    } finally {
      setBusy(null)
    }
  }

  async function cancel(id: string) {
    setBusy(id)
    try {
      await cancelMyReservation(id)
      refresh()
    } catch (e) {
      showError(errMsg(e))
    } finally {
      setBusy(null)
    }
  }

  const loading = loansQ.isLoading

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex flex-wrap justify-between gap-3 items-start">
        <div className="flex gap-3 items-start">
          <div className="w-11 h-11 rounded-2xl bg-vriddhi-accent/15 text-vriddhi-accent flex items-center justify-center"><Library className="w-5 h-5" /></div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{settings.libraryName}</h1>
            <p className="text-sm text-vriddhi-muted">{settings.openingHours} · Up to {policy.maxBooks} books for {policy.loanDays} days{policy.finePerDay ? ` · fine ₹${policy.finePerDay}/day` : ''}</p>
          </div>
        </div>
        <button onClick={refresh} className={btn.ghost}><RefreshCw className={`w-4 h-4 ${loansQ.isFetching ? 'animate-spin' : ''}`} /></button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Books with me" value={`${active.length}/${policy.maxBooks}`} icon={<BookMarked className="w-5 h-5" />} />
        <StatCard label="Overdue" value={overdueCount} icon={<AlertTriangle className="w-5 h-5" />} tone={overdueCount ? 'text-red-500' : 'text-green-500'} />
        <StatCard label="Reservations" value={reservations.length} icon={<Bookmark className="w-5 h-5" />} tone="text-purple-500" hint={reservations.some(r => r.status === 'ready') ? 'A book is ready for you!' : undefined} />
        <StatCard label="Unpaid fines" value={inr(unpaidTotal)} icon={<IndianRupee className="w-5 h-5" />} tone={unpaidTotal ? 'text-amber-500' : 'text-green-500'} />
      </div>

      {reservations.filter(r => r.status === 'ready').map(r => (
        <div key={r.id} className="rounded-xl p-3 bg-purple-500/10 border border-purple-500/30 text-sm text-purple-700 dark:text-purple-300 flex gap-2">
          <CheckCircle2 className="w-4 h-4 mt-0.5" /> “{r.titleName}” is waiting for you at the library desk — collect it by {fmtDate(r.expiresAt)}.
        </div>
      ))}

      <PillTabs value={tab} onChange={setTab} options={[
        { id: 'books', label: 'My books', count: active.length },
        { id: 'catalogue', label: 'Search catalogue' },
        { id: 'reservations', label: 'Reservations', count: reservations.length },
        { id: 'fines', label: 'Fines', count: unpaid.length },
        { id: 'history', label: 'History', count: history.length },
      ]} />

      {tab === 'books' && (loading ? <Loading /> : active.length === 0 ? (
        <Empty icon={<BookMarked className="w-6 h-6" />} title="You have no books issued" hint="Find a book in the catalogue, then collect it at the library desk with your ID card." action={<button onClick={() => setTab('catalogue')} className={btn.primary}><Search className="w-4 h-4" /> Search catalogue</button>} />
      ) : (
        <div className="grid md:grid-cols-2 gap-3">
          {active.map(l => {
            const st = loanState(l.dueDate, today)
            const f = fineSoFar(l)
            const canAsk = settings.allowRenewalRequests && l.renewals < policy.maxRenewals && !l.renewRequestedAt
            return (
              <div key={l.id} className={`glass-card p-4 border-l-4 ${st === 'overdue' ? 'border-l-red-500' : st === 'due_soon' ? 'border-l-amber-500' : 'border-l-green-500'}`}>
                <p className="font-semibold text-slate-900 dark:text-white">{l.titleName}</p>
                <p className="text-xs text-vriddhi-muted font-mono">{l.accessionNo}</p>
                <div className="flex flex-wrap gap-2 mt-2 text-xs">
                  <Badge tone="slate">Issued {fmtDate(l.issueDate)}</Badge>
                  <Badge tone={st === 'overdue' ? 'red' : st === 'due_soon' ? 'amber' : 'green'}>
                    {st === 'overdue' ? `${daysBetween(l.dueDate, today)} day(s) overdue` : `Due ${fmtDate(l.dueDate)}`}
                  </Badge>
                  {f > 0 && <Badge tone="red">Fine so far {inr(f)}</Badge>}
                  {l.renewals > 0 && <Badge tone="blue">Renewed {l.renewals}×</Badge>}
                </div>
                <div className="mt-3">
                  {l.renewRequestedAt ? (
                    <span className="text-xs text-blue-500 flex items-center gap-1"><Clock className="w-3 h-3" /> Renewal requested {fmtDate(l.renewRequestedAt)}</span>
                  ) : canAsk ? (
                    <button onClick={() => askRenewal(l)} disabled={busy === l.id} className={btn.small}><RefreshCw className="w-3 h-3" /> Request renewal</button>
                  ) : (
                    <span className="text-xs text-vriddhi-muted">{l.renewals >= policy.maxRenewals ? 'Renewal limit reached — please return on time.' : ''}</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ))}

      {tab === 'catalogue' && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-vriddhi-muted" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by title, author, subject or ISBN" className="input-field !pl-9" autoFocus />
            </div>
            <select value={category} onChange={e => setCategory(e.target.value)} className="input-field !w-auto">
              <option value="all">All categories</option>
              {categories.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          {titlesQ.isLoading ? <Loading /> : results.length === 0 ? (
            <Empty title={titles.length ? 'No books match your search' : 'The library catalogue is not online yet'} />
          ) : (
            <div className="grid md:grid-cols-2 gap-3">
              {results.map(t => {
                const online = TITLE_TYPES.find(x => x.id === t.type)?.physical === false
                const mine = active.some(l => l.titleId === t.id)
                const reserved = reservations.some(r => r.titleId === t.id)
                return (
                  <div key={t.id} className="glass-card p-4 flex gap-3">
                    {t.coverUrl ? <img src={t.coverUrl} alt="" className="w-12 h-16 object-cover rounded shrink-0" loading="lazy" /> : <div className="w-12 h-16 rounded bg-vriddhi-dark/30 flex items-center justify-center shrink-0"><BookMarked className="w-5 h-5 text-vriddhi-muted" /></div>}
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-slate-900 dark:text-white">{t.title}</p>
                      <p className="text-xs text-vriddhi-muted">{[t.authors, t.edition && `${t.edition} ed.`, t.publisher, t.year].filter(Boolean).join(' · ')}</p>
                      <p className="text-xs text-vriddhi-muted">{t.callNumber && <span className="font-mono">{t.callNumber}</span>}{t.location ? ` · ${t.location}` : ''}</p>
                      <div className="flex flex-wrap items-center gap-2 mt-2">
                        {online ? (
                          t.eUrl ? <a href={t.eUrl} target="_blank" rel="noreferrer" className={btn.small}><ExternalLink className="w-3 h-3" /> Open</a> : <Badge tone="blue">Online resource</Badge>
                        ) : (
                          <>
                            <Badge tone={t.availableCopies > 0 ? 'green' : 'red'}>{t.availableCopies > 0 ? `${t.availableCopies} of ${t.totalCopies} available` : t.totalCopies ? 'All copies on loan' : 'No copies'}</Badge>
                            {mine && <Badge tone="blue">With you</Badge>}
                            {reserved && <Badge tone="purple">Reserved</Badge>}
                            {!mine && !reserved && t.availableCopies === 0 && t.totalCopies > 0 && settings.allowReservations && (
                              <button onClick={() => reserve(t)} disabled={busy === t.id} className={btn.small}><Bookmark className="w-3 h-3" /> Reserve</button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'reservations' && (reservations.length === 0 ? (
        <Empty title="No reservations" hint={settings.allowReservations ? 'When every copy of a book is on loan, reserve it from the catalogue and we’ll keep the next returned copy for you.' : 'Ask at the library desk to reserve a book.'} />
      ) : (
        <div className="glass-card divide-y divide-vriddhi-border/60">
          {reservations.map(r => (
            <div key={r.id} className="p-4 flex justify-between gap-3 items-center">
              <div>
                <p className="font-medium text-slate-900 dark:text-white">{r.titleName}</p>
                <p className="text-xs text-vriddhi-muted">{r.status === 'ready' ? `Ready — collect by ${fmtDate(r.expiresAt)}` : `Waiting since ${fmtDate(r.createdAt)}`}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={r.status === 'ready' ? 'purple' : 'amber'}>{r.status === 'ready' ? 'Ready' : 'Waiting'}</Badge>
                {r.status === 'waiting' && <button onClick={() => cancel(r.id)} disabled={busy === r.id} className={btn.small}><X className="w-3 h-3" /> Cancel</button>}
              </div>
            </div>
          ))}
        </div>
      ))}

      {tab === 'fines' && (fines.length === 0 ? <Empty title="No library fines" /> : (
        <div className="space-y-3">
          {unpaid.some(f => f.status === 'posted') && isStudent && (
            <div className="rounded-xl p-3 bg-blue-500/10 border border-blue-500/30 text-sm text-blue-700 dark:text-blue-300">
              Some fines were added to your fee account — please clear them at the college accounts office.
            </div>
          )}
          <div className="glass-card divide-y divide-vriddhi-border/60">
            {fines.map(f => (
              <div key={f.id} className="p-4 flex justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900 dark:text-white">{f.reason === 'overdue' ? `Overdue — ${f.days} day(s)` : f.reason === 'lost' ? 'Lost book' : f.reason === 'damaged' ? 'Damaged book' : 'Library charge'}</p>
                  <p className="text-xs text-vriddhi-muted truncate">{f.titleName} · {fmtDate(f.createdAt)}{f.receiptNo ? ` · receipt ${f.receiptNo}` : ''}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold">{inr(f.amount)}</p>
                  <Badge tone={f.status === 'pending' ? 'amber' : f.status === 'posted' ? 'blue' : f.status === 'waived' ? 'slate' : 'green'}>
                    {f.status === 'pending' ? 'Pay at library' : f.status === 'posted' ? 'On fee account' : f.status === 'waived' ? 'Waived' : 'Paid'}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {tab === 'history' && (history.length === 0 ? <Empty title="No past loans yet" /> : (
        <div className="glass-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-vriddhi-border"><th className="table-header">Book</th><th className="table-header">Issued</th><th className="table-header">Returned</th><th className="table-header text-right">Fine</th></tr></thead>
            <tbody>
              {history.map(l => (
                <tr key={l.id} className="border-b border-vriddhi-border/50">
                  <td className="table-cell">{l.titleName}{l.status === 'lost' && <Badge tone="red">Lost</Badge>}</td>
                  <td className="table-cell">{fmtDate(l.issueDate)}</td>
                  <td className="table-cell">{fmtDate(l.returnDate)}{l.returnDate > l.dueDate && <span className="block text-[11px] text-red-500">late</span>}</td>
                  <td className="table-cell text-right">{l.fineAmount ? inr(l.fineAmount) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}
