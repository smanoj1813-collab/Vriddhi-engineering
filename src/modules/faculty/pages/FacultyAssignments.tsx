// src/modules/faculty/pages/FacultyAssignments.tsx
// Faculty Assignments Page - Wired to Firestore via assignmentApi

import { useState, useEffect, useCallback } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import { useFacultyCurriculum } from '../hooks/useFacultyCurriculum'
import {
  ChevronLeft, Plus, X, Check, Search, Calendar,
  Clock, Users, FileText, Trash2, CheckCircle2,
  BarChart3, Send, BookOpen, Target, Loader2, AlertTriangle, Upload, Eye, Download, ExternalLink
} from 'lucide-react'
import { ExportButton } from '@/components/shared/ExportButton'
import { useAuth } from '../../auth/context/AuthContext'
import { useCollegeModules } from '@/shared/hooks/useCollegeModules'
import {
  fetchFacultyAssignments,
  createAssignment,
  updateAssignment,
  deleteAssignment,
  fetchAssignmentSubmissions,
  gradeSubmission,
  publishAssignment,
  getSubmissionFileDownload,
  type Assignment,
  type AssignmentStatus,
  type Submission,
  type SubmissionStatus,
} from '../api/assignmentApi'

// ─── Status Config ────────────────────────────────────────────────────────────

const statusConfig: Record<AssignmentStatus, { color: string; label: string; icon: React.ReactNode }> = {
  draft: { color: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20', label: 'Draft', icon: <FileText className="w-4 h-4" /> },
  published: { color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border-blue-500/20', label: 'Published', icon: <Send className="w-4 h-4" /> },
  ongoing: { color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 border-amber-500/20', label: 'Ongoing', icon: <Clock className="w-4 h-4" /> },
  closed: { color: 'bg-rose-500/10 text-rose-400 border-rose-500/20', label: 'Closed', icon: <X className="w-4 h-4" /> },
  graded: { color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', label: 'Graded', icon: <CheckCircle2 className="w-4 h-4" /> },
}

const subStatusConfig: Record<SubmissionStatus, { color: string; label: string }> = {
  pending: { color: 'text-slate-400', label: 'Pending' },
  submitted: { color: 'text-blue-400', label: 'Submitted' },
  late: { color: 'text-amber-400', label: 'Late' },
  missing: { color: 'text-rose-400', label: 'Missing' },
  graded: { color: 'text-emerald-400', label: 'Graded' },
}

// ─── Types (local for UI) ─────────────────────────────────────────────────────

interface LocalAssignment extends Assignment {
  _loading?: boolean
  _submissions?: Submission[]
}

/** Human date for a deadline that may be '' — never renders a raw object. */
function formatDeadline(value: string): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function FacultyAssignments() {
  const { user } = useAuth()
  const { assignmentsEnabled } = useCollegeModules()
  const [assignments, setAssignments] = useState<LocalAssignment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  const [showCreate, setShowCreate] = useState(false)
  const [showDetail, setShowDetail] = useState<LocalAssignment | null>(null)
  const [showGradeModal, setShowGradeModal] = useState<{ submission: Submission; studentName: string } | null>(null)
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [loadingSubmissions, setLoadingSubmissions] = useState(false)
  
  const [searchQuery, setSearchQuery] = useState('')
  const [filterStatus, setFilterStatus] = useState<AssignmentStatus | 'all'>('all')
  const [saving, setSaving] = useState(false)

  // Create form state
  const [createTitle, setCreateTitle] = useState('')
  const [createDescription, setCreateDescription] = useState('')
  const [createTopic, setCreateTopic] = useState('')
  const [createSubject, setCreateSubject] = useState('')
  const [createMaxScore, setCreateMaxScore] = useState(20)
  const [createDeadline, setCreateDeadline] = useState('')
  const [createBatch, setCreateBatch] = useState('')
  const [createBranch, setCreateBranch] = useState('')
  const [createDivision, setCreateDivision] = useState('')

  // Grade form state
  const [gradeScore, setGradeScore] = useState('')
  const [gradeRemarks, setGradeRemarks] = useState('')

  const collegeId = user?.collegeId || ''
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  // Optional curriculum linkage — not mandatory; wiring Curriculum ↔ Assignments
  const facultyIdForCurriculum = user?.uid || (user as any)?.id || ''
  const { curriculum: facultyCurriculum } = useFacultyCurriculum(facultyIdForCurriculum, collegeId)
  const [linkCurriculum, setLinkCurriculum] = useState(false)
  const [linkCourseId, setLinkCourseId] = useState('')
  const [linkModuleId, setLinkModuleId] = useState('')
  const [linkScheduleId, setLinkScheduleId] = useState('')

  // ─── Load Assignments ──────────────────────────────────────────────────────
  
  // Derive selected curriculum course/module for link
  const linkedCourse = facultyCurriculum.find(c => c.courseId === linkCourseId) || null
  const linkedCourseModules = linkedCourse?.modules || []
  const linkedModule = linkedCourseModules.find((m: any) => m.id === linkModuleId) || null

  // Auto-prefill subject/cohort from linked curriculum when enabled
  useEffect(() => {
    if (!linkCurriculum || !linkedCourse) return
    if (linkedCourse.courseName && !createSubject) setCreateSubject(linkedCourse.courseName)
    if (linkedCourse.branch && !createBranch) setCreateBranch(linkedCourse.branch)
    if (linkedCourse.batch && !createBatch) setCreateBatch(linkedCourse.batch)
    if ((linkedCourse as any).division && !createDivision) setCreateDivision((linkedCourse as any).division || '')
    if (linkedModule?.title && !createTopic) setCreateTopic(linkedModule.title || linkedModule.moduleName || '')
  }, [linkCurriculum, linkedCourse, linkedModule])

  // Prefill from Curriculum / Schedule deep-link (?curriculumId=&courseId=&moduleId=&subject=&topic=) — optional wiring
  useEffect(() => {
    const qCourseId = searchParams.get('courseId') || searchParams.get('course') || ''
    const qModuleId = searchParams.get('moduleId') || ''
    const qSubject = searchParams.get('subject') || ''
    const qTopic = searchParams.get('topic') || ''
    const qBranch = searchParams.get('branch') || ''
    const qBatch = searchParams.get('batch') || ''
    const qDivision = searchParams.get('division') || ''
    const qScheduleId = searchParams.get('scheduleId') || searchParams.get('schedule') || ''
    const autoOpen = searchParams.get('create') === '1' || qCourseId || qModuleId || qSubject || qTopic || qScheduleId
    if (autoOpen) {
      if (qCourseId) { setLinkCurriculum(true); setLinkCourseId(qCourseId) }
      if (qModuleId) { setLinkCurriculum(true); setLinkModuleId(qModuleId) }
      if (qScheduleId) { setLinkCurriculum(true); setLinkScheduleId(qScheduleId) }
      if (qSubject) setCreateSubject(qSubject)
      if (qTopic) setCreateTopic(qTopic)
      if (qBranch) setCreateBranch(qBranch)
      if (qBatch) setCreateBatch(qBatch)
      if (qDivision) setCreateDivision(qDivision)
      setShowCreate(true)
      // clean query so refresh doesn't reopen
      // keep other params? just remove create flags after open
      // we won't clear automatically to keep idempotent; user can close
    }
  }, [searchParams])

  const loadAssignments = useCallback(async () => {
    if (!user?.uid) return
    
    setLoading(true)
    setError(null)
    
    try {
      const data = await fetchFacultyAssignments(user.uid, collegeId)
      setAssignments(data.map(a => ({ ...a, _loading: false, _submissions: [] })))
    } catch (err) {
      console.error('[FacultyAssignments] Load failed:', err)
      setAssignments([])
      setError(err instanceof Error ? err.message : 'Failed to load assignments. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [user?.uid, collegeId])

  useEffect(() => {
    loadAssignments()
  }, [loadAssignments])

  // ─── Load Submissions ─────────────────────────────────────────────────────
  
  const loadSubmissions = useCallback(async (assignmentId: string) => {
    setLoadingSubmissions(true)
    try {
      const data = await fetchAssignmentSubmissions(assignmentId, collegeId)
      setSubmissions(data)
    } catch (err) {
      console.error('[FacultyAssignments] Load submissions failed:', err)
      setSubmissions([])
      setError(err instanceof Error ? err.message : 'Failed to load submissions.')
    } finally {
      setLoadingSubmissions(false)
    }
  }, [collegeId])

  // ─── Handlers ─────────────────────────────────────────────────────────────
  
  const handleViewDetail = async (assignment: LocalAssignment) => {
    setShowDetail(assignment)
    await loadSubmissions(assignment.id)
  }

  const handleCreate = async () => {
    if (!createTitle.trim() || !createDeadline || !user) return
    if (!createSubject.trim() && !createTopic.trim()) {
      alert('Enter a subject or topic.')
      return
    }
    if (!createBranch.trim() && !createBatch.trim() && !createDivision.trim()) {
      alert('Choose at least one cohort field: branch, batch, or division.')
      return
    }
    
    setSaving(true)
    try {
      const newAssignment = await createAssignment({
        collegeId,
        facultyUid: user.uid,
        facultyName: user.name || 'Faculty',
        title: createTitle.trim(),
        description: createDescription.trim(),
        topic: createTopic.trim(),
        subject: createSubject.trim() || createTopic.trim(),
        subjectCode: '',
        maxScore: createMaxScore,
        deadline: createDeadline,
        status: 'draft',
        type: 'assignment',
        targetType: 'cohort',
        cohort: {
          branch: createBranch,
          batch: createBatch,
          division: createDivision,
        },
        ...(linkCurriculum && (linkedCourse || linkScheduleId || linkCourseId) ? {
          ...(linkedCourse?.curriculumId ? { curriculumId: linkedCourse.curriculumId } : {}),
          ...(linkedCourse?.courseId || linkCourseId ? { courseId: linkedCourse?.courseId || linkCourseId } : {}),
          ...(linkedCourse?.courseName || createSubject ? { courseName: linkedCourse?.courseName || createSubject } : {}),
          ...(linkedModule ? { moduleId: linkedModule.id, moduleTitle: linkedModule.title || linkedModule.moduleName } : (linkModuleId ? { moduleId: linkModuleId } : {})),
          ...(linkScheduleId ? { scheduleId: linkScheduleId } : {}),
        } : {}),
      } as any)
      
      setAssignments(prev => [{ ...newAssignment, _loading: false, _submissions: [] }, ...prev])
      setShowCreate(false)
      resetCreateForm()
    } catch (err) {
      console.error('[FacultyAssignments] Create failed:', err)
      alert(err instanceof Error ? err.message : 'Failed to create assignment')
    } finally {
      setSaving(false)
    }
  }

  const resetCreateForm = () => {
    setCreateTitle('')
    setCreateDescription('')
    setCreateTopic('')
    setCreateSubject('')
    setCreateMaxScore(20)
    setCreateDeadline('')
    setCreateBatch('')
    setCreateBranch('')
    setCreateDivision('')
    setLinkCurriculum(false)
    setLinkCourseId('')
    setLinkModuleId('')
    setLinkScheduleId('')
    // clear assignment deep-link query so next visit is clean
    if (searchParams.get('courseId') || searchParams.get('moduleId') || searchParams.get('scheduleId') || searchParams.get('create')) {
      const next = new URLSearchParams(searchParams)
      next.delete('courseId'); next.delete('course'); next.delete('moduleId'); next.delete('scheduleId'); next.delete('schedule'); next.delete('subject'); next.delete('topic'); next.delete('branch'); next.delete('batch'); next.delete('division'); next.delete('create')
      setSearchParams(next, { replace: true })
    }
  }

  const handlePublish = async (assignmentId: string) => {
    setSaving(true)
    try {
      await publishAssignment(assignmentId)
      await loadAssignments()
    } catch (err) {
      console.error('[FacultyAssignments] Publish failed:', err)
      alert(err instanceof Error ? err.message : 'Failed to publish assignment')
    } finally {
      setSaving(false)
    }
  }

  const handleStatusChange = async (assignmentId: string, status: AssignmentStatus) => {
    setSaving(true)
    try {
      await updateAssignment(assignmentId, { status })
      await loadAssignments()
    } catch (err) {
      console.error('[FacultyAssignments] Status change failed:', err)
      alert(err instanceof Error ? err.message : 'Assignment status could not be changed')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (assignmentId: string) => {
    if (!confirm('Delete this assignment? This cannot be undone.')) return
    
    setSaving(true)
    try {
      await deleteAssignment(assignmentId)
      setAssignments(prev => prev.filter(a => a.id !== assignmentId))
      if (showDetail?.id === assignmentId) setShowDetail(null)
    } catch (err) {
      console.error('[FacultyAssignments] Delete failed:', err)
      alert(err instanceof Error ? err.message : 'Failed to delete assignment')
    } finally {
      setSaving(false)
    }
  }

  const handleGrade = (submission: Submission, studentName: string) => {
    setShowGradeModal({ submission, studentName })
    setGradeScore(submission.score?.toString() || '')
    setGradeRemarks(submission.remarks || '')
  }

  const handleDownloadSubmission = async (
    submission: Submission,
    file: { name: string; storagePath?: string }
  ) => {
    if (!file.storagePath) {
      alert('This legacy file does not have a verified storage path.')
      return
    }
    try {
      const download = await getSubmissionFileDownload(submission.id, file.storagePath)
      const link = document.createElement('a')
      link.href = download.url
      link.download = download.name
      link.rel = 'noopener noreferrer'
      document.body.appendChild(link)
      link.click()
      link.remove()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'The submitted file could not be downloaded.')
    }
  }

  const confirmGrade = async () => {
    if (!showGradeModal || !gradeScore || !user) return
    
    const score = Number(gradeScore)
    if (!Number.isFinite(score) || score < 0 || score > showGradeModal.submission.maxScore) {
      alert('Invalid score')
      return
    }
    
    setSaving(true)
    try {
      await gradeSubmission(showGradeModal.submission.id, {
        score,
        remarks: gradeRemarks,
        gradedBy: user.uid,
      })
      await loadSubmissions(showDetail?.id || '')
      setShowGradeModal(null)
      setGradeScore('')
      setGradeRemarks('')
    } catch (err) {
      console.error('[FacultyAssignments] Grade failed:', err)
      alert(err instanceof Error ? err.message : 'Failed to save grade')
    } finally {
      setSaving(false)
    }
  }

  // ─── Filtered List ─────────────────────────────────────────────────────────
  
  const filtered = assignments.filter(a => {
    const matchesSearch = 
      a.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.topic?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.subject?.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesStatus = filterStatus === 'all' || a.status === filterStatus
    return matchesSearch && matchesStatus
  })

  // ─── Stats ─────────────────────────────────────────────────────────────────
  
  const stats = [
    { label: 'Total', value: assignments.length, color: 'text-teal-400' },
    { label: 'Published', value: assignments.filter(a => a.status === 'published' || a.status === 'ongoing').length, color: 'text-blue-400' },
    { label: 'Graded', value: assignments.filter(a => a.status === 'graded' || a.status === 'closed').length, color: 'text-emerald-400' },
    { label: 'Draft', value: assignments.filter(a => a.status === 'draft').length, color: 'text-slate-400' },
  ]

  // ─── Render ─────────────────────────────────────────────────────────────────

  // Deep-link guard for the college-level Assignments module toggle. The nav
  // hides this page; a bookmarked URL must get the same answer.
  if (!assignmentsEnabled) {
    return (
      <div className="p-6 lg:p-8 max-w-2xl mx-auto flex flex-col items-center justify-center min-h-[60vh] text-center">
        <AlertTriangle className="w-12 h-12 text-amber-500 mb-4" />
        <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Assignments is switched off for this college</h2>
        <p className="text-slate-500 dark:text-slate-400 max-w-md mb-4">
          This college does not use the Assignments module right now. A college administrator can turn it back on in Settings → Modules.
        </p>
        <Link to="/faculty/dashboard" className="px-4 py-2 bg-teal-500 text-white rounded-lg text-sm hover:bg-teal-600">
          Back to Dashboard
        </Link>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="p-6 lg:p-8 max-w-7xl mx-auto flex flex-col items-center justify-center min-h-[60vh]">
        <Loader2 className="w-10 h-10 text-teal-500 animate-spin mb-4" />
        <p className="text-slate-500 dark:text-slate-400">Loading assignments...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6 lg:p-8 max-w-7xl mx-auto flex flex-col items-center justify-center min-h-[60vh]">
        <AlertTriangle className="w-12 h-12 text-rose-400 mb-4" />
        <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Failed to Load</h2>
        <p className="text-slate-500 dark:text-slate-400 text-center max-w-md mb-4">{error}</p>
        <button onClick={loadAssignments} className="px-4 py-2 bg-teal-500 text-white rounded-lg text-sm hover:bg-teal-600">
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto min-h-screen">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div className="flex items-center gap-4">
          <Link to="/faculty" className="p-2 rounded-xl bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/50 hover:border-teal-500/30 hover:bg-teal-500/5 transition-all shadow-sm">
            <ChevronLeft className="w-5 h-5 text-slate-600 dark:text-slate-400" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <BookOpen className="w-6 h-6 text-teal-600 dark:text-teal-400" />
              Assignments
            </h1>
            <p className="text-slate-600 dark:text-slate-400 text-sm">Create, track, and grade student assignments</p>
          </div>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-teal-500 text-white font-medium hover:bg-teal-600 transition-all text-sm"
        >
          <Plus className="w-4 h-4" />
          New Assignment
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {stats.map((stat, i) => (
          <div key={i} className="bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/50 rounded-2xl p-4 shadow-sm">
            <p className="text-slate-600 dark:text-slate-400 text-xs uppercase tracking-wider mb-1">{stat.label}</p>
            <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Search & Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search assignments..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-white dark:bg-slate-800/50 border border-slate-300 dark:border-slate-700/50 rounded-xl pl-10 pr-4 py-2.5 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 text-sm"
          />
        </div>
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value as AssignmentStatus | 'all')}
          className="bg-white dark:bg-slate-800/50 border border-slate-300 dark:border-slate-700/50 rounded-xl px-3 py-2.5 text-slate-900 dark:text-white text-sm focus:outline-none focus:border-teal-500"
        >
          <option value="all">All Status</option>
          <option value="draft">Draft</option>
          <option value="published">Published</option>
          <option value="ongoing">Ongoing</option>
          <option value="closed">Closed</option>
          <option value="graded">Graded</option>
        </select>
      </div>

      {/* Assignments List */}
      <div className="space-y-3">
        {filtered.length === 0 ? (
          <div className="bg-white/60 dark:bg-slate-800/30 border border-slate-200 dark:border-slate-700/30 rounded-2xl p-12 text-center">
            <BookOpen className="w-12 h-12 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-600 dark:text-slate-400">No assignments found</p>
            <button onClick={() => setShowCreate(true)} className="mt-4 px-4 py-2 bg-teal-500 text-white rounded-lg text-sm hover:bg-teal-600">
              Create First Assignment
            </button>
          </div>
        ) : (
          filtered.map(item => {
            const sConfig = statusConfig[item.status]
            return (
              <div key={item.id} className="bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/50 rounded-2xl p-5 hover:border-slate-300 dark:hover:border-slate-600 transition-all shadow-sm">
                <div className="flex flex-col lg:flex-row lg:items-start gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <h3 className="font-semibold text-slate-900 dark:text-white">{item.title}</h3>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium border flex items-center gap-1 ${sConfig.color}`}>
                        {sConfig.icon}
                        {sConfig.label}
                      </span>
                    </div>
                    <p className="text-slate-600 dark:text-slate-400 text-sm mb-3 line-clamp-2">{item.description}</p>
                    <div className="flex flex-wrap gap-4 text-xs text-slate-600 dark:text-slate-400">
                      {item.topic && <span className="flex items-center gap-1"><Target className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" /> {item.topic}</span>}
                      <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" /> Due: {formatDeadline(item.deadline)}</span>
                      {item.cohort?.batch && <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" /> {item.cohort.batch}</span>}
                      <span className="flex items-center gap-1"><BarChart3 className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" /> Max: {item.maxScore} pts</span>
                    </div>
                    {(item as any).courseName && (
                      <div className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-violet-700 dark:text-violet-300 bg-violet-500/10 border border-violet-500/20 rounded-full px-2.5 py-1">
                        <BookOpen className="w-3 h-3" /> Linked: {(item as any).courseName}{(item as any).moduleTitle ? ` → ${(item as any).moduleTitle}` : ''}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => handleViewDetail(item)} className="px-3 py-1.5 rounded-xl bg-teal-500/10 text-teal-400 border border-teal-500/20 text-sm font-medium hover:bg-teal-100 dark:bg-teal-900/30 transition-all">
                      <Eye className="w-4 h-4 inline mr-1" /> View
                    </button>
                    {item.status === 'draft' && (
                      <button onClick={() => handlePublish(item.id)} disabled={saving} className="px-3 py-1.5 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20 text-sm font-medium hover:bg-blue-500/20 transition-all disabled:opacity-50">
                        <Send className="w-4 h-4 inline mr-1" /> Publish
                      </button>
                    )}
                    {item.status === 'published' && (
                      <button onClick={() => handleStatusChange(item.id, 'ongoing')} disabled={saving} className="px-3 py-1.5 rounded-xl bg-amber-100 text-amber-700 dark:text-amber-300 border border-amber-500/20 text-sm font-medium hover:bg-amber-100 dark:bg-amber-900/30 transition-all disabled:opacity-50">
                        Start
                      </button>
                    )}
                    {item.status === 'ongoing' && (
                      <button onClick={() => handleStatusChange(item.id, 'closed')} disabled={saving} className="px-3 py-1.5 rounded-xl bg-rose-500/10 text-rose-400 border border-rose-500/20 text-sm font-medium hover:bg-rose-500/20 transition-all disabled:opacity-50">
                        Close
                      </button>
                    )}
                    {item.status === 'draft' && (
                      <button onClick={() => handleDelete(item.id)} disabled={saving} className="p-2 rounded-xl hover:bg-rose-500/20 text-slate-500 hover:text-rose-400 transition-all disabled:opacity-50" aria-label={`Delete ${item.title}`}>
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Plus className="w-5 h-5 text-teal-600 dark:text-teal-400" />
                New Assignment
              </h2>
              <button onClick={() => { setShowCreate(false); resetCreateForm() }} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-slate-600 dark:text-slate-400 mb-1.5">Title *</label>
                <input type="text" value={createTitle} onChange={e => setCreateTitle(e.target.value)} placeholder="e.g., Assignment 1: Introduction"
                  className="w-full bg-white dark:bg-slate-700/50 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 text-sm" />
              </div>
              <div>
                <label className="block text-sm text-slate-600 dark:text-slate-400 mb-1.5">Description</label>
                <textarea value={createDescription} onChange={e => setCreateDescription(e.target.value)} rows={3} placeholder="Describe the assignment requirements..."
                  className="w-full bg-white dark:bg-slate-700/50 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 text-sm resize-none" />
              </div>
              {/* Optional curriculum / schedule linkage — not mandatory; faculty can attach from My Curriculum one-stop */}
              <div className="p-3 rounded-xl bg-violet-500/5 border border-violet-500/15">
                <label className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input type="checkbox" checked={linkCurriculum} onChange={e => { setLinkCurriculum(e.target.checked); if (!e.target.checked) { setLinkCourseId(''); setLinkModuleId(''); setLinkScheduleId('') } }} className="rounded border-slate-300 text-violet-600 focus:ring-violet-500" />
                  Link to Curriculum / Schedule (optional)
                </label>
                <p className="text-xs text-slate-500 mt-1">Attach this assignment to a course/module from your assigned curriculum so students see the context. Not required — leave unchecked for a standalone assignment.</p>
                {linkCurriculum && (
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-slate-600 dark:text-slate-400 mb-1">Course (from My Curriculum)</label>
                      <select value={linkCourseId} onChange={e => { setLinkCourseId(e.target.value); setLinkModuleId('') }} className="w-full bg-white dark:bg-slate-700/50 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-white text-sm focus:outline-none focus:border-teal-500">
                        <option value="">Select course (optional)</option>
                        {facultyCurriculum.map(c => (
                          <option key={c.courseId} value={c.courseId}>{c.courseName} — {c.courseCode} ({c.branch} Sem {c.semester})</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-600 dark:text-slate-400 mb-1">Module / Topic (optional)</label>
                      <select value={linkModuleId} onChange={e => setLinkModuleId(e.target.value)} disabled={!linkCourseId} className="w-full bg-white dark:bg-slate-700/50 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-white text-sm focus:outline-none focus:border-teal-500 disabled:opacity-50">
                        <option value="">No specific module</option>
                        {linkedCourseModules.map((m: any) => (
                          <option key={m.id} value={m.id}>{m.title || m.moduleName || `Module ${m.moduleNo}`} — {m.hours}h</option>
                        ))}
                      </select>
                    </div>
                    {(linkedCourse || linkScheduleId) && (
                      <div className="sm:col-span-2 text-xs text-violet-700 dark:text-violet-300 bg-white dark:bg-slate-800 rounded-lg p-2 border border-violet-500/10">
                        Linked: <span className="font-medium">{linkedCourse?.courseName || createSubject || 'Schedule linked'}</span> {linkedModule ? `→ ${linkedModule.title || linkedModule.moduleName}` : (linkScheduleId ? `· Schedule ${linkScheduleId.slice(0,8)}` : '')} · Students will be notified with deadline on Publish.
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-slate-600 dark:text-slate-400 mb-1.5">Subject *</label>
                  <input type="text" value={createSubject} onChange={e => setCreateSubject(e.target.value)} placeholder="Subject name"
                    className="w-full bg-white dark:bg-slate-700/50 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-teal-500 text-sm" />
                </div>
                <div>
                  <label className="block text-sm text-slate-600 dark:text-slate-400 mb-1.5">Topic</label>
                  <input type="text" value={createTopic} onChange={e => setCreateTopic(e.target.value)} placeholder="Topic"
                    className="w-full bg-white dark:bg-slate-700/50 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-teal-500 text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-slate-600 dark:text-slate-400 mb-1.5">Max Score *</label>
                  <input type="number" value={createMaxScore} onChange={e => setCreateMaxScore(parseInt(e.target.value) || 0)} min={1} max={500}
                    className="w-full bg-white dark:bg-slate-700/50 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:border-teal-500 text-sm" />
                </div>
                <div>
                  <label className="block text-sm text-slate-600 dark:text-slate-400 mb-1.5">Deadline *</label>
                  <input type="date" value={createDeadline} onChange={e => setCreateDeadline(e.target.value)}
                    className="w-full bg-white dark:bg-slate-700/50 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:border-teal-500 text-sm" />
                  <p className="text-[11px] text-slate-500 mt-1">Students are notified with this deadline when you Publish (notification includes linked course/module if attached).</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm text-slate-600 dark:text-slate-400 mb-1.5">Branch</label>
                  <input type="text" value={createBranch} onChange={e => setCreateBranch(e.target.value)} placeholder="e.g., B.Com"
                    className="w-full bg-white dark:bg-slate-700/50 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-teal-500 text-sm" />
                </div>
                <div>
                  <label className="block text-sm text-slate-600 dark:text-slate-400 mb-1.5">Batch</label>
                  <input type="text" value={createBatch} onChange={e => setCreateBatch(e.target.value)} placeholder="e.g., 2026"
                    className="w-full bg-white dark:bg-slate-700/50 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-teal-500 text-sm" />
                </div>
                <div>
                  <label className="block text-sm text-slate-600 dark:text-slate-400 mb-1.5">Division</label>
                  <input type="text" value={createDivision} onChange={e => setCreateDivision(e.target.value)} placeholder="e.g., A"
                    className="w-full bg-white dark:bg-slate-700/50 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-teal-500 text-sm" />
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={() => { setShowCreate(false); resetCreateForm() }}
                className="flex-1 px-4 py-2.5 rounded-xl bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-medium hover:bg-slate-300 dark:hover:bg-slate-600 transition-all text-sm">
                Cancel
              </button>
              <button onClick={handleCreate} disabled={!createTitle.trim() || (!createSubject.trim() && !createTopic.trim()) || !createDeadline || (!createBranch.trim() && !createBatch.trim() && !createDivision.trim()) || saving}
                className="flex-1 px-4 py-2.5 rounded-xl bg-teal-500 text-white font-medium hover:bg-teal-600 transition-all disabled:opacity-40 disabled:cursor-not-allowed text-sm flex items-center justify-center gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Save as Draft
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {showDetail && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl w-full max-w-3xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <div className="min-w-0 pr-2">
                <h2 className="text-xl font-bold text-slate-900 dark:text-white truncate">{showDetail.title}</h2>
                <p className="text-sm text-slate-600 dark:text-slate-400 mt-1 truncate">
                  {showDetail.topic && `${showDetail.topic} • `}Due: {formatDeadline(showDetail.deadline)} • Max: {showDetail.maxScore} pts
                </p>
              </div>
              <button onClick={() => setShowDetail(null)} className="p-1.5 shrink-0 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>

            <p className="text-slate-700 dark:text-slate-300 text-sm mb-6 bg-slate-50 dark:bg-slate-700/30 rounded-xl p-4">{showDetail.description || 'No description'}</p>
            {(showDetail as any).courseName && (
              <div className="mb-4 flex items-center gap-2 text-sm text-violet-700 dark:text-violet-300 bg-violet-500/10 border border-violet-500/20 rounded-xl px-3 py-2">
                <BookOpen className="w-4 h-4" /> Linked to curriculum: <span className="font-semibold">{(showDetail as any).courseName}</span>{(showDetail as any).moduleTitle ? ` → ${(showDetail as any).moduleTitle}` : ''} · Students were notified with deadline {formatDeadline(showDetail.deadline)} on publish
              </div>
            )}

            {/* Stats */}
            <div className="grid grid-cols-4 gap-3 mb-6">
              <div className="bg-slate-50 dark:bg-slate-700/30 rounded-xl p-3 text-center">
                <p className="text-xl font-bold text-blue-400">{submissions.length}</p>
                <p className="text-xs text-slate-600 dark:text-slate-400">Total</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-700/30 rounded-xl p-3 text-center">
                <p className="text-xl font-bold text-emerald-400">{submissions.filter(s => s.status === 'submitted' || s.status === 'late').length}</p>
                <p className="text-xs text-slate-600 dark:text-slate-400">Submitted</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-700/30 rounded-xl p-3 text-center">
                <p className="text-xl font-bold text-emerald-400">{submissions.filter(s => s.status === 'graded').length}</p>
                <p className="text-xs text-slate-600 dark:text-slate-400">Graded</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-700/30 rounded-xl p-3 text-center">
                <p className="text-xl font-bold text-amber-400">{submissions.filter(s => s.status === 'late').length}</p>
                <p className="text-xs text-slate-600 dark:text-slate-400">Late</p>
              </div>
            </div>

            {/* Submissions */}
            {loadingSubmissions ? (
              <div className="text-center py-8">
                <Loader2 className="w-8 h-8 text-teal-500 animate-spin mx-auto" />
                <p className="text-slate-500 mt-2">Loading submissions...</p>
              </div>
            ) : submissions.length === 0 ? (
              <div className="text-center py-8 text-slate-500 text-sm">No submissions yet</div>
            ) : (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Student Submissions</h3>
                {submissions.map(sub => {
                  const ssConfig = subStatusConfig[sub.status] || subStatusConfig.pending
                  return (
                    <div key={sub.id} className="flex items-center gap-4 p-3 rounded-xl bg-slate-50 dark:bg-slate-700/30 border border-slate-200 dark:border-slate-700/50">
                      <div className="w-8 h-8 rounded-full bg-slate-600 flex items-center justify-center text-sm font-semibold text-white shrink-0">
                        {sub.studentName.charAt(0)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-900 dark:text-white">{sub.studentName}</p>
                        {sub.studentRegNo && <p className="text-xs text-slate-600 dark:text-slate-400">{sub.studentRegNo}</p>}
                        {sub.attachments?.length ? (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {sub.attachments.map((file, index) =>
                              file.kind === 'driveLink' && file.url ? (
                                <a
                                  key={`drive-${file.url}-${index}`}
                                  href={file.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-xs text-teal-700 dark:text-teal-300 hover:underline"
                                >
                                  <ExternalLink className="w-3 h-3" /> {file.name} (Drive)
                                </a>
                              ) : (
                                <button
                                  key={`${file.storagePath || file.name}-${index}`}
                                  type="button"
                                  onClick={() => void handleDownloadSubmission(sub, file)}
                                  className="inline-flex items-center gap-1 text-xs text-teal-700 dark:text-teal-300 hover:underline"
                                >
                                  <Download className="w-3 h-3" /> {file.name}
                                </button>
                              )
                            )}
                          </div>
                        ) : null}
                      </div>
                      {sub.submittedAt && <span className="text-xs text-slate-500 shrink-0">{new Date(sub.submittedAt).toLocaleDateString()}</span>}
                      <span className={`text-xs font-medium shrink-0 ${ssConfig.color}`}>{ssConfig.label}</span>
                      {sub.score !== undefined && <span className="text-sm font-semibold text-slate-900 dark:text-white shrink-0">{sub.score}/{sub.maxScore}</span>}
                      {sub.status !== 'graded' && sub.status !== 'missing' && (
                        <button onClick={() => handleGrade(sub, sub.studentName)}
                          className="px-2.5 py-1 rounded-lg bg-teal-500/10 text-teal-400 border border-teal-500/20 text-xs font-medium hover:bg-teal-500/20 transition-all shrink-0">
                          Grade
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Grade Modal */}
      {showGradeModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">Grade Submission</h2>
              <button onClick={() => setShowGradeModal(null)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>

            <div className="mb-4 p-3 bg-slate-50 dark:bg-slate-700/30 rounded-xl border border-slate-200 dark:border-slate-700/50">
              <p className="text-sm text-slate-700 dark:text-slate-300"><span className="text-slate-500">Student:</span> {showGradeModal.studentName}</p>
              <p className="text-sm text-slate-700 dark:text-slate-300"><span className="text-slate-500">Max Score:</span> {showGradeModal.submission.maxScore}</p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-slate-600 dark:text-slate-400 mb-1.5">Score *</label>
                <input type="number" value={gradeScore} onChange={e => setGradeScore(e.target.value)} min={0} max={showGradeModal.submission.maxScore}
                  className="w-full bg-white dark:bg-slate-700/50 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:border-teal-500 text-sm" />
              </div>
              <div>
                <label className="block text-sm text-slate-600 dark:text-slate-400 mb-1.5">Remarks</label>
                <textarea value={gradeRemarks} onChange={e => setGradeRemarks(e.target.value)} rows={2} placeholder="Optional feedback..."
                  className="w-full bg-white dark:bg-slate-700/50 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-teal-500 text-sm resize-none" />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowGradeModal(null)} className="flex-1 px-4 py-2.5 rounded-xl bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-medium hover:bg-slate-300 dark:hover:bg-slate-600 transition-all text-sm">
                Cancel
              </button>
              <button onClick={confirmGrade} disabled={!gradeScore || saving}
                className="flex-1 px-4 py-2.5 rounded-xl bg-teal-500 text-white font-medium hover:bg-teal-600 transition-all disabled:opacity-40 disabled:cursor-not-allowed text-sm flex items-center justify-center gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Save Grade
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
