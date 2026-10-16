// /admin/operations — the operations team's home: library circulation,
// reservations, stores alerts, assets and purchasing.

import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, BookOpen, Boxes, ClipboardList, LayoutDashboard, Library, PackageCheck, ShieldCheck, ShoppingCart, ArrowLeftRight, BedDouble, Bus, Wrench } from 'lucide-react'
import { useAuth } from '@/modules/auth/context/AuthContext'
import { OfficeReadError, PageHeader, StatCard, btn } from '../components/officeUi'
import { useOfficeSelfHeal } from '../hooks/useOfficeSelfHeal'
import { fetchActiveLoans, fetchOpenReservations } from '../api/libraryApi'
import { fetchNoDuesRequests, fetchNoDuesSettings } from '../api/noDuesApi'
import { useAssets, useInventorySettings, useItems } from '../hooks/useInventory'
import { usePurchaseOrders, usePurchaseRequests } from '../hooks/useProcurement'
import { useCollegeId } from '../hooks/useLibrary'
import { todayIso } from '../api/officeDb'
import { loanState } from '../utils/libraryEngine'
import { expiryState, needsReorder } from '../utils/inventoryEngine'
import { effectiveSections } from '../utils/noDuesEngine'
import { Todo } from './AccountsDesk'

export default function OperationsDesk() {
  const { user } = useAuth()
  const cid = useCollegeId()
  const { healClaims, hasHealed } = useOfficeSelfHeal()
  const today = todayIso()
  const loansQ = useQuery({ queryKey: ['opsDesk', cid, 'loans'], queryFn: fetchActiveLoans, enabled: !!cid, staleTime: 60 * 1000 })
  const resQ = useQuery({ queryKey: ['opsDesk', cid, 'res'], queryFn: fetchOpenReservations, enabled: !!cid, staleTime: 60 * 1000 })
  const ndQ = useQuery({ queryKey: ['opsDesk', cid, 'nodues'], queryFn: async () => ({ reqs: await fetchNoDuesRequests(cid), s: await fetchNoDuesSettings(cid) }), enabled: !!cid, staleTime: 60 * 1000 })
  const itemsQ = useItems()
  const assetsQ = useAssets()
  const { settings: inv } = useInventorySettings()
  const prsQ = usePurchaseRequests()
  const posQ = usePurchaseOrders()

  const loans = loansQ.data || []
  const overdue = loans.filter(l => loanState(l.dueDate, today) === 'overdue')
  const dueToday = loans.filter(l => l.dueDate === today)
  const reservations = resQ.data || []
  const ready = reservations.filter(r => r.status === 'ready')
  const reorder = (itemsQ.data || []).filter(i => i.active && needsReorder(i))
  const assets = (assetsQ.data || []).filter(a => !['disposed', 'lost'].includes(a.status))
  const repair = assets.filter(a => a.status === 'under_repair')
  const amc = assets.filter(a => ['expiring', 'expired'].includes(expiryState(a.amcUntil, today, inv.expiryAlertDays)))
  const toOrder = (prsQ.data || []).filter(p => p.status === 'approved')
  const openPos = (posQ.data || []).filter(p => ['issued', 'partial'].includes(p.status))
  const latePos = openPos.filter(p => p.deliveryBy && p.deliveryBy < today)
  const noDuesMine = (ndQ.data?.reqs || []).filter(r => r.status === 'open' && effectiveSections(ndQ.data!.s.sections, r.sections).some(s => s.ownerRole === 'operations' && s.status !== 'cleared'))
  const readyNd = (ndQ.data?.reqs || []).filter(r => r.status === 'cleared')

  const links = [
    { to: '/admin/library/desk', label: 'Issue & return desk', icon: <ArrowLeftRight className="w-4 h-4" /> },
    { to: '/admin/library', label: 'Library', icon: <Library className="w-4 h-4" /> },
    { to: '/admin/hostel', label: 'Hostel', icon: <BedDouble className="w-4 h-4" /> },
    { to: '/admin/transport', label: 'Transport', icon: <Bus className="w-4 h-4" /> },
    { to: '/admin/inventory', label: 'Inventory & assets', icon: <Boxes className="w-4 h-4" /> },
    { to: '/admin/purchase-orders', label: 'Purchase orders', icon: <ClipboardList className="w-4 h-4" /> },
    { to: '/admin/purchase-requests', label: 'Purchase requests', icon: <ShoppingCart className="w-4 h-4" /> },
    { to: '/admin/no-dues', label: 'No-dues', icon: <ShieldCheck className="w-4 h-4" /> },
  ]

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <PageHeader title="Operations Desk" subtitle={`Library, stores and purchasing${user?.name ? ` — ${user.name.split(' ')[0]}` : ''}`} icon={<LayoutDashboard className="w-5 h-5" />} />
      <OfficeReadError
        desk="operations desk"
        healAttempted={hasHealed}
        collegeId={cid}
        errors={[loansQ, resQ, ndQ, itemsQ, assetsQ, prsQ, posQ]}
        onRetry={async () => {
          // The rules authorise these reads from the token, so a retry on an
          // unrepaired stale claim just fails identically. Repair first.
          await healClaims()
          void loansQ.refetch(); void resQ.refetch(); void ndQ.refetch()
          void itemsQ.refetch(); void assetsQ.refetch(); void prsQ.refetch(); void posQ.refetch()
        }}
      />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard label="Books on loan" value={loansQ.isLoading ? '…' : loans.length} icon={<BookOpen className="w-5 h-5" />} hint={`${overdue.length} overdue · ${dueToday.length} due today`} tone={overdue.length ? 'text-amber-500' : undefined} />
        <StatCard label="Reservations" value={reservations.length} icon={<Library className="w-5 h-5" />} hint={`${ready.length} ready for pickup`} />
        <StatCard label="Stock below reorder" value={reorder.length} icon={<Boxes className="w-5 h-5" />} tone={reorder.length ? 'text-red-500' : undefined} />
        <StatCard label="Open purchase orders" value={openPos.length} icon={<PackageCheck className="w-5 h-5" />} hint={`${latePos.length} past delivery date`} />
      </div>
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-3">
          <h3 className="font-semibold">To do</h3>
          <Todo show={overdue.length > 0} to="/admin/library/desk" text={`${overdue.length} overdue book(s) — send reminders or collect fines`} danger />
          <Todo show={ready.length > 0} to="/admin/library" text={`${ready.length} reserved book(s) waiting for pickup`} />
          <Todo show={toOrder.length > 0} to="/admin/purchase-orders" text={`${toOrder.length} approved request(s) need a purchase order`} />
          <Todo show={latePos.length > 0} to="/admin/purchase-orders" text={`${latePos.length} purchase order(s) past delivery date — follow up with vendors`} danger />
          <Todo show={reorder.length > 0} to="/admin/inventory/stock" text={`${reorder.length} stores item(s) at or below reorder level`} />
          <Todo show={repair.length > 0} to="/admin/inventory/assets" text={`${repair.length} asset(s) under repair`} />
          <Todo show={amc.length > 0} to="/admin/inventory/assets" text={`${amc.length} AMC(s) expiring or expired`} />
          <Todo show={noDuesMine.length > 0} to="/admin/no-dues" text={`${noDuesMine.length} no-dues request(s) need operations clearance`} />
          <Todo show={readyNd.length > 0} to="/admin/no-dues" text={`${readyNd.length} no-dues certificate(s) ready to issue`} />
        </div>
        <div className="space-y-2">
          <h3 className="font-semibold">Go to</h3>
          {links.map(l => <Link key={l.to} to={l.to} className={`${btn.ghost} w-full justify-between`}><span className="flex items-center gap-2">{l.icon}{l.label}</span><ArrowRight className="w-4 h-4" /></Link>)}
          <Link to="/admin/inventory/assets" className={`${btn.ghost} w-full justify-between`}><span className="flex items-center gap-2"><Wrench className="w-4 h-4" />Maintenance</span><ArrowRight className="w-4 h-4" /></Link>
        </div>
      </div>
    </div>
  )
}
