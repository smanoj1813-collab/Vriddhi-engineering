import { useState, useEffect, useMemo, useCallback } from 'react'
import AcademicInsightsDrillCard from '../components/AcademicInsightsDrillCard'
import PortalHero from '../../../shared/components/portal/PortalHero';
import { useSearchParams, useLocation } from 'react-router-dom'
import { useAuth } from '../../auth/context/AuthContext'
import { shouldScopeToDepartment, docInDepartment } from '@/shared/utils/departmentScope'
import FacultyAttendancePanel from '../components/FacultyAttendancePanel'
import FacultyAttendanceTodayCard from '../components/FacultyAttendanceTodayCard'
import { db } from '@/Firebase/config'
import {
  collection, query, where, getDocs
} from 'firebase/firestore'
import {
  Shield, Users, Building2, Settings, Activity, CheckCircle,
  Clock, Search, Filter, Plus, BarChart3, Bell,
  Lock, Eye, Trash2, Edit3, Download, Upload, RefreshCw, AlertTriangle,
  UserCheck, GraduationCap, BookOpen, Calendar, TrendingUp, MoreHorizontal,
  DollarSign, School, LogOut, User as UserIcon, BadgeCheck
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts'

// ─── Types ────────────────────────────────────────────────────────────────────
interface User {
  id: string
  name: string
  email: string
  role: 'admin' | 'hod' | 'faculty' | 'mentor' | 'student'
  department: string
  status: 'active' | 'inactive' | 'pending'
  lastActive: string
  avatar?: string
}

interface Department {
  id: string
  name: string
  code: string
  hod: string
  facultyCount: number
  studentCount: number
  avgAttendance: number
  avgScore: number
  budget: number
  courses: number
}

interface AuditLog {
  id: string
  user: string
  action: string
  target: string
  timestamp: string
  severity: 'info' | 'warning' | 'critical'
}

interface ApprovalItem {
  id: string
  type: 'user' | 'schedule' | 'assessment' | 'material' | 'budget'
  title: string
  requester: string
  department: string
  requestedAt: string
  status: 'pending' | 'approved' | 'rejected'
  amount?: number
}

interface DashboardData {
  totalUsers: number
  totalStudents: number
  totalFaculty: number
  totalMentors: number
  totalHODs: number
  avgAttendance: number
  departments: Department[]
  users: User[]
  auditLogs: AuditLog[]
  approvals: ApprovalItem[]
  loading: boolean
}

const COLORS = ['#14b8a6', '#0ea5e9', '#f59e0b', '#8b5cf6', '#ef4444']

// ─── Components ───────────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, trend, trendUp, color = 'teal' }: {
  icon: React.ElementType
  label: string
  value: string
  trend?: string
  trendUp?: boolean
  color?: 'teal' | 'sky' | 'amber' | 'violet' | 'rose' | 'emerald'
}) {
  const colorMap = {
    teal: 'bg-teal-500/10 text-teal-400',
    sky: 'bg-sky-500/10 text-sky-400',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    violet: 'bg-violet-500/10 text-violet-400',
    rose: 'bg-rose-500/10 text-rose-400',
    emerald: 'bg-emerald-500/10 text-emerald-400',
  }
  return (
    <div className="glass-card p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">{label}</p>
          <p className="text-2xl font-bold text-slate-900 dark:text-white">{value}</p>
          {trend && (
            <p className={`text-xs mt-2 flex items-center gap-1 ${trendUp ? 'text-teal-400' : 'text-rose-400'}`}>
              <TrendingUp size={12} className={trendUp ? '' : 'rotate-180'} />
              {trend}
            </p>
          )}
        </div>
        <div className={`p-3 rounded-xl ${colorMap[color]}`}>
          <Icon size={20} />
        </div>
      </div>
    </div>
  )
}

function SectionHeader({ title, icon: Icon, action }: {
  title: string
  icon: React.ElementType
  action?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between mb-6">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-teal-500/10 text-teal-600 dark:text-teal-400">
          <Icon size={20} />
        </div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-white">{title}</h2>
      </div>
      {action}
    </div>
  )
}

function Badge({ children, variant = 'default' }: { children: React.ReactNode; variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary' }) {
  const variants = {
    default: 'bg-slate-700 text-slate-300',
    success: 'bg-teal-100 dark:bg-teal-900/30 text-teal-400',
    warning: 'bg-amber-100 dark:bg-amber-900/30 text-amber-400',
    danger: 'bg-rose-500/20 text-rose-400',
    info: 'bg-sky-500/20 text-sky-400',
    primary: 'bg-violet-500/20 text-violet-400',
  }
  return (
    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${variants[variant]}`}>
      {children}
    </span>
  )
}

// ─── Safe Helpers ─────────────────────────────────────────────────────────────

function getInitials(name: string | null | undefined): string {
  if (!name || typeof name !== 'string') return '?'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return parts.map(n => n[0]).join('').toUpperCase().slice(0, 2)
}

// ─── Firestore Data Hook ──────────────────────────────────────────────────────

function useCollegeDashboardData(
  collegeId: string | undefined,
  viewer?: { role?: string; department?: string | null }
) {
  const [data, setData] = useState<DashboardData>({
    totalUsers: 0, totalStudents: 0, totalFaculty: 0, totalMentors: 0, totalHODs: 0,
    avgAttendance: 0, departments: [], users: [], auditLogs: [], approvals: [], loading: true
  })

  useEffect(() => {
    if (!collegeId) {
      setData(prev => ({ ...prev, loading: false }))
      return
    }

    let cancelled = false

    async function fetchData() {
      try {
        const [studentsSnap, facultySnap, adminsSnap] = await Promise.all([
          getDocs(query(collection(db, 'students'), where('collegeId', '==', collegeId))),
          getDocs(query(collection(db, 'faculty'), where('collegeId', '==', collegeId))),
          getDocs(query(collection(db, 'admins'), where('collegeId', '==', collegeId))),
        ])

        if (cancelled) return

        let students = studentsSnap.docs.map(d => d.data())
        let faculty = facultySnap.docs.map(d => d.data())
        let admins = adminsSnap.docs.map(d => d.data())

        // HOD/admin (≡ department head) see only their department; the
        // principal keeps the college-wide view. Tolerant of untagged rows —
        // see shared/utils/departmentScope.
        const deptScope = shouldScopeToDepartment(viewer?.role)
          ? String(viewer?.department ?? '').trim()
          : ''
        if (deptScope) {
          students = students.filter(s => docInDepartment(s, deptScope))
          faculty = faculty.filter(f => docInDepartment(f, deptScope))
          admins = admins.filter(a => docInDepartment(a, deptScope))
        }

        const totalStudents = students.length
        const totalFaculty = faculty.length
        const totalAdmins = admins.length
        const totalHODs = admins.filter((a: any) => a.role === 'hod').length
        const totalMentors = admins.filter((a: any) => a.role === 'mentor').length

        const deptMap: Record<string, { name: string; code: string; faculty: number; students: number }> = {}
        faculty.forEach((f: any) => {
          const dept = f.department || 'General'
          if (!deptMap[dept]) deptMap[dept] = { name: dept, code: dept, faculty: 0, students: 0 }
          deptMap[dept].faculty++
        })
        students.forEach((s: any) => {
          const dept = s.department || 'General'
          if (!deptMap[dept]) deptMap[dept] = { name: dept, code: dept, faculty: 0, students: 0 }
          deptMap[dept].students++
        })

        const departments: Department[] = Object.entries(deptMap).map(([code, info], idx) => ({
          id: String(idx + 1),
          name: info.name,
          code,
          hod: (faculty.find((f: any) => f.department === code && f.isHOD)?.firstName as string) || 'TBD',
          facultyCount: info.faculty,
          studentCount: info.students,
          avgAttendance: 0,
          avgScore: 0,
          budget: 0,
          courses: 0,
        }))

        const safeRole = (r: any): User['role'] => {
          const valid: User['role'][] = ['admin', 'hod', 'faculty', 'mentor', 'student']
          return valid.includes(r) ? r : 'admin'
        }

        const users: User[] = [
          ...admins.map((a: any, i: number) => ({
            id: a.uid || `admin-${i}`,
            name: a.name || `${a.firstName || ''} ${a.lastName || ''}`.trim() || 'Unknown',
            email: a.email || '',
            role: safeRole(a.role),
            department: a.department || 'All',
            status: (a.status || 'active') as User['status'],
            lastActive: 'Recently',
          })),
          ...faculty.map((f: any, i: number) => ({
            id: f.uid || `faculty-${i}`,
            name: `${f.firstName || ''} ${f.lastName || ''}`.trim() || 'Unknown',
            email: f.email || '',
            role: 'faculty' as User['role'],
            department: f.department || 'General',
            status: (f.status || 'active') as User['status'],
            lastActive: 'Recently',
          })),
          ...students.map((s: any, i: number) => ({
            id: s.uid || s.id || `student-${i}`,
            name: s.name || `${s.firstName || ''} ${s.lastName || ''}`.trim() || 'Unknown',
            email: s.email || '',
            role: 'student' as User['role'],
            department: s.department || s.division || 'General',
            status: (s.status || 'active') as User['status'],
            lastActive: 'Recently',
          })),
        ]

        if (!cancelled) {
          setData({
            totalUsers: totalStudents + totalFaculty + totalAdmins,
            totalStudents,
            totalFaculty,
            totalMentors,
            totalHODs,
            avgAttendance: 0,
            departments,
            users,
            auditLogs: [],
            approvals: [],
            loading: false,
          })
        }
      } catch (err) {
        console.error('Dashboard data fetch error:', err)
        if (!cancelled) setData(prev => ({ ...prev, loading: false }))
      }
    }

    fetchData()
    return () => { cancelled = true }
  }, [collegeId, viewer?.role, viewer?.department])

  return data
}

// ─── Tab Content Components ───────────────────────────────────────────────────

function UserManagement({ users, collegeId }: { users: User[]; collegeId?: string }) {
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [deptFilter, setDeptFilter] = useState('all')

  const filtered = useMemo(() => users.filter(u => {
    const matchSearch = u.name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase())
    const matchRole = roleFilter === 'all' || u.role === roleFilter
    const matchStatus = statusFilter === 'all' || u.status === statusFilter
    const matchDept = deptFilter === 'all' || u.department === deptFilter
    return matchSearch && matchRole && matchStatus && matchDept
  }), [users, search, roleFilter, statusFilter, deptFilter])

  const roleIcons: Record<string, React.ElementType> = {
    admin: Shield,
    hod: Building2,
    faculty: GraduationCap,
    mentor: UserCheck,
    student: BookOpen,
  }

  return (
    <div className="animate-fade-in">
      <SectionHeader
        title="User Management"
        icon={Users}
        action={
          <button className="btn-primary">
            <Plus size={16} />
            Add User
          </button>
        }
      />

      <div className="glass-card p-4 mb-6 flex flex-wrap items-center gap-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input type="text" placeholder="Search users..." value={search} onChange={e => setSearch(e.target.value)} className="input-field w-full pl-10" />
        </div>
        <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} className="input-field">
          <option value="all">All Roles</option>
          <option value="admin">Principal</option>
          <option value="hod">HOD</option>
          <option value="faculty">Faculty</option>
          <option value="mentor">Mentor</option>
          <option value="student">Student</option>
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input-field">
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="pending">Pending</option>
        </select>
        <button className="btn-secondary"><Filter size={16} />More Filters</button>
      </div>

      <div className="table-container">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-200/50 dark:border-slate-700/50">
              <th className="table-header">User</th>
              <th className="table-header">Role</th>
              <th className="table-header">Department</th>
              <th className="table-header">Status</th>
              <th className="table-header">Last Active</th>
              <th className="table-header text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(user => {
              const RoleIcon = roleIcons[user.role] || UserIcon
              return (
                <tr key={user.id} className="hover:bg-slate-200/30 dark:hover:bg-slate-800/30 transition-colors">
                  <td className="table-cell">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center text-teal-400 font-bold text-sm">
                        {getInitials(user.name)}
                      </div>
                      <div>
                        <p className="font-medium text-slate-900 dark:text-white">{user.name}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{user.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="table-cell">
                    <div className="flex items-center gap-2">
                      <RoleIcon size={14} className="text-slate-500" />
                      <span className="capitalize text-slate-600 dark:text-slate-300">{user.role === 'admin' ? 'Principal' : user.role}</span>
                    </div>
                  </td>
                  <td className="table-cell text-slate-600 dark:text-slate-300">{user.department}</td>
                  <td className="table-cell">
                    <Badge variant={user.status === 'active' ? 'success' : user.status === 'pending' ? 'warning' : 'danger'}>
                      {user.status}
                    </Badge>
                  </td>
                  <td className="table-cell text-slate-500 dark:text-slate-400 text-xs">{user.lastActive}</td>
                  <td className="table-cell text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button className="p-2 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 hover:text-slate-900 dark:text-white transition-colors"><Eye size={14} /></button>
                      <button className="p-2 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 hover:text-slate-900 dark:text-white transition-colors"><Edit3 size={14} /></button>
                      <button className="p-2 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 hover:text-rose-400 transition-colors"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="text-center py-8 text-slate-500 dark:text-slate-400">No users found</div>
        )}
      </div>
    </div>
  )
}

function DepartmentOverview({ departments }: { departments: Department[] }) {
  return (
    <div className="animate-fade-in">
      <SectionHeader title="Department Overview" icon={Building2} action={<button className="btn-secondary"><Download size={16} />Export Report</button>} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {departments.map(dept => (
          <div key={dept.id} className="glass-card-hover p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">{dept.name}</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">Code: {dept.code} | HOD: {dept.hod}</p>
              </div>
              <Badge variant="info">{dept.code}</Badge>
            </div>
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="text-center p-3 rounded-xl bg-slate-100/50 dark:bg-slate-900/50">
                <p className="text-xl font-bold text-slate-900 dark:text-white">{dept.facultyCount}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Faculty</p>
              </div>
              <div className="text-center p-3 rounded-xl bg-slate-100/50 dark:bg-slate-900/50">
                <p className="text-xl font-bold text-slate-900 dark:text-white">{dept.studentCount}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Students</p>
              </div>
              <div className="text-center p-3 rounded-xl bg-slate-100/50 dark:bg-slate-900/50">
                <p className="text-xl font-bold text-slate-900 dark:text-white">{dept.courses}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Courses</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {departments.length > 0 && (
        <div className="glass-card p-6">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Department Performance</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={departments}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="code" stroke="#94a3b8" fontSize={12} />
              <YAxis stroke="#94a3b8" fontSize={12} />
              <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }} labelStyle={{ color: '#e2e8f0' }} />
              <Bar dataKey="studentCount" fill="#14b8a6" name="Students" radius={[4, 4, 0, 0]} />
              <Bar dataKey="facultyCount" fill="#0ea5e9" name="Faculty" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

function ReportsAnalytics({ totalStudents, totalFaculty }: { totalStudents: number; totalFaculty: number }) {
  const roleDistribution = [
    { name: 'Students', value: totalStudents || 1 },
    { name: 'Faculty', value: totalFaculty || 1 },
    { name: 'Admin', value: 1 },
  ]

  return (
    <div className="animate-fade-in">
      <SectionHeader title="Reports & Analytics" icon={BarChart3} action={<button className="btn-primary"><Download size={16} />Generate Report</button>} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="glass-card p-6">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Role Distribution</h3>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={roleDistribution} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={4} dataKey="value">
                {roleDistribution.map((_, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
              </Pie>
              <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }} labelStyle={{ color: '#e2e8f0' }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}

function AuditLogs() {
  return (
    <div className="animate-fade-in">
      <SectionHeader title="Audit Logs" icon={Clock} />
      <div className="text-center py-12 text-slate-500 dark:text-slate-400">
        <Clock size={32} className="mx-auto mb-3 opacity-50" />
        <p>No audit logs yet</p>
      </div>
    </div>
  )
}

function SystemSettings() {
  const { user } = useAuth()
  const [settings, setSettings] = useState({
    emailNotifications: true,
    autoBackup: true,
    darkMode: true,
    maintenanceMode: false,
    twoFactorAuth: false,
    sessionTimeout: '30',
    feeReminder: true,
    attendanceAlert: true,
    autoGradePublish: false,
  })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    try {
      const raw = localStorage.getItem('vriddhi_system_settings')
      if (raw) setSettings(prev => ({ ...prev, ...JSON.parse(raw) }))
    } catch {}
    const loadFromFirestore = async () => {
      if (!user?.collegeId) return
      try {
        const { doc, getDoc } = await import('firebase/firestore')
        const { db } = await import('@/Firebase/config')
        const snap = await getDoc(doc(db, 'colleges', user.collegeId))
        if (snap.exists()) {
          const data = snap.data() as any
          if (data.systemSettings) setSettings(prev => ({ ...prev, ...data.systemSettings }))
        }
      } catch {}
    }
    loadFromFirestore()
  }, [user?.collegeId])

  const persist = async (next: typeof settings) => {
    localStorage.setItem('vriddhi_system_settings', JSON.stringify(next))
    setMsg('Saving...')
    setSaving(true)
    try {
      if (user?.collegeId) {
        const { doc, setDoc } = await import('firebase/firestore')
        const { db } = await import('@/Firebase/config')
        await setDoc(doc(db, 'colleges', user.collegeId), { systemSettings: next, updatedAt: new Date().toISOString() }, { merge: true })
        setMsg('Saved to cloud ✓')
      } else {
        setMsg('Saved locally ✓')
      }
      setTimeout(() => setMsg(null), 2000)
    } catch (e: any) {
      setMsg(`Saved locally, cloud failed: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  const toggle = (key: keyof typeof settings) => {
    const next = { ...settings, [key]: !settings[key as keyof typeof settings] } as typeof settings
    setSettings(next)
    persist(next)
  }

  const updateField = (key: keyof typeof settings, value: any) => {
    const next = { ...settings, [key]: value } as typeof settings
    setSettings(next)
    persist(next)
  }

  const items = [
    { key: 'emailNotifications' as const, label: 'Email Notifications', desc: 'Send email alerts for important events', icon: Bell },
    { key: 'feeReminder' as const, label: 'Fee Reminders', desc: 'Auto-remind students about pending fees', icon: Bell },
    { key: 'attendanceAlert' as const, label: 'Attendance Alerts', desc: 'Alert mentors when attendance drops below 75%', icon: Bell },
    { key: 'autoBackup' as const, label: 'Auto Backup', desc: 'Automatically backup data every 24 hours', icon: Settings },
    { key: 'maintenanceMode' as const, label: 'Maintenance Mode', desc: 'Put system into maintenance for updates', icon: AlertTriangle },
    { key: 'twoFactorAuth' as const, label: 'Enforce 2FA', desc: 'Require two-factor authentication for all admins', icon: Lock },
    { key: 'autoGradePublish' as const, label: 'Auto Publish Grades', desc: 'Automatically publish grades after evaluation', icon: CheckCircle },
  ]

  return (
    <div className="animate-fade-in">
      <SectionHeader title="System Settings" icon={Settings} action={msg ? <span className="text-xs font-semibold text-teal-500">{msg}</span> : null} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="glass-card p-6">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-6 flex items-center gap-2"><Bell size={18} className="text-teal-600 dark:text-teal-400" />Notifications & Automation</h3>
          <div className="space-y-5">
            {items.map(item => {
              const Icon = item.icon
              const isBool = typeof settings[item.key] === 'boolean'
              return (
                <div key={item.key} className="flex items-center justify-between p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center mt-0.5">
                      <Icon size={14} className="text-slate-500" />
                    </div>
                    <div>
                      <p className="font-medium text-slate-900 dark:text-white text-sm">{item.label}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{item.desc}</p>
                    </div>
                  </div>
                  {isBool ? (
                    <button onClick={() => toggle(item.key)} disabled={saving} className={`relative w-12 h-6 rounded-full transition-colors ${settings[item.key] ? 'bg-teal-500' : 'bg-slate-300 dark:bg-slate-700'}`}>
                      <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${settings[item.key] ? 'translate-x-6' : ''}`} />
                    </button>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>

        <div className="glass-card p-6">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-6 flex items-center gap-2"><Settings size={18} className="text-teal-600 dark:text-teal-400" />System Preferences</h3>
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-slate-900 dark:text-white text-sm">Session Timeout</p>
                <p className="text-xs text-slate-500">Auto logout after inactivity (minutes)</p>
              </div>
              <select value={settings.sessionTimeout} onChange={e => updateField('sessionTimeout', e.target.value)} className="px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm">
                <option value="15">15 min</option>
                <option value="30">30 min</option>
                <option value="60">60 min</option>
                <option value="120">120 min</option>
              </select>
            </div>

            <div className="p-4 rounded-xl bg-teal-50 dark:bg-teal-950/20 border border-teal-200 dark:border-teal-800">
              <p className="text-xs font-semibold text-teal-800 dark:text-teal-300">Quick Actions</p>
              <div className="flex flex-wrap gap-2 mt-3">
                <a href="/admin/settings" className="px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold hover:bg-teal-700 transition-colors">Open Full Settings</a>
                <button onClick={() => {
                  if (confirm('Clear all local system settings cache?')) {
                    localStorage.removeItem('vriddhi_system_settings')
                    setSettings({ emailNotifications: true, autoBackup: true, darkMode: true, maintenanceMode: false, twoFactorAuth: false, sessionTimeout: '30', feeReminder: true, attendanceAlert: true, autoGradePublish: false })
                    setMsg('Cache cleared')
                    setTimeout(() => setMsg(null), 2000)
                  }
                }} className="px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-50">Reset to Defaults</button>
              </div>
              <p className="text-[11px] text-teal-700/70 dark:text-teal-400/70 mt-2">These toggles are saved to localStorage and synced to your college document when possible. For full profile, appearance, and data backup controls, use the dedicated Settings page.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main Principal Dashboard ─────────────────────────────────────────────────

export default function AdminDashboard() {
  const { user, logout } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()

  // ═══════════════════════════════════════════════════════════════════════════
  // FIX: Sync active tab with URL so sidebar links & browser back/forward work
  // ═══════════════════════════════════════════════════════════════════════════
  const pathToTab: Record<string, string> = {
    '/': 'overview',
    '/dashboard': 'overview',
    '/admin/dashboard': 'overview',
    '/admin': 'overview',
    '/students': 'users',
    '/admin/students': 'users',
    '/departments': 'departments',
    '/admin/departments': 'departments',
    // Approvals moved to the HOD portal — legacy deep links land on Overview.
    '/approvals': 'overview',
    '/admin/approvals': 'overview',
    '/reports': 'reports',
    '/admin/reports': 'reports',
    '/audit': 'audit',
    '/admin/audit': 'audit',
    '/settings': 'settings',
    '/admin/settings': 'settings',
  }

  const rawTab = searchParams.get('tab') || pathToTab[location.pathname] || 'overview'
  const activeTab = rawTab === 'approvals' ? 'overview' : rawTab

  useEffect(() => {
    const tabFromPath = pathToTab[location.pathname]
    const tabFromQuery = searchParams.get('tab')
    if (tabFromPath && tabFromPath !== tabFromQuery) {
      setSearchParams({ tab: tabFromPath }, { replace: true })
    }
  }, [location.pathname])

  const collegeId = user?.collegeId
  const dashboardData = useCollegeDashboardData(collegeId, user ?? undefined)

  const tabs = [
    { id: 'overview', label: 'Overview', icon: Activity },
    { id: 'users', label: 'User Management', icon: Users },
    { id: 'departments', label: 'Departments', icon: Building2 },
    { id: 'faculty-attendance', label: 'Faculty Attendance', icon: BadgeCheck },
    // Approvals (question papers, question review) live with the department
    // HOD — see hodNav / HODDashboard. The principal's approvals surface was
    // removed with them.
    { id: 'reports', label: 'Reports', icon: BarChart3 },
    { id: 'audit', label: 'Audit Logs', icon: Clock },
    { id: 'settings', label: 'Settings', icon: Settings },
  ]

  const handleLogout = useCallback(async () => {
    await logout()
  }, [logout])

  const handleTabChange = (tabId: string) => {
    setSearchParams({ tab: tabId }, { replace: false })
  }

  const renderContent = () => {
    switch (activeTab) {
      case 'overview':
        return (
          <div className="animate-fade-in space-y-6">
            <PortalHero
              eyebrow="Principal workspace"
              title={`Welcome back, ${user?.name?.split(' ')[0] || 'Principal'}`}
              description={`College-wide administration and oversight · ${dashboardData.departments.length} Departments · ${dashboardData.totalStudents} Students`}
            />

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard icon={Users} label="Total Users" value={dashboardData.totalUsers.toLocaleString()} color="teal" />
              <StatCard icon={GraduationCap} label="Faculty" value={dashboardData.totalFaculty.toLocaleString()} color="sky" />
              <StatCard icon={BookOpen} label="Students" value={dashboardData.totalStudents.toLocaleString()} color="amber" />
              <StatCard icon={Activity} label="Departments" value={dashboardData.departments.length.toString()} color="rose" />
            </div>

            <AcademicInsightsDrillCard />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <FacultyAttendanceTodayCard collegeId={collegeId} />

              <div className="glass-card p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">Departments</h3>
                  <Badge variant="info">{dashboardData.departments.length}</Badge>
                </div>
                <div className="space-y-3">
                  {dashboardData.departments.slice(0, 4).map(dept => (
                    <div key={dept.id} className="flex items-center justify-between p-3 rounded-xl bg-slate-100/50 dark:bg-slate-900/50">
                      <div>
                        <p className="text-sm font-medium text-slate-900 dark:text-white">{dept.name}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{dept.studentCount} students · {dept.facultyCount} faculty</p>
                      </div>
                    </div>
                  ))}
                </div>
                {dashboardData.departments.length === 0 && (
                  <p className="text-sm text-slate-500 text-center py-4">No departments yet</p>
                )}
              </div>

            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="glass-card p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">Recent Users</h3>
                  <Badge variant="info">{dashboardData.users.length}</Badge>
                </div>
                <div className="space-y-3">
                  {dashboardData.users.slice(0, 4).map(u => (
                    <div key={u.id} className="flex items-center gap-3 p-3 rounded-xl bg-slate-100/50 dark:bg-slate-900/50">
                      <div className="h-8 w-8 rounded-full bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center text-teal-400 font-bold text-xs">
                        {getInitials(u.name)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-slate-900 dark:text-white truncate">{u.name}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{u.role} · {u.department}</p>
                      </div>
                    </div>
                  ))}
                </div>
                {dashboardData.users.length === 0 && (
                  <p className="text-sm text-slate-500 text-center py-4">No users yet</p>
                )}
              </div>
            </div>

            {dashboardData.departments.length > 0 && (
              <div className="glass-card p-6">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Department Overview</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={dashboardData.departments}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="code" stroke="#94a3b8" fontSize={12} />
                    <YAxis stroke="#94a3b8" fontSize={12} />
                    <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }} labelStyle={{ color: '#e2e8f0' }} />
                    <Bar dataKey="studentCount" fill="#14b8a6" name="Students" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="facultyCount" fill="#0ea5e9" name="Faculty" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )
      case 'users': return <UserManagement users={dashboardData.users} collegeId={collegeId} />
      case 'departments': return <DepartmentOverview departments={dashboardData.departments} />
      case 'faculty-attendance': return <FacultyAttendancePanel collegeId={collegeId} compact />
      case 'reports': return <ReportsAnalytics totalStudents={dashboardData.totalStudents} totalFaculty={dashboardData.totalFaculty} />
      case 'audit': return <AuditLogs />
      case 'settings': return <SystemSettings />
      default: return null
    }
  }

  if (dashboardData.loading) {
    return (
      <div className="min-h-full p-6 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-600 dark:border-teal-400" />
      </div>
    )
  }

  return (
    <div className="min-h-full p-6">
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-lg bg-teal-500/10 text-teal-600 dark:text-teal-400">
              <Shield size={22} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Principal Dashboard</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {activeTab === 'overview' && 'College-wide overview and key metrics'}
                {activeTab === 'users' && 'Manage all users, roles and permissions'}
                {activeTab === 'departments' && 'Department performance and analytics'}
                {activeTab === 'faculty-attendance' && 'Faculty self-marked attendance, analysis and downloads'}
                {activeTab === 'reports' && 'Generate and download reports'}
                {activeTab === 'audit' && 'System activity and security logs'}
                {activeTab === 'settings' && 'Configure system preferences'}
              </p>
            </div>
          </div>

          <button
            onClick={handleLogout}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-rose-400 hover:bg-rose-500/10 border border-rose-500/20 transition-colors"
          >
            <LogOut size={16} />
            Logout
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1 mb-6 overflow-x-auto pb-1">
        {tabs.map(tab => {
          const Icon = tab.icon
          const active = activeTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-all duration-200
                ${active ? 'bg-teal-500/10 text-teal-400 border border-teal-500/30' : 'text-slate-500 hover:text-slate-900 dark:text-white hover:bg-slate-200/50 dark:hover:bg-slate-800/50 border border-transparent'}`}
            >
              <Icon size={16} />
              {tab.label}
            </button>
          )
        })}
      </div>

      {renderContent()}
    </div>
  )
}

