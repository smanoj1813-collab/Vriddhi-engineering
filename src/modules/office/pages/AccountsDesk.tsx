// /admin/accounts — the accounts team's home: today's collections, fee
// balances, bills to approve/pay, library fines and purchase approvals.

import PortalHero from '../../../shared/components/portal/PortalHero'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight, BookOpen, CreditCard, IndianRupee, Receipt, ShoppingCart, Wallet } from 'lucide-react'
import { useAuth } from '@/modules/auth/context/AuthContext'
import { calculateSummary, fetchFeePayments } from '@/modules/admin/api/feeApi'
import { Loading, OfficeReadError, PageHeader, StatCard, btn, inr } from '../components/officeUi'
import { buildDaybook } from '../api/financeReportsApi'
import { fetchFines } from '../api/libraryApi'
import { billPayState } from '../api/procurementApi'
import { useProcurementSettings, usePurchaseRequests, useVendorBills } from '../hooks/useProcurement'
import { useCollegeId } from '../hooks/useLibrary'
import { useOfficeSelfHeal } from '../hooks/useOfficeSelfHeal'
import { todayIso } from '../api/officeDb'
import { canActOnStep, nextStep } from '../utils/procurementEngine'
import { summarizeDaybook } from '../utils/tallyExport'

export default function AccountsDesk() {
  const { user } = useAuth()
  const cid = useCollegeId()
  const { healClaims, hasHealed } = useOfficeSelfHeal()
  const today = todayIso()
  const feesQ = useQuery({ queryKey: ['accountsDesk', cid, 'fees'], queryFn: () => fetchFeePayments(), enabled: !!cid, staleTime: 60 * 1000 })
  const todayQ = useQuery({ queryKey: ['accountsDesk', cid, 'today', today], queryFn: () => buildDaybook({ from: today, to: today, includeFees: true, includeFines: true, includeVendors: false, includePayroll: false }), enabled: !!cid, staleTime: 60 * 1000 })
  const finesQ = useQuery({ queryKey: ['accountsDesk', cid, 'fines'], queryFn: () => fetchFines('open'), enabled: !!cid, staleTime: 60 * 1000 })
  const billsQ = useVendorBills()
  const prsQ = usePurchaseRequests()
  const { settings } = useProcurementSettings()

  const sum = feesQ.data ? calculateSummary(feesQ.data) : null
  const todaySum = todayQ.data ? summarizeDaybook(todayQ.data.entries) : null
  const bills = (billsQ.data || []).filter(b => b.status !== 'cancelled')
  const toApprove = bills.filter(b => b.status === 'pending')
  const payable = bills.filter(b => b.status === 'approved' && billPayState(b) !== 'paid')
  const overdueBills = payable.filter(b => b.dueDate && b.dueDate < today)
  const prApprovals = (prsQ.data || []).filter(p => p.status === 'submitted' && canActOnStep(nextStep(settings.approvalChain, p.estimatedTotal, p.requestedBy.role, p.approvals), user?.role || ''))
  const openFines = finesQ.data || []

  const links = [
    { to: '/admin/fees', label: 'Fee management', icon: <CreditCard className="w-4 h-4" /> },
    { to: '/admin/vendor-bills', label: 'Vendor bills', icon: <Receipt className="w-4 h-4" /> },
    { to: '/admin/library-fines', label: 'Library fines', icon: <BookOpen className="w-4 h-4" /> },
    { to: '/admin/purchase-requests', label: 'Purchase approvals', icon: <ShoppingCart className="w-4 h-4" /> },
    { to: '/admin/finance-reports', label: 'Day book & Tally', icon: <IndianRupee className="w-4 h-4" /> },
    { to: '/admin/no-dues', label: 'No-dues', icon: <Wallet className="w-4 h-4" /> },
  ]

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <PortalHero
          eyebrow="Accounts team"
          title={`Good day${user?.name ? `, ${user.name.split(' ')[0]}` : ''}`}
          description="Fees, vendor bills, payroll and finance reports — here's what needs attention."
        />
      </div>
      <PageHeader title="Accounts Desk" subtitle={`Good day${user?.name ? `, ${user.name.split(' ')[0]}` : ''} — here's what needs attention`} icon={<Wallet className="w-5 h-5" />} />
      <OfficeReadError
        desk="accounts desk"
        healAttempted={hasHealed}
        collegeId={cid}
        errors={[feesQ, todayQ, finesQ, billsQ, prsQ]}
        onRetry={async () => {
          // Re-issue a stale college claim BEFORE retrying: the rules authorise
          // these reads from the token, so a retry on an unrepaired token just
          // fails the same way.
          await healClaims()
          void feesQ.refetch(); void todayQ.refetch(); void finesQ.refetch()
          void billsQ.refetch(); void prsQ.refetch()
        }}
      />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard label="Collected today" value={todaySum ? inr(todaySum.receipts) : '…'} icon={<IndianRupee className="w-5 h-5" />} tone="text-emerald-500" hint={todaySum ? Object.entries(todaySum.byMode).map(([k, v]) => `${k.toUpperCase()} ${inr(v)}`).join(' · ') || 'No receipts yet' : undefined} />
        <StatCard label="Fees outstanding" value={sum ? inr(sum.totalPending + sum.totalOverdue) : '…'} icon={<CreditCard className="w-5 h-5" />} hint={sum ? `${sum.countOverdue} overdue · ${inr(sum.totalOverdue)}` : undefined} />
        <StatCard label="Vendor bills payable" value={inr(payable.reduce((s, b) => s + b.net - b.paid, 0))} icon={<Receipt className="w-5 h-5" />} tone={overdueBills.length ? 'text-red-500' : undefined} hint={`${toApprove.length} to approve · ${overdueBills.length} overdue`} />
        <StatCard label="Library fines open" value={inr(openFines.reduce((s, f) => s + f.amount, 0))} icon={<BookOpen className="w-5 h-5" />} hint={`${openFines.length} fine(s)`} />
      </div>
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-3">
          <h3 className="font-semibold">To do</h3>
          {(feesQ.isLoading || billsQ.isLoading) && <Loading />}
          <Todo show={toApprove.length > 0} to="/admin/vendor-bills" text={`${toApprove.length} vendor bill(s) waiting for approval`} />
          <Todo show={overdueBills.length > 0} to="/admin/vendor-bills" text={`${overdueBills.length} approved bill(s) past due date`} danger />
          <Todo show={prApprovals.length > 0} to="/admin/purchase-requests" text={`${prApprovals.length} purchase request(s) need your approval`} />
          <Todo show={openFines.length > 0} to="/admin/library-fines" text={`${openFines.length} library fine(s) not yet collected`} />
          <Todo show={!!sum && sum.countOverdue > 0} to="/admin/fees" text={`${sum?.countOverdue || 0} fee account(s) overdue — ${inr(sum?.totalOverdue || 0)}`} danger />
          {!toApprove.length && !overdueBills.length && !prApprovals.length && !openFines.length && !(sum && sum.countOverdue) && !feesQ.isLoading && <p className="text-sm text-vriddhi-muted">All caught up.</p>}
          {todayQ.data && todayQ.data.entries.length > 0 && (
            <div className="glass-card p-4 mt-4">
              <h3 className="font-semibold mb-2">Today's receipts</h3>
              {todayQ.data.entries.slice(-8).reverse().map((e, i) => <div key={i} className="flex justify-between text-sm py-1 border-b border-vriddhi-border/40"><span>{e.party} <span className="text-xs text-vriddhi-muted">{e.ref} · {(e.mode || '').toUpperCase()}</span></span><span>{inr(e.amount)}</span></div>)}
              <Link to="/admin/finance-reports" className="text-xs text-vriddhi-accent mt-2 inline-block">Open day book →</Link>
            </div>
          )}
        </div>
        <div className="space-y-2">
          <h3 className="font-semibold">Go to</h3>
          {links.map(l => <Link key={l.to} to={l.to} className={`${btn.ghost} w-full justify-between`}><span className="flex items-center gap-2">{l.icon}{l.label}</span><ArrowRight className="w-4 h-4" /></Link>)}
        </div>
      </div>
    </div>
  )
}

function Todo({ show, to, text, danger }: { show: boolean; to: string; text: string; danger?: boolean }) {
  if (!show) return null
  return (
    <Link to={to} className={`glass-card p-3 flex items-center gap-3 hover:bg-vriddhi-border/20 ${danger ? 'border-l-4 border-red-500' : 'border-l-4 border-amber-500'}`}>
      <AlertTriangle className={`w-4 h-4 ${danger ? 'text-red-500' : 'text-amber-500'}`} />
      <span className="text-sm flex-1">{text}</span>
      <ArrowRight className="w-4 h-4 text-vriddhi-muted" />
    </Link>
  )
}

export { Todo }
