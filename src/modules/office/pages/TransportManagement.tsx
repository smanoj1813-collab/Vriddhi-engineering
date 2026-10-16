// /admin/transport — bus routes, stops and student enrolment (Operations team + principal).

import { useMemo, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Bus, Plus, Trash2, UserMinus, UserPlus } from 'lucide-react'
import { Badge, Empty, Field, Loading, Modal, OfficeReadError, PageHeader, StatCard, btn, errMsg, inr } from '../components/officeUi'
import { transportKeys, useActiveStudents, useTransportEnrolments, useTransportRoutes } from '../hooks/useHostelTransport'
import { useCollegeId } from '../hooks/useLibrary'
import { enrolTransport, removeTransportEnrolment, saveTransportRoute, type TransportRouteInput } from '../api/transportApi'
import { canEnrol, orderedStops, routeSeatsLeft, summariseTransport, type TransportEnrolment, type TransportRoute } from '../utils/transportEngine'
import type { Student } from '@/modules/admin/api/dashboardApi'

export default function TransportManagement() {
  const cid = useCollegeId()
  const qc = useQueryClient()
  const routesQ = useTransportRoutes()
  const enrQ = useTransportEnrolments()
  const studentsQ = useActiveStudents()
  const [notice, setNotice] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null)
  const [routeEdit, setRouteEdit] = useState<TransportRoute | 'new' | null>(null)
  const [enrolOpen, setEnrolOpen] = useState(false)

  const routes = routesQ.data || []
  const enrolments = enrQ.data || []
  const summary = useMemo(() => summariseTransport(routes, enrolments), [routes, enrolments])
  const students = (studentsQ.data || []) as Array<Student & { gender?: string }>

  const refresh = () => {
    qc.invalidateQueries({ queryKey: transportKeys.routes(cid) })
    qc.invalidateQueries({ queryKey: transportKeys.enrolments(cid) })
  }

  const remove = async (e: TransportEnrolment) => {
    setNotice(null)
    if (!window.confirm(`Remove ${e.studentName} from ${e.routeName}?`)) return
    try {
      await removeTransportEnrolment(e.studentId, cid)
      setNotice({ tone: 'ok', text: `${e.studentName} removed from ${e.routeName}` })
      refresh()
    } catch (err) { setNotice({ tone: 'err', text: errMsg(err) }) }
  }

  if (routesQ.isLoading || enrQ.isLoading) return <Loading />
  if (routesQ.isError || enrQ.isError) {
    return <OfficeReadError errors={[routesQ, enrQ]} collegeId={cid} desk="transport" onRetry={refresh} />
  }

  const totalSeats = routes.filter(r => r.active).reduce((s, r) => s + r.capacity, 0)
  const totalFree = routes.reduce((s, r) => s + routeSeatsLeft(r), 0)
  const overCap = summary.filter(s => s.overCapacity).length
  const mismatch = routes.filter(r => r.enrolled !== enrolments.filter(e => e.routeId === r.id).length).length

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5">
      <PageHeader
        title="Transport"
        subtitle="Routes, stops and student enrolment. Seats are checked before every enrolment."
        icon={<Bus className="w-5 h-5" />}
        actions={<>
          <button className={btn.primary} onClick={() => setRouteEdit('new')}><Plus className="w-4 h-4" /> Add route</button>
          <button className={btn.ghost} onClick={() => setEnrolOpen(true)} disabled={routes.length === 0}><UserPlus className="w-4 h-4" /> Enrol student</button>
        </>}
      />

      {notice && (
        <div role="status" className={`glass-card p-3 text-sm ${notice.tone === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>{notice.text}</div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Active routes" value={routes.filter(r => r.active).length} icon={<Bus className="w-5 h-5" />} hint={`${totalSeats} seats in total`} />
        <StatCard label="Students enrolled" value={enrolments.length} icon={<UserPlus className="w-5 h-5" />} />
        <StatCard label="Seats free" value={totalFree} icon={<Bus className="w-5 h-5" />} tone="text-blue-500" />
        <StatCard label="Routes needing attention" value={overCap + mismatch} icon={<Bus className="w-5 h-5" />} tone="text-amber-500" hint={overCap || mismatch ? `${overCap} over capacity · ${mismatch} count mismatch` : 'All routes healthy'} />
      </div>

      {routes.length === 0 ? (
        <Empty icon={<Bus className="w-6 h-6" />} title="No routes yet" hint="Add a route with its vehicle, driver, seats and stops." action={<button className={btn.primary} onClick={() => setRouteEdit('new')}>Add route</button>} />
      ) : (
        <div className="grid lg:grid-cols-2 gap-4">
          {routes.map(route => {
            const s = summary.find(x => x.routeId === route.id)!
            const mine = enrolments.filter(e => e.routeId === route.id).sort((a, b) => a.stopName.localeCompare(b.stopName) || a.regNo.localeCompare(b.regNo, undefined, { numeric: true }))
            const mismatchHere = route.enrolled !== mine.length
            return (
              <section key={route.id} className="glass-card p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900 dark:text-white truncate">{route.name}</p>
                    <p className="text-xs text-vriddhi-muted">{route.vehicleNo} · {route.driver || 'No driver'}{route.driverPhone ? ` · ${route.driverPhone}` : ''}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {!route.active && <Badge tone="slate">Inactive</Badge>}
                    {s.overCapacity && <Badge tone="red">Over capacity</Badge>}
                    {mismatchHere && <Badge tone="amber">Count mismatch</Badge>}
                    <button className={btn.small} onClick={() => setRouteEdit(route)}>Edit</button>
                  </div>
                </div>
                <p className="text-sm"><span className="font-medium">{s.enrolled}</span> / {route.capacity} seats used · <span className="text-vriddhi-muted">{routeSeatsLeft(route)} free</span></p>
                <ul className="divide-y divide-vriddhi-border/60 text-sm">
                  {orderedStops(route).map((st, i) => (
                    <li key={st.id} className="py-1.5 flex justify-between gap-2">
                      <span>{i + 1}. {st.name}</span>
                      <span className="text-vriddhi-muted whitespace-nowrap">{inr(st.annualFee)}/yr · {s.stops.find(x => x.stopId === st.id)?.count ?? 0} riders</span>
                    </li>
                  ))}
                </ul>
                {mine.length > 0 && (
                  <details>
                    <summary className="text-sm cursor-pointer text-vriddhi-accent">Riders ({mine.length})</summary>
                    <ul className="mt-2 divide-y divide-vriddhi-border/60 text-sm">
                      {mine.map(e => (
                        <li key={e.studentId} className="py-1.5 flex justify-between items-center gap-2">
                          <span className="min-w-0 truncate">{e.regNo} — {e.studentName} <span className="text-vriddhi-muted">· {e.stopName}</span></span>
                          <button className={btn.small} onClick={() => remove(e)}><UserMinus className="w-3.5 h-3.5" /> Remove</button>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </section>
            )
          })}
        </div>
      )}

      <RouteModal key={routeEdit === 'new' ? 'new' : routeEdit?.id ?? 'closed'} route={routeEdit} enrolments={enrolments} cid={cid}
        onClose={() => setRouteEdit(null)}
        onSaved={msg => { setRouteEdit(null); setNotice({ tone: 'ok', text: msg }); refresh() }} />
      <EnrolModal open={enrolOpen} onClose={() => setEnrolOpen(false)} cid={cid} routes={routes} enrolments={enrolments} students={students}
        onDone={msg => { setEnrolOpen(false); setNotice({ tone: 'ok', text: msg }); refresh() }} />
    </div>
  )
}

interface StopDraft { id: string; name: string; annualFee: string }

const newStopId = () => `stop-${Math.random().toString(36).slice(2, 8)}`

function RouteModal({ route, enrolments, cid, onClose, onSaved }: {
  route: TransportRoute | 'new' | null; enrolments: TransportEnrolment[]; cid: string; onClose: () => void; onSaved: (msg: string) => void
}) {
  const editing = route && route !== 'new' ? route : null
  const [name, setName] = useState(editing?.name ?? '')
  const [vehicleNo, setVehicleNo] = useState(editing?.vehicleNo ?? '')
  const [driver, setDriver] = useState(editing?.driver ?? '')
  const [driverPhone, setDriverPhone] = useState(editing?.driverPhone ?? '')
  const [capacity, setCapacity] = useState(editing?.capacity ?? 40)
  const [active, setActive] = useState(editing?.active ?? true)
  const [stops, setStops] = useState<StopDraft[]>(() => (editing ? orderedStops(editing) : []).map(s => ({ id: s.id, name: s.name, annualFee: String(s.annualFee) })))
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  if (!route) return null
  const enrolledOnStop = (stopId: string) => enrolments.filter(e => e.routeId === editing?.id && e.stopId === stopId).length
  const move = (i: number, d: -1 | 1) => setStops(list => {
    const j = i + d
    if (j < 0 || j >= list.length) return list
    const next = [...list]; [next[i], next[j]] = [next[j], next[i]]; return next
  })

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr(''); setBusy(true)
    const input: TransportRouteInput = {
      id: editing?.id,
      name, vehicleNo, driver, driverPhone, capacity, active,
      stops: stops.map((s, i) => ({ id: s.id, name: s.name, order: i + 1, annualFee: Number(s.annualFee) || 0 })),
    }
    try {
      await saveTransportRoute(input, cid)
      onSaved(`Route ${name.trim()} saved`)
    } catch (e2) { setErr(errMsg(e2)) } finally { setBusy(false) }
  }

  return (
    <Modal open onClose={onClose} title={editing ? `Edit ${editing.name}` : 'Add route'} wide
      footer={<button className={btn.primary} form="route-form" disabled={busy}>Save route</button>}>
      <form id="route-form" onSubmit={submit} className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Route name"><input className="input-field w-full" value={name} onChange={e => setName(e.target.value)} required placeholder="e.g. Route 1 — North" /></Field>
          <Field label="Vehicle number"><input className="input-field w-full" value={vehicleNo} onChange={e => setVehicleNo(e.target.value)} required placeholder="KA 01 AB 1234" /></Field>
          <Field label="Driver"><input className="input-field w-full" value={driver} onChange={e => setDriver(e.target.value)} /></Field>
          <Field label="Driver phone"><input className="input-field w-full" value={driverPhone} onChange={e => setDriverPhone(e.target.value)} /></Field>
          <Field label="Seats"><input type="number" min={1} className="input-field w-full" value={capacity} onChange={e => setCapacity(Number(e.target.value))} required /></Field>
          <Field label="Status"><select className="input-field w-full" value={active ? 'active' : 'inactive'} onChange={e => setActive(e.target.value === 'active')}><option value="active">Active</option><option value="inactive">Inactive</option></select></Field>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Stops (pickup order)</p>
            <button type="button" className={btn.small} onClick={() => setStops(s => [...s, { id: newStopId(), name: '', annualFee: '0' }])}><Plus className="w-3.5 h-3.5" /> Add stop</button>
          </div>
          {stops.length === 0 && <p className="text-sm text-vriddhi-muted">Add at least one stop.</p>}
          {stops.map((s, i) => {
            const riders = s.id ? enrolledOnStop(s.id) : 0
            return (
              <div key={s.id} className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-vriddhi-muted w-5">{i + 1}.</span>
                <input className="input-field flex-1 min-w-[10rem]" placeholder="Stop name" aria-label={`Stop ${i + 1} name`} value={s.name}
                  onChange={e => setStops(list => list.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                <input type="number" min={0} className="input-field w-28" placeholder="Annual fee" aria-label={`Stop ${i + 1} annual fee`} value={s.annualFee}
                  onChange={e => setStops(list => list.map((x, j) => j === i ? { ...x, annualFee: e.target.value } : x))} />
                <button type="button" className={btn.small} onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp className="w-3.5 h-3.5" /></button>
                <button type="button" className={btn.small} onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown className="w-3.5 h-3.5" /></button>
                <button type="button" className={btn.small} disabled={riders > 0}
                  title={riders > 0 ? `${riders} rider(s) use this stop — remove them first` : 'Remove stop'}
                  onClick={() => setStops(list => list.filter((_, j) => j !== i))} aria-label="Remove stop"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            )
          })}
        </div>
        {err && <p className="text-sm text-red-500">{err}</p>}
      </form>
    </Modal>
  )
}

function EnrolModal({ open, onClose, cid, routes, enrolments, students, onDone }: {
  open: boolean; onClose: () => void; cid: string; routes: TransportRoute[]; enrolments: TransportEnrolment[]; students: Array<Student & { gender?: string }>; onDone: (msg: string) => void
}) {
  const [studentId, setStudentId] = useState('')
  const [routeId, setRouteId] = useState('')
  const [stopId, setStopId] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const enrolledIds = new Set(enrolments.map(e => e.studentId))
  const route = routes.find(r => r.id === routeId)
  const stop = route?.stops.find(s => s.id === stopId)
  const reason = route && stopId ? canEnrol(route, stopId) : null
  const available = students.filter(s => !enrolledIds.has(s.id))
  const student = students.find(s => s.id === studentId)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!student) return
    setErr(''); setBusy(true)
    try {
      await enrolTransport({ studentId: student.id, studentName: student.name, regNo: student.regNo }, routeId, stopId, cid)
      setStudentId(''); setRouteId(''); setStopId('')
      onDone(`${student.name} enrolled on ${route?.name} at ${stop?.name}`)
    } catch (e2) { setErr(errMsg(e2)) } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title="Enrol student on a route"
      footer={<button className={btn.primary} form="enrol-form" disabled={busy || !student || !!reason || !stopId}>Enrol</button>}>
      <form id="enrol-form" onSubmit={submit} className="space-y-3">
        <Field label="Student">
          <select className="input-field w-full" value={studentId} onChange={e => setStudentId(e.target.value)} required>
            <option value="">Select student</option>
            {available.map(s => <option key={s.id} value={s.id}>{s.regNo} — {s.name}</option>)}
          </select>
        </Field>
        <Field label="Route">
          <select className="input-field w-full" value={routeId} onChange={e => { setRouteId(e.target.value); setStopId('') }} required>
            <option value="">Select route</option>
            {routes.map(r => <option key={r.id} value={r.id}>{r.name} ({routeSeatsLeft(r)} seats free)</option>)}
          </select>
        </Field>
        {route && (
          <Field label="Stop" hint={stop ? `Annual fee ${inr(stop.annualFee)}` : undefined}>
            <select className="input-field w-full" value={stopId} onChange={e => setStopId(e.target.value)} required>
              <option value="">Select stop</option>
              {orderedStops(route).map(s => <option key={s.id} value={s.id}>{s.name} — {inr(s.annualFee)}/yr</option>)}
            </select>
          </Field>
        )}
        {reason && <p className="text-sm text-amber-600 dark:text-amber-400">{reason}</p>}
        {err && <p className="text-sm text-red-500">{err}</p>}
      </form>
    </Modal>
  )
}
