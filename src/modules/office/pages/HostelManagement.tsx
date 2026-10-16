// /admin/hostel — hostel blocks, rooms and bed allocation (Operations team + principal).

import { useMemo, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { BedDouble, Building2, DoorOpen, Download, Plus, Sparkles, UserMinus, Wrench } from 'lucide-react'
import { Badge, Empty, Field, Loading, Modal, OfficeReadError, PageHeader, PillTabs, StatCard, btn, downloadCsv, errMsg } from '../components/officeUi'
import { hostelKeys, useActiveStudents, useHostelAllocations, useHostelBlocks, useHostelRooms } from '../hooks/useHostelTransport'
import { useCollegeId } from '../hooks/useLibrary'
import {
  allocateHostelBed,
  applyHostelPlan,
  saveHostelBlock,
  saveHostelRoom,
  vacateHostelBed,
  type HostelAllocation,
} from '../api/hostelApi'
import {
  HOSTEL_GENDER_LABEL,
  allocateHostelRooms,
  freeBeds,
  normaliseGender,
  summariseHostel,
  type HostelApplicant,
  type HostelBlock,
  type HostelGender,
  type HostelPlan,
  type HostelRoom,
} from '../utils/hostelEngine'
import type { Student } from '@/modules/admin/api/dashboardApi'

type StudentRow = Student & { gender?: string }

/** createdAt can be a string or a Firestore Timestamp; the planner needs text. */
function dateText(v: unknown): string {
  if (typeof v === 'string') return v
  if (v && typeof (v as { toDate?: unknown }).toDate === 'function') return (v as { toDate: () => Date }).toDate().toISOString()
  return ''
}

export default function HostelManagement() {
  const cid = useCollegeId()
  const qc = useQueryClient()
  const blocksQ = useHostelBlocks()
  const roomsQ = useHostelRooms()
  const allocQ = useHostelAllocations()
  const studentsQ = useActiveStudents()
  const [notice, setNotice] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null)
  const [blockOpen, setBlockOpen] = useState(false)
  const [roomOpen, setRoomOpen] = useState(false)
  const [allocOpen, setAllocOpen] = useState(false)
  const [autoOpen, setAutoOpen] = useState(false)

  const blocks = blocksQ.data || []
  const rooms = roomsQ.data || []
  const allocations = allocQ.data || []
  const summary = useMemo(() => summariseHostel(rooms), [rooms])
  const allocatedIds = useMemo(() => new Set(allocations.map(a => a.studentId)), [allocations])
  const students = (studentsQ.data || []) as StudentRow[]

  const refresh = () => {
    qc.invalidateQueries({ queryKey: hostelKeys.rooms(cid) })
    qc.invalidateQueries({ queryKey: hostelKeys.allocations(cid) })
    qc.invalidateQueries({ queryKey: hostelKeys.blocks(cid) })
  }

  const act = async (fn: () => Promise<string>) => {
    setNotice(null)
    try {
      setNotice({ tone: 'ok', text: await fn() })
      refresh()
    } catch (e) {
      setNotice({ tone: 'err', text: errMsg(e) })
    }
  }

  const toggleMaintenance = (room: HostelRoom) =>
    act(async () => {
      const next = room.status === 'active' ? 'maintenance' : 'active'
      await saveHostelRoom({ id: room.id, blockId: room.blockId, blockName: room.blockName, gender: room.gender, roomNo: room.roomNo, capacity: room.capacity, status: next }, cid)
      return `Room ${room.blockName} ${room.roomNo} set to ${next}`
    })

  const vacate = (a: HostelAllocation) =>
    act(async () => {
      if (!window.confirm(`Vacate ${a.studentName} from ${a.blockName} ${a.roomNo}?`)) return 'Cancelled'
      await vacateHostelBed(a.studentId, cid)
      return `${a.studentName} has vacated the bed`
    })

  if (blocksQ.isLoading || roomsQ.isLoading || allocQ.isLoading) return <Loading />
  if (blocksQ.isError || roomsQ.isError || allocQ.isError) {
    return <OfficeReadError errors={[blocksQ, roomsQ, allocQ]} collegeId={cid} desk="hostel" onRetry={refresh} />
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5">
      <PageHeader
        title="Hostel"
        subtitle="Blocks, rooms and bed allocation. Boys and girls are never placed in the same block."
        icon={<BedDouble className="w-5 h-5" />}
        actions={<>
          <button className={btn.ghost} onClick={() => setBlockOpen(true)}><Building2 className="w-4 h-4" /> Add block</button>
          <button className={btn.ghost} onClick={() => setRoomOpen(true)} disabled={blocks.length === 0}><DoorOpen className="w-4 h-4" /> Add room</button>
          <button className={btn.ghost} onClick={() => setAutoOpen(true)} disabled={rooms.length === 0}><Sparkles className="w-4 h-4" /> Auto-place</button>
          <button className={btn.primary} onClick={() => setAllocOpen(true)} disabled={rooms.length === 0}><Plus className="w-4 h-4" /> Allocate bed</button>
        </>}
      />

      {notice && (
        <div role="status" className={`glass-card p-3 text-sm ${notice.tone === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>{notice.text}</div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {(['male', 'female'] as HostelGender[]).map(g => (
          <StatCard key={g} label={`${HOSTEL_GENDER_LABEL[g]} — beds`} value={`${summary[g].occupied} / ${summary[g].beds}`} icon={<BedDouble className="w-5 h-5" />} hint={`${summary[g].free} free · ${summary[g].rooms} rooms`} />
        ))}
        <StatCard label="Rooms in maintenance" value={rooms.filter(r => r.status === 'maintenance').length} icon={<Wrench className="w-5 h-5" />} tone="text-amber-500" />
        <StatCard label="Students housed" value={allocations.length} icon={<BedDouble className="w-5 h-5" />} />
      </div>

      <section className="glass-card p-4">
        <p className="font-medium text-slate-900 dark:text-white mb-3">Rooms</p>
        {rooms.length === 0 ? (
          <Empty icon={<DoorOpen className="w-6 h-6" />} title="No rooms yet" hint="Add a block first, then add rooms to it." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-vriddhi-muted">
                <tr><th className="py-2">Block</th><th>Room</th><th>Gender</th><th>Beds</th><th>Free</th><th>Status</th><th /></tr>
              </thead>
              <tbody className="divide-y divide-vriddhi-border/60">
                {rooms.map(r => (
                  <tr key={r.id}>
                    <td className="py-2">{r.blockName}</td>
                    <td>{r.roomNo}</td>
                    <td>{HOSTEL_GENDER_LABEL[r.gender]}</td>
                    <td>{r.occupied} / {r.capacity}</td>
                    <td>{freeBeds(r)}</td>
                    <td>{r.status === 'active' ? <Badge tone="green">Active</Badge> : <Badge tone="amber">Maintenance</Badge>}</td>
                    <td className="text-right">
                      <button className={btn.small} onClick={() => toggleMaintenance(r)} disabled={r.status === 'active' && r.occupied > 0}
                        title={r.status === 'active' && r.occupied > 0 ? 'Vacate beds before putting this room into maintenance' : undefined}>
                        {r.status === 'active' ? 'Mark maintenance' : 'Reopen'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="glass-card p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="font-medium text-slate-900 dark:text-white">Bed allocations</p>
          <button className={btn.small} onClick={() => downloadCsv('hostel-allocations.csv', allocations.map(a => ({ regNo: a.regNo, name: a.studentName, block: a.blockName, room: a.roomNo, gender: a.gender })))} disabled={allocations.length === 0}>
            <Download className="w-3.5 h-3.5" /> CSV
          </button>
        </div>
        {allocations.length === 0 ? (
          <Empty title="No students housed yet" hint="Use Allocate bed or Auto-place." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-vriddhi-muted">
                <tr><th className="py-2">Reg no</th><th>Student</th><th>Block</th><th>Room</th><th /></tr>
              </thead>
              <tbody className="divide-y divide-vriddhi-border/60">
                {allocations.map(a => (
                  <tr key={a.id}>
                    <td className="py-2">{a.regNo}</td>
                    <td>{a.studentName}</td>
                    <td>{a.blockName}</td>
                    <td>{a.roomNo}</td>
                    <td className="text-right"><button className={btn.small} onClick={() => vacate(a)}><UserMinus className="w-3.5 h-3.5" /> Vacate</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <BlockModal open={blockOpen} onClose={() => setBlockOpen(false)} cid={cid} onSaved={msg => { setBlockOpen(false); setNotice({ tone: 'ok', text: msg }); refresh() }} />
      <RoomModal open={roomOpen} onClose={() => setRoomOpen(false)} cid={cid} blocks={blocks} onSaved={msg => { setRoomOpen(false); setNotice({ tone: 'ok', text: msg }); refresh() }} />
      <AllocateModal open={allocOpen} onClose={() => setAllocOpen(false)} cid={cid} students={students} rooms={rooms} allocatedIds={allocatedIds}
        onDone={msg => { setAllocOpen(false); setNotice({ tone: 'ok', text: msg }); refresh() }} />
      <AutoPlaceModal open={autoOpen} onClose={() => setAutoOpen(false)} cid={cid} students={students} rooms={rooms} allocatedIds={allocatedIds}
        onDone={msg => { setAutoOpen(false); setNotice({ tone: 'ok', text: msg }); refresh() }} />
    </div>
  )
}

function BlockModal({ open, onClose, cid, onSaved }: { open: boolean; onClose: () => void; cid: string; onSaved: (msg: string) => void }) {
  const [name, setName] = useState('')
  const [gender, setGender] = useState<HostelGender>('male')
  const [warden, setWarden] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr(''); setBusy(true)
    try {
      await saveHostelBlock({ name, gender, warden, active: true }, cid)
      setName(''); setWarden('')
      onSaved(`Block ${name.trim()} added`)
    } catch (e2) { setErr(errMsg(e2)) } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add hostel block" footer={<button className={btn.primary} form="block-form" disabled={busy}>Save block</button>}>
      <form id="block-form" onSubmit={submit} className="space-y-3">
        <Field label="Block name"><input className="input-field w-full" value={name} onChange={e => setName(e.target.value)} required placeholder="e.g. Block A" /></Field>
        <Field label="For"><select className="input-field w-full" value={gender} onChange={e => setGender(e.target.value as HostelGender)}><option value="male">Boys</option><option value="female">Girls</option></select></Field>
        <Field label="Warden (optional)"><input className="input-field w-full" value={warden} onChange={e => setWarden(e.target.value)} /></Field>
        {err && <p className="text-sm text-red-500">{err}</p>}
      </form>
    </Modal>
  )
}

function RoomModal({ open, onClose, cid, blocks, onSaved }: { open: boolean; onClose: () => void; cid: string; blocks: HostelBlock[]; onSaved: (msg: string) => void }) {
  const [blockId, setBlockId] = useState('')
  const [roomNo, setRoomNo] = useState('')
  const [capacity, setCapacity] = useState(2)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const block = blocks.find(b => b.id === (blockId || blocks[0]?.id))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!block) return
    setErr(''); setBusy(true)
    try {
      await saveHostelRoom({ blockId: block.id, blockName: block.name, gender: block.gender, roomNo, capacity, status: 'active' }, cid)
      setRoomNo('')
      onSaved(`Room ${roomNo.trim()} added to ${block.name}`)
    } catch (e2) { setErr(errMsg(e2)) } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add room" footer={<button className={btn.primary} form="room-form" disabled={busy || !block}>Save room</button>}>
      <form id="room-form" onSubmit={submit} className="space-y-3">
        <Field label="Block" hint="A room takes the gender of its block.">
          <select className="input-field w-full" value={block?.id || ''} onChange={e => setBlockId(e.target.value)}>
            {blocks.map(b => <option key={b.id} value={b.id}>{b.name} ({HOSTEL_GENDER_LABEL[b.gender]})</option>)}
          </select>
        </Field>
        <Field label="Room number"><input className="input-field w-full" value={roomNo} onChange={e => setRoomNo(e.target.value)} required placeholder="e.g. 101" /></Field>
        <Field label="Beds"><input type="number" min={1} className="input-field w-full" value={capacity} onChange={e => setCapacity(Number(e.target.value))} required /></Field>
        {err && <p className="text-sm text-red-500">{err}</p>}
      </form>
    </Modal>
  )
}

function AllocateModal({ open, onClose, cid, students, rooms, allocatedIds, onDone }: {
  open: boolean; onClose: () => void; cid: string; students: StudentRow[]; rooms: HostelRoom[]; allocatedIds: Set<string>; onDone: (msg: string) => void
}) {
  const [studentId, setStudentId] = useState('')
  const [roomId, setRoomId] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const student = students.find(s => s.id === studentId)
  const gender = student ? normaliseGender(student.gender) : null
  const eligibleRooms = gender ? rooms.filter(r => r.gender === gender && freeBeds(r) > 0) : []
  const eligibleStudents = students.filter(s => !allocatedIds.has(s.id))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!student) return
    setErr(''); setBusy(true)
    try {
      await allocateHostelBed({ studentId: student.id, name: student.name, regNo: student.regNo, gender: student.gender }, roomId, cid)
      setStudentId(''); setRoomId('')
      onDone(`${student.name} allocated`)
    } catch (e2) { setErr(errMsg(e2)) } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title="Allocate bed" footer={<button className={btn.primary} form="alloc-form" disabled={busy || !student || !roomId}>Allocate</button>}>
      <form id="alloc-form" onSubmit={submit} className="space-y-3">
        <Field label="Student">
          <select className="input-field w-full" value={studentId} onChange={e => { setStudentId(e.target.value); setRoomId('') }} required>
            <option value="">Select student</option>
            {eligibleStudents.map(s => <option key={s.id} value={s.id}>{s.regNo} — {s.name}</option>)}
          </select>
        </Field>
        {student && !gender && <p className="text-sm text-amber-600 dark:text-amber-400">Gender is not recorded for this student, so they cannot be placed. Update the student record first.</p>}
        {gender && (
          <Field label="Room" hint={`Showing ${HOSTEL_GENDER_LABEL[gender].toLowerCase()} rooms with a free bed`}>
            <select className="input-field w-full" value={roomId} onChange={e => setRoomId(e.target.value)} required>
              <option value="">Select room</option>
              {eligibleRooms.map(r => <option key={r.id} value={r.id}>{r.blockName} · {r.roomNo} ({freeBeds(r)} free)</option>)}
            </select>
          </Field>
        )}
        {err && <p className="text-sm text-red-500">{err}</p>}
      </form>
    </Modal>
  )
}

function AutoPlaceModal({ open, onClose, cid, students, rooms, allocatedIds, onDone }: {
  open: boolean; onClose: () => void; cid: string; students: StudentRow[]; rooms: HostelRoom[]; allocatedIds: Set<string>; onDone: (msg: string) => void
}) {
  const [picked, setPicked] = useState<Record<string, { distanceKm: string }>>({})
  const [plan, setPlan] = useState<HostelPlan | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState<'all' | HostelGender>('all')
  const candidates = students.filter(s => !allocatedIds.has(s.id))
  const visible = candidates.filter(s => filter === 'all' || normaliseGender(s.gender) === filter)
  const visibleTicked = visible.filter(s => picked[s.id]).length
  const allVisibleTicked = visible.length > 0 && visibleTicked === visible.length

  /** Ticks every visible student, or clears them if they are all ticked already. */
  const toggleAllVisible = () => {
    setPlan(null)
    setPicked(p => {
      const next = { ...p }
      if (allVisibleTicked) {
        for (const s of visible) delete next[s.id]
      } else {
        for (const s of visible) if (!next[s.id]) next[s.id] = { distanceKm: '' }
      }
      return next
    })
  }

  const toApplicants = (): HostelApplicant[] =>
    candidates.filter(s => picked[s.id]).map(s => ({
      studentId: s.id,
      name: s.name,
      regNo: s.regNo,
      gender: s.gender,
      distanceKm: Number(picked[s.id].distanceKm) || 0,
      appliedAt: dateText(s.createdAt),
    }))

  const preview = () => {
    setErr('')
    const p = allocateHostelRooms(toApplicants(), rooms, allocatedIds)
    setPlan(p)
  }

  const apply = async () => {
    if (!plan) return
    setBusy(true); setErr('')
    try {
      const res = await applyHostelPlan(plan, cid)
      const notPlaced = res.failed.length > 0
        ? ` ${res.failed.length} not placed: ${res.failed.map(f => `${f.name} (${f.reason})`).join('; ')}.`
        : ''
      setPlan(null); setPicked({})
      onDone(`${res.placed} student(s) placed.${notPlaced}`)
    } catch (e) { setErr(errMsg(e)) } finally { setBusy(false) }
  }

  const toggle = (id: string) => {
    setPlan(null)
    setPicked(p => {
      const next = { ...p }
      if (next[id]) delete next[id]; else next[id] = { distanceKm: '' }
      return next
    })
  }

  return (
    <Modal open={open} onClose={onClose} title="Auto-place students" wide
      footer={plan
        ? <button className={btn.primary} onClick={apply} disabled={busy || plan.assignments.length === 0}>Apply {plan.assignments.length} allocation(s)</button>
        : <button className={btn.primary} onClick={preview} disabled={Object.keys(picked).length === 0}>Preview plan</button>}>
      <div className="space-y-3">
        <p className="text-xs text-vriddhi-muted">Tick students and enter distance from home (km). Farther students are placed first, then earlier applicants. The preview books nothing until you apply.</p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PillTabs<'all' | HostelGender>
            value={filter}
            onChange={setFilter}
            options={[
              { id: 'all', label: 'All', count: candidates.length },
              { id: 'male', label: 'Boys', count: candidates.filter(s => normaliseGender(s.gender) === 'male').length },
              { id: 'female', label: 'Girls', count: candidates.filter(s => normaliseGender(s.gender) === 'female').length },
            ]}
          />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={allVisibleTicked} onChange={toggleAllVisible} disabled={visible.length === 0} aria-label="Select all shown students" />
            Select all shown ({visibleTicked}/{visible.length})
          </label>
        </div>
        <div className="max-h-72 overflow-y-auto divide-y divide-vriddhi-border/60">
          {visible.map(s => (
            <div key={s.id} className="py-2 flex items-center gap-3 text-sm">
              <input type="checkbox" checked={!!picked[s.id]} onChange={() => toggle(s.id)} aria-label={`Select ${s.name}`} />
              <span className="flex-1 min-w-0 truncate">{s.regNo} — {s.name} <span className="text-vriddhi-muted">{normaliseGender(s.gender) ? `· ${HOSTEL_GENDER_LABEL[normaliseGender(s.gender)!]}` : '· gender missing'}</span></span>
              {picked[s.id] && (
                <input type="number" min={0} step="0.1" className="input-field w-24" placeholder="km" aria-label={`Distance for ${s.name}`}
                  value={picked[s.id].distanceKm} onChange={e => { setPlan(null); setPicked(p => ({ ...p, [s.id]: { distanceKm: e.target.value } })) }} />
              )}
            </div>
          ))}
          {candidates.length === 0 && <p className="py-4 text-sm text-vriddhi-muted">Every active student already has a bed.</p>}
          {candidates.length > 0 && visible.length === 0 && <p className="py-4 text-sm text-vriddhi-muted">No students in this filter.</p>}
        </div>
        {plan && (
          <div className="glass-card p-3 text-sm space-y-2">
            <p className="font-medium">Plan: {plan.assignments.length} placed, {plan.unplaced.length} not placed</p>
            <ul className="divide-y divide-vriddhi-border/60 max-h-48 overflow-y-auto">
              {plan.assignments.map(a => <li key={a.studentId} className="py-1">{a.studentName} → {a.blockName} · {a.roomNo}</li>)}
              {plan.unplaced.map(u => <li key={u.studentId} className="py-1 text-amber-600 dark:text-amber-400">{u.studentName}: {u.reason}</li>)}
            </ul>
          </div>
        )}
        {err && <p className="text-sm text-red-500">{err}</p>}
      </div>
    </Modal>
  )
}
