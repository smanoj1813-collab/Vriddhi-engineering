import React, { useState, useMemo, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft, Check, X, Clock, AlertCircle, FileMinus,
  Users, Calendar, Save, RotateCcw, Search, Pill,
  Loader2, AlertTriangle, BookOpen, CheckCircle2, Plus
} from 'lucide-react'
import { useAuth } from '../../auth/context/AuthContext'
import { useFacultyAttendance } from '../hooks/useFacultyAttendance'
import { completeClassSession, ensureClassSession } from '../../admin/api/classSessionApi'
import { normalizeSessionDate, parseSlotDateKey } from '@/shared/utils/sessionDate'
import { fetchSessionTopicOptions, type SessionTopicOption } from '../api/sessionTopicsApi'
import { isPermissionDeniedError } from '../../../shared/utils/identityClaims'
import { useAttendanceExport } from '../hooks/useAttendanceExport'
import { DateRangeSelector } from '../../../components/shared/DateRangeSelector'
import { ExportButton } from '../../../components/shared/ExportButton'
import type { AttendanceStatus, FacultyExportRow, FacultyStudent, FacultyClassSession } from '../types/attendance'
import type { RosterDiagnostics } from '../../../shared/utils/cohortMatching'
import type { DateRangeType } from '../hooks/useAttendanceExport'
import MergedDivisionChip from '@/shared/components/MergedDivisionChip'
import { teachingGroupScopeLabel } from '@/shared/utils/divisionGroups'

const statusConfig: Record<AttendanceStatus, { label: string; color: string; bg: string; border: string; icon: React.ElementType }> = {
  Present: {
    label: 'Present',
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    icon: Check,
  },
  Absent: {
    label: 'Absent',
    color: 'text-rose-400',
    bg: 'bg-rose-500/10',
    border: 'border-rose-500/30',
    icon: X,
  },
  Late: {
    label: 'Late',
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    icon: Clock,
  },
  Leave: {
    label: 'Leave',
    color: 'text-purple-400',
    bg: 'bg-purple-500/10',
    border: 'border-purple-500/30',
    icon: FileMinus,
  },
  OnDuty: {
    label: 'On Duty',
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/30',
    icon: AlertCircle,
  },
  MedicalLeave: {
    label: 'Medical',
    color: 'text-pink-400',
    bg: 'bg-pink-500/10',
    border: 'border-pink-500/30',
    icon: Pill,
  },
}

const allStatuses: AttendanceStatus[] = ['Present', 'Absent', 'Late', 'Leave', 'OnDuty', 'MedicalLeave'];

// ─── Roster diagnostics (the "0 students" that explains itself) ────────────

const MISMATCH_LABELS: Record<string, string> = {
  branch: 'Program / branch',
  batch: 'Batch',
  semester: 'Semester',
  division: 'Division',
  section: 'Section',
  subject: 'Subject',
  collegeId: 'College',
}

function describeCohortTarget(target: RosterDiagnostics['target']): string {
  const parts: string[] = []
  if (target.branch) parts.push(target.branch)
  if (target.batch) parts.push(target.batch)
  if (target.semester) parts.push(`Semester ${target.semester}`)
  const teachingGroup = teachingGroupScopeLabel(target.division, target.section)
  if (teachingGroup) parts.push(teachingGroup)
  if (target.subject) parts.push(target.subject)
  return parts.join(' • ') || 'this class'
}

/**
 * Shown INSTEAD of the roster table when the college query returned students
 * but none matched the class cohort. Requirement: never show a generic
 * "no students" empty state in that case — the college clearly HAS students,
 * so the answer is which field is disagreeing and what values were seen.
 */
function RosterDiagnosticPanel({ diagnostics }: { diagnostics: RosterDiagnostics }) {
  const mismatchEntries = Object.entries(diagnostics.mismatches)
  return (
    <div className="rounded-xl border border-amber-300/70 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 p-5 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
        <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
          {diagnostics.collegeTotal} {diagnostics.collegeTotal === 1 ? 'student' : 'students'} loaded from this college — none match this class's cohort
        </h3>
      </div>

      <p className="text-sm text-amber-900/90 dark:text-amber-200/90 mb-3">
        Class cohort: <strong>{describeCohortTarget(diagnostics.target)}</strong>
      </p>

      {mismatchEntries.length > 0 && (
        <ul className="space-y-1 mb-3">
          {mismatchEntries.map(([field, detail]) => (
            <li key={field} className="text-xs text-amber-900/80 dark:text-amber-200/80">
              <span className="font-medium">{MISMATCH_LABELS[field] ?? field}</span>:{' '}
              {detail.count} {detail.count === 1 ? 'student differs' : 'students differ'}
              {detail.values.length > 0 && (
                <span className="text-amber-800/70 dark:text-amber-300/70">
                  {' '}— values found: {detail.values.join(', ')}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-amber-900/80 dark:text-amber-200/80">
        Ask an admin to align this class's schedule (program, batch, semester, teaching group) with
        how the students were imported, then mark attendance again.
      </p>

      {diagnostics.truncated && (
        <p className="text-xs text-amber-900/70 dark:text-amber-200/70 mt-2">
          Note: the roster scan stopped at its safety cap of {diagnostics.collegeTotal} students —
          if this college has more, some were not checked.
        </p>
      )}
    </div>
  )
}

/**
 * Shown ALONGSIDE the roster when some students matched but others were left
 * out (the panel above only covered the all-or-nothing empty case). Partial
 * exclusion used to be invisible: a faculty saw "the class is missing half its
 * students" with no way to tell why. This names the fields to fix.
 *
 * It used to name only the FIELDS ("Semester — 123") and then assert the
 * remedy on the student records ("Fix the semester on those students"). That
 * is one-sided and it is the wrong instruction half the time: the same message
 * appears when the CLASS is the odd one out — a timetable slot carrying a
 * semester the college does not teach, which is exactly what happens after an
 * admin re-aligns a batch. So the notice now shows both sides of the
 * comparison: what this class is, and what the excluded students actually
 * have, and offers the fix in either direction.
 */
function RosterExclusionNotice({ diagnostics }: { diagnostics: RosterDiagnostics }) {
  const excluded = Object.entries(diagnostics.nearMisses)
    .filter(([, detail]) => detail.count > 0)
    .sort((a, b) => b[1].count - a[1].count)
  if (diagnostics.nearMissTotal === 0 || excluded.length === 0) return null
  const fields = excluded.map(([field]) => MISMATCH_LABELS[field] ?? field).join(' / ')
  return (
    <div className="mb-4 p-3 rounded-xl border border-amber-300/70 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 flex items-start gap-2 text-xs text-amber-900 dark:text-amber-200">
      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
      <span>
        {diagnostics.nearMissTotal}{' '}
        {diagnostics.nearMissTotal === 1 ? 'student is' : 'students are'} in this college and
        program but not in this roster — their records differ from this class's cohort.{' '}
        <strong>This class is {describeCohortTarget(diagnostics.target)}.</strong>{' '}
        {excluded
          .slice(0, 3)
          .flatMap(([field, detail], index) => [
            index > 0 ? ' · ' : null,
            <span key={field} className="inline">
              {MISMATCH_LABELS[field] ?? field} — {detail.count}
              {detail.values.length > 0 && (
                <span className="text-amber-800/80 dark:text-amber-300/80">
                  {' '}(recorded as: {detail.values.join(', ')}
                  {detail.values.length >= 6 ? '…' : ''})
                </span>
              )}
            </span>,
          ])}
        {excluded.length > 3 ? ` · +${excluded.length - 3} more field(s)` : ''}.{' '}
        {/*
          Which side is wrong is a judgement the reader has to make, so BOTH are
          offered: correcting 123 students is destructive and must never be the
          advice a UI gives on its own.
        */}
        Either correct the {fields} on those students (Superadmin → Students → Bulk change) or
        correct this class's {fields} on its weekly schedule — whichever side is wrong. They
        appear here as soon as the two agree.
        {diagnostics.truncated && ' (The roster scan also hit its student cap — see the notice below.)'}
      </span>
    </div>
  )
}

export default function FacultyAttendance() {
  const { user } = useAuth()
  const collegeId = (user as { collegeId?: string } | null)?.collegeId || ''
  const {
    facultyId,
    selectedDate,
    setSelectedDate,
    classSessions,
    selectedClass,
    setSelectedClass,
    students,
    rosterDiagnostics,
    attendance,
    existingAttendance,
    loading,
    saving,
    error,
    saveSuccess,
    stats,
    updateStudentStatus,
    updateStudentNotes,
    setAllStatus,
    resetAttendance,
    handleSave,
    selfHealOnce,
  } = useFacultyAttendance();

  // The schedule left its semester blank, so the roster was widened to every
  // semester: if the matched students span more than one, say so — otherwise
  // the faculty quietly marks attendance for two cohorts at once.
  const rosterSemesterSpread =
    rosterDiagnostics?.matchedSemesters && rosterDiagnostics.matchedSemesters.length > 1
      ? rosterDiagnostics.matchedSemesters
      : null

  const { 
    exportFacultyAttendance, 
    exporting,
    selectedRangeType,
    setSelectedRangeType,
    customStartDate,
    setCustomStartDate,
    customEndDate,
    setCustomEndDate,
    currentRange,
  } = useAttendanceExport();

  const [searchQuery, setSearchQuery] = useState('')
  const [filterStatus, setFilterStatus] = useState<AttendanceStatus | 'all'>('all')

  // ─── Slice 2 S2.3: tag the topics this class covered ─────────────────────
  // Marking a class complete writes the session's topicIds AND flips the
  // faculty topic ledger in one server-side transaction, which is what makes
  // the coverage numbers in Curriculum Progress real instead of typed in.
  const [topicOptions, setTopicOptions] = useState<SessionTopicOption[]>([])
  const [selectedTopicIds, setSelectedTopicIds] = useState<string[]>([])
  const [extraTopic, setExtraTopic] = useState('')
  const [completing, setCompleting] = useState(false)
  const [completeNotice, setCompleteNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!selectedClass || !facultyId) {
      setTopicOptions([])
      return
    }
    let active = true
    setSelectedTopicIds([])
    setExtraTopic('')
    setCompleteNotice(null)
    fetchSessionTopicOptions({
      facultyId,
      subject: selectedClass.subject,
      subjectCode: selectedClass.subjectCode,
      collegeId,
    })
      .then(options => { if (active) setTopicOptions(options) })
      .catch(() => { if (active) setTopicOptions([]) })
    return () => { active = false }
  }, [selectedClass, facultyId, collegeId])

  const toggleTopic = (id: string) => {
    setSelectedTopicIds(prev =>
      prev.includes(id) ? prev.filter(existing => existing !== id) : [...prev, id]
    )
  }

  const handleMarkComplete = async () => {
    if (!selectedClass) return
    // Attendance is what earns a completion: a class that was never marked has
    // no session worth completing. Gate on the SAVED RECORD (which survives
    // reloads) rather than the in-memory `materialised` flag (which goes stale
    // the moment a save materialises the session without a refetch — the old
    // gate told freshly-saved classes to "save first", forever).
    if (!existingAttendance) {
      setCompleteNotice('Save the attendance for this class first — that is what creates the session to complete.')
      return
    }
    setCompleting(true)
    setCompleteNotice(null)
    // Repair path: the save's own ensure can fail silently (attendance is
    // never lost for it), leaving a saved class with no session document.
    // ensureClassSession is idempotent get-or-create, so this is free when the
    // session already exists and a heal when it does not. Mirrors the
    // saveAttendance input mapping in facultyApi.ts.
    let sessionId = selectedClass.id
    if (!selectedClass.materialised) {
      try {
        const ensured = await ensureClassSession({
          date: normalizeSessionDate(selectedClass.date) || selectedClass.date,
          weeklyScheduleId: selectedClass.source === 'weekly'
            ? (selectedClass.weeklyScheduleId || parseSlotDateKey(selectedClass.id)?.weeklyScheduleId)
            : undefined,
          facultyId: selectedClass.facultyId || facultyId,
          facultyName: selectedClass.facultyName || undefined,
          subject: selectedClass.subject,
          subjectCode: selectedClass.subjectCode,
          branch: selectedClass.branch,
          batch: selectedClass.batch,
          semester: selectedClass.semester,
          division: selectedClass.division,
          section: selectedClass.section,
          room: selectedClass.room,
          startTime: selectedClass.startTime,
          endTime: selectedClass.endTime,
        })
        sessionId = ensured.id
        setSelectedClass(prev => prev && prev.id === selectedClass.id
          ? { ...prev, id: ensured.id, materialised: true }
          : prev)
      } catch (err) {
        setCompleteNotice(err instanceof Error ? err.message : 'Could not prepare this class session — please try again.')
        setCompleting(false)
        return
      }
    }
    const chosen = topicOptions.filter(option => selectedTopicIds.includes(option.id))
    // Pairs first: a curriculum option's id is a COMPOSITE
    // (curriculumId__module__topicKey), which the server cannot resolve
    // against the `topics/*` bank — the title has to travel with it or the
    // topic silently stops being attached/covered. topicIds/topicTitles
    // stay for older deployed functions, which ignore `topics`.
    const topics = chosen.map(option => ({
      topicId: option.source === 'curriculum' ? option.id : '',
      title: option.title,
    }))
    if (extraTopic.trim()) topics.push({ topicId: '', title: extraTopic.trim() })
    const payload = {
      sessionId,
      topics,
      topicIds: chosen.filter(option => option.source === 'curriculum').map(option => option.id),
      topicTitles: [
        ...chosen.filter(option => option.source === 'ledger').map(option => option.title),
        ...(extraTopic.trim() ? [extraTopic.trim()] : []),
      ],
    }
    try {
      let result
      try {
        result = await completeClassSession(payload)
      } catch (err) {
        // The callable authorises from the caller's token claims, so a token
        // minted before this account's role/college existed is refused exactly
        // the way it refuses the attendance write. Re-issue once and retry —
        // completing a session is idempotent server-side (topics are merged,
        // never replaced), so the retry cannot double-count.
        if (!isPermissionDeniedError(err)) throw err
        const outcome = await selfHealOnce()
        if (outcome !== 'refreshed') throw err
        result = await completeClassSession(payload)
      }
      const parts = [`Marked complete — ${result.topicsAttached} topic(s) attached.`]
      if (result.ledgerRowsUpdated) parts.push(`${result.ledgerRowsUpdated} ledger row(s) set to covered.`)
      if (result.ledgerRowsCreated) parts.push(`${result.ledgerRowsCreated} new ledger row(s) created.`)
      if (result.alreadyCovered) parts.push(`${result.alreadyCovered} already covered.`)
      setCompleteNotice(parts.join(' '))
      setSelectedTopicIds([])
      setExtraTopic('')
    } catch (err) {
      setCompleteNotice(err instanceof Error ? err.message : 'Could not mark this class complete')
    } finally {
      setCompleting(false)
    }
  }

  const filteredStudents = useMemo(() => {
    return students.filter((s: FacultyStudent) => {
      const matchesSearch = s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            s.usn.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            s.regNo.toLowerCase().includes(searchQuery.toLowerCase())
      const matchesFilter = filterStatus === 'all' || attendance[s.id]?.status === filterStatus
      return matchesSearch && matchesFilter
    })
  }, [students, searchQuery, filterStatus, attendance])

  const getExportRows = (): FacultyExportRow[] => {
    return filteredStudents.map((student: FacultyStudent) => ({
      date: selectedClass?.date || selectedDate,
      timeSlot: selectedClass?.timeSlot || '',
      subject: selectedClass?.subject || 'Unknown',
      subjectCode: selectedClass?.subjectCode || '',
      branch: selectedClass?.branch || '',
      batch: selectedClass?.batch || '',
      division: selectedClass?.division || '',
      section: selectedClass?.section || '',
      room: selectedClass?.room || '',
      studentName: student.name,
      usn: student.usn,
      regNo: student.regNo,
      status: attendance[student.id]?.status || 'Present',
      notes: attendance[student.id]?.notes || '',
      markedBy: selectedClass?.facultyName || 'Faculty',
    }));
  };

  const hasAttendanceData = filteredStudents.length > 0;
  const isAttendanceAlreadySaved = !!existingAttendance;

  if (loading && students.length === 0) {
    return (
      <div className="p-6 lg:p-8 max-w-7xl mx-auto flex flex-col items-center justify-center min-h-[60vh]">
        <Loader2 className="w-10 h-10 text-blue-500 animate-spin mb-4" />
        <p className="text-slate-500 dark:text-slate-400">Loading class sessions and students...</p>
      </div>
    )
  }

  if (error && students.length === 0) {
    return (
      <div className="p-6 lg:p-8 max-w-7xl mx-auto flex flex-col items-center justify-center min-h-[60vh]">
        <AlertTriangle className="w-12 h-12 text-rose-400 mb-4" />
        <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Failed to Load</h2>
        <p className="text-slate-500 dark:text-slate-400 text-center max-w-md">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-4 px-4 py-2 bg-blue-600 text-slate-900 dark:text-white rounded-lg text-sm hover:bg-blue-700 transition-colors"
        >
          Retry
        </button>
      </div>
    )
  }

  if (classSessions.length === 0 && !loading) {
    return (
      <div className="p-6 lg:p-8 max-w-7xl mx-auto flex flex-col items-center justify-center min-h-[60vh]">
        <Calendar className="w-12 h-12 text-slate-600 dark:text-slate-400 mb-4" />
        <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2">No Classes Scheduled</h2>
        <p className="text-slate-500 dark:text-slate-400 text-center max-w-md mb-4">
          No recurring or rescheduled classes were found for this date. Choose another date or contact your admin.
        </p>
        <input
          type="date"
          value={selectedDate}
          onChange={(event) => setSelectedDate(event.target.value)}
          className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50"
        />
        <Link to="/faculty/schedule" className="mt-4 text-sm text-blue-500 hover:text-blue-600 dark:text-blue-400">
          View my weekly schedule
        </Link>
      </div>
    )
  }

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <Link
          to="/faculty"
          className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-blue-500/30 text-slate-500 dark:text-slate-400 hover:text-blue-500 transition-all"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Mark Attendance</h1>
          <p className="text-slate-500 dark:text-slate-400">
            {selectedClass
              ? `${selectedClass.subject} (${selectedClass.subjectCode}) • ${selectedClass.branch} • ${selectedClass.batch} • ${[selectedClass.division, selectedClass.section].filter(Boolean).join(' / ').replace(/,/g, '+')} • ${selectedClass.timeSlot}`
              : "Select a class session"}
          </p>
          {selectedClass && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <MergedDivisionChip
                division={[selectedClass.division, selectedClass.section].filter(Boolean).join(',')}
                studentCount={students.length}
              />
              {students.length > 0 && ([selectedClass.division, selectedClass.section].join(',').match(/[,/;|&+]/)) && (
                <span className="text-xs text-slate-500 dark:text-slate-400">Attendance is saved separately for each student.</span>
              )}
            </div>
          )}
        </div>
        {isAttendanceAlreadySaved && (
          <span className="ml-auto px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-medium border border-emerald-500/20">
            Already Saved
          </span>
        )}
      </div>

      <div className="mb-6 p-4 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 sm:flex-wrap">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-slate-400 shrink-0" />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="flex-1 sm:flex-none bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 sm:py-1.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            />
          </div>
          <div className="hidden sm:block h-4 w-px bg-slate-300 dark:bg-slate-600" />
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm text-slate-500 dark:text-slate-400 shrink-0">Class:</span>
            <select
              value={selectedClass?.id || ""}
              onChange={(e) => {
                const cls = classSessions.find((c: FacultyClassSession) => c.id === e.target.value)
                if (cls) setSelectedClass(cls)
              }}
              className="bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-1.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 w-full min-w-0 sm:w-auto sm:min-w-[280px] sm:max-w-md py-2 sm:py-1.5"
            >
              {classSessions.map((c: FacultyClassSession) => (
                <option key={c.id} value={c.id}>
                  {c.subject} ({c.subjectCode}) • {c.branch} {c.batch} • {[c.division, c.section].filter(Boolean).join(' / ').replace(/,/g, '+')} • {c.timeSlot} {c.attendanceMarked ? '✓' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="hidden sm:block h-4 w-px bg-slate-300 dark:bg-slate-600" />
          <div className="flex items-center gap-3 text-slate-500 dark:text-slate-400">
            <span className="flex items-center gap-1.5">
              <Users className="w-4 h-4" />
              <span className="text-sm">{students.length} students</span>
            </span>
            {selectedClass?.room && (
              <>
                <span className="h-4 w-px bg-slate-300 dark:bg-slate-600" />
                <span className="text-sm">Room: {selectedClass.room}</span>
              </>
            )}
          </div>
        </div>
        {selectedClass?.topicsPlanned && selectedClass.topicsPlanned.length > 0 && (
          <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700 flex items-center gap-2 flex-wrap">
            <span className="text-xs text-slate-500 dark:text-slate-400">Topics:</span>
            {selectedClass.topicsPlanned.map((topic: string, i: number) => (
              <span key={i} className="px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 text-xs border border-blue-200 dark:border-blue-500/20">
                {topic}
              </span>
            ))}
          </div>
        )}

        {/* ─── Slice 2 S2.3: tag what this class actually covered ───────── */}
        <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-2 mb-1">
            <BookOpen className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
              Topics covered in this class
            </span>
            <span className="text-xs text-slate-400 dark:text-slate-500">
              — marking complete updates your topic ledger
            </span>
          </div>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mb-2">
            A class is one 50-minute period — tick only the topics THIS class covered (usually 1–2).
            Unticked topics stay pending and carry over to later classes.
          </p>

          {topicOptions.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {topicOptions.map(option => {
                const active = selectedTopicIds.includes(option.id)
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => toggleTopic(option.id)}
                    className={`px-2 py-0.5 rounded-md text-xs border transition-all ${
                      option.covered
                        ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20'
                        : active
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-slate-50 dark:bg-slate-700/50 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600 hover:border-blue-500/40'
                    }`}
                    title={option.covered ? 'Already covered' : option.source === 'curriculum' ? 'Curriculum topic' : 'Your topic'}
                  >
                    {option.covered && <CheckCircle2 className="w-3 h-3 inline mr-1" />}
                    {option.title}
                  </button>
                )
              })}
            </div>
          ) : (
            <p className="text-xs text-slate-400 dark:text-slate-500 mb-2">
              No curriculum topics found for this subject — type one below and it will be added to your ledger.
            </p>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1 flex-1 min-w-[200px]">
              <Plus className="w-3.5 h-3.5 text-slate-400" />
              <input
                type="text"
                value={extraTopic}
                onChange={event => setExtraTopic(event.target.value)}
                placeholder="Or type a topic not in the list..."
                className="flex-1 bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-1 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              />
            </div>
            <button
              type="button"
              onClick={handleMarkComplete}
              disabled={completing || selectedClass?.status === 'cancelled'}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {completing ? 'Saving…' : 'Mark class complete'}
            </button>
          </div>

          {completeNotice && (
            <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">{completeNotice}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-500/5 border border-emerald-200 dark:border-emerald-500/20">
          <div className="flex items-center gap-2 mb-1">
            <Check className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
            <span className="text-sm text-emerald-600 dark:text-emerald-400">Present</span>
          </div>
          <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400">{stats.present}</p>
        </div>
        <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-500/5 border border-rose-200 dark:border-rose-500/20">
          <div className="flex items-center gap-2 mb-1">
            <X className="w-4 h-4 text-rose-500 dark:text-rose-400" />
            <span className="text-sm text-rose-600 dark:text-rose-400">Absent</span>
          </div>
          <p className="text-xl font-bold text-rose-600 dark:text-rose-400">{stats.absent}</p>
        </div>
        <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-500/5 border border-amber-200 dark:border-amber-500/20">
          <div className="flex items-center gap-2 mb-1">
            <Clock className="w-4 h-4 text-amber-500 dark:text-amber-400" />
            <span className="text-sm text-amber-600 dark:text-amber-400">Late</span>
          </div>
          <p className="text-xl font-bold text-amber-600 dark:text-amber-400">{stats.late}</p>
        </div>
        <div className="p-3 rounded-xl bg-purple-50 dark:bg-purple-500/5 border border-purple-200 dark:border-purple-500/20">
          <div className="flex items-center gap-2 mb-1">
            <FileMinus className="w-4 h-4 text-purple-500 dark:text-purple-400" />
            <span className="text-sm text-purple-600 dark:text-purple-400">Leave</span>
          </div>
          <p className="text-xl font-bold text-purple-600 dark:text-purple-400">{stats.leave}</p>
        </div>
        <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-500/5 border border-blue-200 dark:border-blue-500/20">
          <div className="flex items-center gap-2 mb-1">
            <AlertCircle className="w-4 h-4 text-blue-500 dark:text-blue-400" />
            <span className="text-sm text-blue-600 dark:text-blue-400">On Duty</span>
          </div>
          <p className="text-xl font-bold text-blue-600 dark:text-blue-400">{stats.onDuty}</p>
        </div>
        <div className="p-3 rounded-xl bg-pink-50 dark:bg-pink-500/5 border border-pink-200 dark:border-pink-500/20">
          <div className="flex items-center gap-2 mb-1">
            <Pill className="w-4 h-4 text-pink-500 dark:text-pink-400" />
            <span className="text-sm text-pink-600 dark:text-pink-400">Medical</span>
          </div>
          <p className="text-xl font-bold text-pink-600 dark:text-emerald-400">{stats.medicalLeave}</p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setAllStatus('Present')}
            className="px-3 py-1.5 rounded-lg text-sm bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 transition-all"
          >
            Mark all present
          </button>
          <button
            onClick={() => setAllStatus('Absent')}
            className="px-3 py-1.5 rounded-lg text-sm bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-500/20 hover:bg-rose-100 dark:hover:bg-rose-500/20 transition-all"
          >
            All Absent
          </button>
          <button
            onClick={() => setAllStatus('Late')}
            className="px-3 py-1.5 rounded-lg text-sm bg-amber-50 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-500/20 hover:bg-amber-100 dark:hover:bg-amber-100 dark:bg-amber-900/30 transition-all"
          >
            All Late
          </button>
          <button
            onClick={resetAttendance}
            className="px-3 py-1.5 rounded-lg text-sm bg-slate-100 dark:bg-slate-700/50 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-600 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all flex items-center gap-1"
          >
            <RotateCcw className="w-3 h-3" /> Reset
          </button>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:flex-none">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search by name, USN, or reg no..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full sm:w-56 pl-9 pr-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            />
          </div>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as AttendanceStatus | 'all')}
            className="px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50"
          >
            <option value="all">All Status</option>
            <option value="Present">Present</option>
            <option value="Absent">Absent</option>
            <option value="Late">Late</option>
            <option value="Leave">Leave</option>
            <option value="OnDuty">On Duty</option>
            <option value="MedicalLeave">Medical Leave</option>
          </select>

          <ExportButton
            onExport={(format: string) =>
              exportFacultyAttendance(
                format as any,
                getExportRows(),
                selectedClass?.subject || 'Class',
                selectedClass?.date || selectedDate
              )
            }
            exporting={exporting}
            hasData={hasAttendanceData}
            label="Export"
          />
        </div>
        
        {/* Date Range Selector for Reports */}
        <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
          <DateRangeSelector
            selectedType={selectedRangeType}
            onTypeChange={setSelectedRangeType as (type: DateRangeType) => void}
            customStartDate={customStartDate}
            onCustomStartChange={setCustomStartDate}
            customEndDate={customEndDate}
            onCustomEndChange={setCustomEndDate}
            currentRange={currentRange}
          />
        </div>
      </div>

      {students.length > 0 && rosterSemesterSpread && (
        <div className="mb-4 p-3 rounded-xl border border-amber-300/70 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 flex items-start gap-2 text-xs text-amber-900 dark:text-amber-200">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            The schedule has no semester set, so this roster spans semesters{' '}
            {rosterSemesterSpread.join(', ')} — set a semester on the schedule to narrow it to one cohort.
          </span>
        </div>
      )}

      {students.length > 0 && rosterDiagnostics && (
        <RosterExclusionNotice diagnostics={rosterDiagnostics} />
      )}

      {students.length === 0 && rosterDiagnostics && rosterDiagnostics.collegeTotal > 0 ? (
        <RosterDiagnosticPanel diagnostics={rosterDiagnostics} />
      ) : (
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden mb-6 shadow-sm">
        {/* Mobile roster: one tappable card per student (table below is md+) */}
        <ul className="md:hidden divide-y divide-slate-200 dark:divide-slate-700 bg-white dark:bg-slate-800/40">
          {filteredStudents.map((student: FacultyStudent, index: number) => {
            const status: AttendanceStatus = attendance[student.id]?.status || 'Present'
            const config = statusConfig[status]
            const StatusIcon = config.icon
            const pct = student.attendancePercentage
            const pctColor = pct >= 85 ? 'text-emerald-600 dark:text-emerald-400' : pct >= 75 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'
            return (
              <li key={student.id} className="px-3 py-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 shrink-0 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-sm font-semibold text-slate-600 dark:text-slate-300">
                    {student.name.charAt(0)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                      <span className="text-slate-400 mr-1.5">{index + 1}.</span>{student.name}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono truncate">
                      {student.usn || student.regNo || '—'} · {student.batch}{student.division ? ` · ${student.division}` : ''} · <span className={pctColor}>{pct}%</span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const nextIndex = (allStatuses.indexOf(status) + 1) % allStatuses.length
                      updateStudentStatus(student.id, allStatuses[nextIndex])
                    }}
                    className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-lg text-xs font-medium border transition-all active:scale-95 ${config.bg} ${config.color} ${config.border}`}
                    aria-label={`Status for ${student.name}: ${config.label}. Tap to change.`}
                  >
                    <StatusIcon className="w-3.5 h-3.5" />
                    {config.label}
                  </button>
                </div>
                {(attendance[student.id]?.notes || status !== 'Present') && (
                  <input
                    type="text"
                    placeholder="Add a note (optional)"
                    value={attendance[student.id]?.notes || ''}
                    onChange={(e) => updateStudentNotes(student.id, e.target.value)}
                    className="mt-2 w-full bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  />
                )}
              </li>
            )
          })}
        </ul>
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700">
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider w-12">#</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Student</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">USN</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Reg No</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Batch/Div</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Notes</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Attendance %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {filteredStudents.map((student: FacultyStudent, index: number) => {
                const status: AttendanceStatus = attendance[student.id]?.status || 'Present'
                const config = statusConfig[status]
                const StatusIcon = config.icon

                return (
                  <tr key={student.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400">{index + 1}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-sm font-semibold text-slate-600 dark:text-slate-300">
                          {student.name.charAt(0)}
                        </div>
                        <span className="text-sm font-medium text-slate-900 dark:text-white">{student.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-400 font-mono">{student.usn}</td>
                    <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-400 font-mono">{student.regNo}</td>
                    <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-400">
                      {student.batch} · {student.division}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => {
                          const current: AttendanceStatus = attendance[student.id]?.status || 'Present'
                          const nextIndex = (allStatuses.indexOf(current) + 1) % allStatuses.length
                          updateStudentStatus(student.id, allStatuses[nextIndex])
                        }}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all hover:opacity-80 ${config.bg} ${config.color} ${config.border}`}
                      >
                        <StatusIcon className="w-3.5 h-3.5" />
                        {config.label}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="text"
                        placeholder="Add notes..."
                        value={attendance[student.id]?.notes || ''}
                        onChange={(e) => updateStudentNotes(student.id, e.target.value)}
                        className="w-full bg-transparent text-sm text-slate-700 dark:text-slate-300 placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none focus:text-slate-900 dark:focus:text-white"
                      />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <div className="w-16 bg-slate-200 dark:bg-slate-700/50 rounded-full h-1.5 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              student.attendancePercentage >= 85 ? 'bg-emerald-500' :
                              student.attendancePercentage >= 75 ? 'bg-amber-500' : 'bg-rose-500'
                            }`}
                            style={{ width: `${Math.min(student.attendancePercentage, 100)}%` }}
                          />
                        </div>
                        <span className={`text-xs font-medium ${
                          student.attendancePercentage >= 85 ? 'text-emerald-600 dark:text-emerald-400' :
                          student.attendancePercentage >= 75 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'
                        }`}>
                          {student.attendancePercentage}%
                        </span>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {filteredStudents.length === 0 && (
          <div className="text-center py-12 text-slate-500 dark:text-slate-400">
            {students.length === 0 && rosterDiagnostics && rosterDiagnostics.collegeTotal === 0 ? (
              <>
                <Users className="w-8 h-8 mx-auto mb-3 opacity-50" />
                <p className="text-sm">No students are enrolled at this college yet.</p>
                <p className="text-xs mt-1 opacity-80">
                  Import the student list from Admin → Students, then mark attendance.
                </p>
              </>
            ) : (
              <>
                <Search className="w-8 h-8 mx-auto mb-3 opacity-50" />
                <p className="text-sm">No students found matching your criteria</p>
              </>
            )}
          </div>
        )}
      </div>
      )}

      <div className="sticky bottom-0 -mx-4 sm:mx-0 px-4 sm:px-0 py-3 sm:py-0 bg-slate-50/95 dark:bg-[#0b0f19]/95 sm:bg-transparent sm:dark:bg-transparent backdrop-blur sm:backdrop-blur-none border-t border-slate-200 dark:border-slate-800 sm:border-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
        <div className="text-sm text-slate-500 dark:text-slate-400">
          Marked: {stats.present + stats.absent + stats.late + stats.leave + stats.onDuty + stats.medicalLeave} / {stats.total} students
          {isAttendanceAlreadySaved && existingAttendance && (
            <span className="ml-2 text-emerald-600 dark:text-emerald-400">
              • Previously saved at {new Date(existingAttendance.markedAt).toLocaleTimeString()}
            </span>
          )}
        </div>
        <button
          onClick={handleSave}
          disabled={saving || students.length === 0}
          className="w-full sm:w-auto justify-center flex items-center gap-2 px-6 py-3 sm:py-2.5 rounded-xl bg-blue-600 text-white hover:bg-blue-700 transition-all font-medium disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'Saving...' : isAttendanceAlreadySaved ? 'Update Attendance' : 'Save Attendance'}
        </button>
      </div>

      {saveSuccess && (
        <div className="fixed bottom-24 sm:bottom-6 left-4 right-4 sm:left-auto sm:right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl bg-emerald-50 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30 shadow-lg">
          <Check className="w-4 h-4" />
          <span className="text-sm font-medium">Attendance saved successfully!</span>
        </div>
      )}

      {error && (
        <div className="fixed bottom-24 sm:bottom-6 left-4 right-4 sm:left-auto sm:right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl bg-rose-50 dark:bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-500/30 shadow-lg">
          <AlertTriangle className="w-4 h-4" />
          <span className="text-sm font-medium">{error}</span>
        </div>
      )}
    </div>
  )
}