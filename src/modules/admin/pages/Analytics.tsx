// src/pages/Analytics.tsx
// Analytics dashboard — uses useDashboardData hook
// NO direct Firestore calls. NO onSnapshot.

import { sameBranch } from '@/shared/utils/branchKey';
import React, { useState, useMemo } from 'react'
import {
  BarChart3, TrendingUp, Users, BookOpen, Calendar,
  Download, Filter, RefreshCw, Loader2, Award, ArrowUpRight,
  ArrowDownRight, GraduationCap, ClipboardCheck, Activity,
  Target, BarChart2, PieChart as PieChartIcon, Layers
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, Legend
} from 'recharts'
import { useDashboardData } from '../../admin/hooks/useDashboardData'
import { useThemeMode } from '../../../shared/contexts/ThemeProvider'

// ─── Color Palette ─────────────────────────────────────
const COLORS = {
  primary: '#14b8a6',
  accent: '#6366f1',
  success: '#22c55e',
  warning: '#f59e0b',
  danger: '#ef4444',
  info: '#3b82f6',
  purple: '#a855f7',
  pink: '#ec4899',
  slate: '#64748b',
}

const GRADE_COLORS: Record<string, string> = {
  'A': '#22c55e',
  'B': '#6366f1',
  'C': '#f59e0b',
  'D': '#f97316',
  'F': '#ef4444',
}

// ─── Custom Tooltip ──────────────────────────────────────
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload || !payload.length) return null
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 shadow-xl">
      <p className="text-sm font-semibold text-slate-900 dark:text-white mb-2">{label}</p>
      {payload.map((entry: any, idx: number) => (
        <div key={idx} className="flex items-center gap-2 text-xs">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
          <span className="text-slate-500 dark:text-slate-400">{entry.name}:</span>
          <span className="text-slate-900 dark:text-white font-medium">
            {typeof entry.value === 'number' ? entry.value.toFixed(1) : entry.value}
            {entry.unit || ''}
          </span>
        </div>
      ))}
    </div>
  )
}

// ─── Stat Card ───────────────────────────────────────────
function StatCard({
  label, value, subtext, icon: Icon, color, trend, trendUp, loading
}: {
  label: string
  value: string | number
  subtext?: string
  icon: React.ElementType
  color: string
  trend?: string
  trendUp?: boolean
  loading?: boolean
}) {
  return (
    <div className="stat-card relative overflow-hidden group">
      <div className={`absolute top-0 right-0 w-24 h-24 rounded-full opacity-5 -mr-8 -mt-8 ${color}`} />
      <div className="flex items-start justify-between mb-4">
        <div className={`w-11 h-11 rounded-xl ${color} bg-opacity-20 flex items-center justify-center`}>
          <Icon className="w-5 h-5" style={{ color: 'inherit' }} />
        </div>
        {trend && (
          <div className={`flex items-center gap-1 text-xs font-medium ${trendUp ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
            {trendUp ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
            {trend}
          </div>
        )}
      </div>
      {loading ? (
        <Loader2 className="w-7 h-7 animate-spin text-vriddhi-muted" />
      ) : (
        <p className="text-2xl font-bold text-slate-900 dark:text-white">{value}</p>
      )}
      <p className="text-xs text-vriddhi-muted mt-1">{label}</p>
      {subtext && <p className="text-[10px] text-vriddhi-muted/60 mt-0.5">{subtext}</p>}
    </div>
  )
}

// ─── Main Component ──────────────────────────────────────
function useChartTheme() {
  const { resolvedMode } = useThemeMode();
  return {
    grid: resolvedMode === 'dark' ? '#334155' : '#e2e8f0',
    axis: resolvedMode === 'dark' ? '#94a3b8' : '#64748b',
  };
}

export default function Analytics() {
  const chartTheme = useChartTheme();
  const {
    loading,
    filters,
    filteredStudentCount,
    attendanceRate,
    weeklyAttendance,
    branchTotals,
    performanceTrend,
    topPerformers,
    activeAssessments,
    passRate,
    students,
    attendanceRecords,
    assessments,
    scores,
    updateFilters,
    refreshData,
  } = useDashboardData()

  // ─── Computed Analytics Data ─────────────────────────
  const computedData = useMemo(() => {
    let filteredStudents = students.filter(s => s.status === 'active')
    if (filters.studentBranch !== 'all') {
      filteredStudents = filteredStudents.filter(s => sameBranch(s.course, filters.studentBranch))
    }
    if (filters.studentBatch !== 'all') {
      filteredStudents = filteredStudents.filter(s => s.batch === filters.studentBatch)
    }

    const courses = Array.from(new Set(students.map(s => s.course)))
    const coursePerformance = courses.map(course => {
      const courseStudents = filteredStudents.filter(s => s.course === course)
      const courseScores = scores.filter(s => {
        const student = students.find(st => st.id === s.studentId)
        return student?.course === course
      })
      const percentages = courseScores.map(s => s.percentage)
      const avg = percentages.length ? percentages.reduce((a, b) => a + b, 0) / percentages.length : 0
      const highest = percentages.length ? Math.max(...percentages) : 0
      const lowest = percentages.length ? Math.min(...percentages) : 0
      return {
        course,
        avg: Math.round(avg * 10) / 10,
        highest,
        lowest,
        studentCount: courseStudents.length,
      }
    }).sort((a, b) => b.avg - a.avg)

    const gradeCounts: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, F: 0 }
    scores.forEach(s => {
      gradeCounts[s.grade] = (gradeCounts[s.grade] || 0) + 1
    })
    const gradeDistribution = Object.entries(gradeCounts)
      .filter(([_, count]) => count > 0)
      .map(([grade, count]) => ({
        name: `${grade} (${getGradeRange(grade)})`,
        value: count,
        color: GRADE_COLORS[grade] || COLORS.slate,
        grade,
      }))

    const monthlyTrendMap: Record<string, Record<string, number[]>> = {}
    scores.forEach(score => {
      const assessment = assessments.find(a => a.id === score.assessmentId)
      const student = students.find(s => s.id === score.studentId)
      if (assessment && student) {
        const month = new Date(assessment.date).toLocaleString('en-US', { month: 'short' })
        if (!monthlyTrendMap[month]) monthlyTrendMap[month] = {}
        if (!monthlyTrendMap[month][student.course]) monthlyTrendMap[month][student.course] = []
        monthlyTrendMap[month][student.course].push(score.percentage)
      }
    })

    const months = Object.keys(monthlyTrendMap).sort((a, b) => {
      const m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
      return m.indexOf(a) - m.indexOf(b)
    })

    const monthlyTrend = months.map(month => {
      const entry: any = { month }
      courses.forEach(course => {
        const vals = monthlyTrendMap[month]?.[course] || []
        entry[course.toLowerCase()] = vals.length
          ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 10) / 10
          : 0
      })
      return entry
    })

    const batches = Array.from(new Set(students.map(s => s.batch))).sort()
    const batchPerformance = batches.map(batch => {
      const batchStudents = students.filter(s => s.batch === batch)
      const batchScores = scores.filter(s => {
        const student = students.find(st => st.id === s.studentId)
        return student?.batch === batch
      })
      const percentages = batchScores.map(s => s.percentage)
      const avg = percentages.length ? percentages.reduce((a, b) => a + b, 0) / percentages.length : 0
      return {
        batch,
        avg: Math.round(avg * 10) / 10,
        students: batchStudents.length,
        assessments: batchScores.length,
      }
    })

    const assessmentStatus = [
      { name: 'Completed', value: assessments.filter(a => a.status === 'completed').length, color: COLORS.success },
      { name: 'Active', value: assessments.filter(a => a.status === 'active').length, color: COLORS.primary },
      { name: 'Upcoming', value: assessments.filter(a => a.status === 'upcoming').length, color: COLORS.warning },
    ].filter(s => s.value > 0)

    const mentorMap: Record<string, { students: Set<string>; present: number; total: number }> = {}
    attendanceRecords.forEach(record => {
      if (!mentorMap[record.markedBy]) {
        mentorMap[record.markedBy] = { students: new Set(), present: 0, total: 0 }
      }
      mentorMap[record.markedBy].students.add(record.studentId)
      mentorMap[record.markedBy].total++
      if (record.status === 'present') mentorMap[record.markedBy].present++
    })

    const mentorScores: Record<string, number[]> = {}
    scores.forEach(score => {
      const student = students.find(s => s.id === score.studentId)
      if (student) {
        const courseMentors = attendanceRecords
          .filter(r => r.course === student.course)
          .map(r => r.markedBy)
        const mentor = courseMentors[0] || 'Unknown'
        if (!mentorScores[mentor]) mentorScores[mentor] = []
        mentorScores[mentor].push(score.percentage)
      }
    })

    const mentorPerformance = Object.entries(mentorMap).map(([name, data]) => {
      const scoreList = mentorScores[name] || []
      const avgScore = scoreList.length ? scoreList.reduce((a, b) => a + b, 0) / scoreList.length : 0
      return {
        name,
        students: data.students.size,
        avg: Math.round(avgScore * 10) / 10,
        attendance: data.total ? Math.round((data.present / data.total) * 1000) / 10 : 0,
        classes: data.total,
      }
    }).sort((a, b) => b.avg - a.avg)

    const subjectMap: Record<string, number[]> = {}
    scores.forEach(score => {
      const assessment = assessments.find(a => a.id === score.assessmentId)
      if (assessment) {
        if (!subjectMap[assessment.subject]) subjectMap[assessment.subject] = []
        subjectMap[assessment.subject].push(score.percentage)
      }
    })
    const subjectPerformance = Object.entries(subjectMap)
      .map(([subject, vals]) => ({
        subject,
        avg: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 10) / 10,
        count: vals.length,
      }))
      .sort((a, b) => b.avg - a.avg)
      .slice(0, 8)

    return {
      coursePerformance,
      gradeDistribution,
      monthlyTrend,
      batchPerformance,
      assessmentStatus,
      mentorPerformance,
      subjectPerformance,
      totalStudents: filteredStudents.length,
      totalAssessments: assessments.length,
      totalScores: scores.length,
    }
  }, [students, attendanceRecords, assessments, scores, filters])

  function getGradeRange(grade: string): string {
    switch (grade) {
      case 'A': return '90-100'
      case 'B': return '80-89'
      case 'C': return '70-79'
      case 'D': return '60-69'
      case 'F': return 'Below 60'
      default: return ''
    }
  }

  const branches = ['all', ...Array.from(new Set(students.map(s => s.course)))]
  const batches = ['all', ...Array.from(new Set(students.map(s => s.batch))).sort().reverse()]

  const overallAvg = useMemo(() => {
    if (!scores.length) return 0
    return Math.round(scores.reduce((a, b) => a + b.percentage, 0) / scores.length * 10) / 10
  }, [scores])

  const handleExport = () => {
    const csvData = [
      ['Metric', 'Value'],
      ['Total Students', computedData.totalStudents],
      ['Overall Average', `${overallAvg}%`],
      ['Attendance Rate', `${attendanceRate}%`],
      ['Pass Rate', `${passRate}%`],
      ['Active Assessments', activeAssessments],
      ['Total Assessments', computedData.totalAssessments],
      ['Total Scores', computedData.totalScores],
      ...computedData.coursePerformance.map(c => [`${c.course} Avg`, `${c.avg}%`]),
    ]
    const csv = csvData.map(row => row.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `analytics_export_${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="page-container">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between mb-8 gap-4">
        <div>
          <h1 className="section-title mb-1 flex items-center gap-3">
            <BarChart3 className="w-7 h-7 text-vriddhi-accent" />
            Analytics Dashboard
          </h1>
          <p className="text-vriddhi-muted">Comprehensive insights into academic performance, attendance, and trends</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 bg-vriddhi-card border border-vriddhi-border rounded-xl px-3 py-2">
            <Filter className="w-4 h-4 text-vriddhi-muted" />
            <select
              value={filters.studentBranch}
              onChange={(e) => updateFilters({ studentBranch: e.target.value })}
              className="bg-transparent text-sm text-vriddhi-text focus:outline-none cursor-pointer"
            >
              {branches.map(b => <option key={b} value={b}>{b === 'all' ? 'All Courses' : b}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2 bg-vriddhi-card border border-vriddhi-border rounded-xl px-3 py-2">
            <Calendar className="w-4 h-4 text-vriddhi-muted" />
            <select
              value={filters.studentBatch}
              onChange={(e) => updateFilters({ studentBatch: e.target.value })}
              className="bg-transparent text-sm text-vriddhi-text focus:outline-none cursor-pointer"
            >
              {batches.map(b => <option key={b} value={b}>{b === 'all' ? 'All Batches' : b}</option>)}
            </select>
          </div>
          <button
            onClick={refreshData}
            className="flex items-center gap-2 px-4 py-2 bg-vriddhi-card border border-vriddhi-border rounded-xl text-sm text-vriddhi-text hover:bg-vriddhi-border/50 transition-colors"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button
            onClick={handleExport}
            className="flex items-center gap-2 px-4 py-2 bg-vriddhi-accent text-white rounded-xl text-sm hover:bg-teal-600 transition-colors"
          >
            <Download size={16} />
            Export
          </button>
        </div>
      </div>

      {/* KPI Stats Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Total Students" value={computedData.totalStudents} subtext="Active enrolled" icon={Users} color="bg-blue-500 text-blue-600 dark:text-blue-400" trend="+12%" trendUp={true} loading={loading} />
        <StatCard label="Overall Average" value={`${overallAvg}%`} subtext="Across all assessments" icon={Target} color="bg-vriddhi-accent text-teal-600 dark:text-teal-400" trend="+3.2%" trendUp={true} loading={loading} />
        <StatCard label="Avg Attendance" value={`${attendanceRate}%`} subtext="Daily attendance rate" icon={ClipboardCheck} color="bg-green-500 text-emerald-600 dark:text-emerald-400" trend="-1.5%" trendUp={false} loading={loading} />
        <StatCard label="Pass Rate" value={`${passRate}%`} subtext="Students scoring ≥ 40%" icon={GraduationCap} color="bg-amber-500 text-amber-600 dark:text-amber-400" trend="+5.1%" trendUp={true} loading={loading} />
      </div>

      {/* Secondary Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="glass-card p-4">
          <div className="flex items-center justify-between mb-2"><span className="text-xs text-vriddhi-muted">Active Assessments</span><Activity className="w-4 h-4 text-vriddhi-accent" /></div>
          <p className="text-xl font-bold text-slate-900 dark:text-white">{activeAssessments}</p>
          <p className="text-[10px] text-vriddhi-muted/60 mt-1">Currently scheduled</p>
        </div>
        <div className="glass-card p-4">
          <div className="flex items-center justify-between mb-2"><span className="text-xs text-vriddhi-muted">Total Assessments</span><BookOpen className="w-4 h-4 text-vriddhi-accent" /></div>
          <p className="text-xl font-bold text-slate-900 dark:text-white">{computedData.totalAssessments}</p>
          <p className="text-[10px] text-vriddhi-muted/60 mt-1">All time</p>
        </div>
        <div className="glass-card p-4">
          <div className="flex items-center justify-between mb-2"><span className="text-xs text-vriddhi-muted">Total Scores</span><BarChart2 className="w-4 h-4 text-vriddhi-accent" /></div>
          <p className="text-xl font-bold text-slate-900 dark:text-white">{computedData.totalScores}</p>
          <p className="text-[10px] text-vriddhi-muted/60 mt-1">Records tracked</p>
        </div>
        <div className="glass-card p-4">
          <div className="flex items-center justify-between mb-2"><span className="text-xs text-vriddhi-muted">Top Course</span><TrendingUp className="w-4 h-4 text-vriddhi-accent" /></div>
          <p className="text-xl font-bold text-slate-900 dark:text-white">{computedData.coursePerformance[0]?.course || 'N/A'}</p>
          <p className="text-[10px] text-vriddhi-muted/60 mt-1">{computedData.coursePerformance[0]?.avg || 0}% avg</p>
        </div>
      </div>

      {/* Charts Row 1: Course Performance + Grade Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="glass-card p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2"><BarChart3 className="w-5 h-5 text-vriddhi-accent" />Course Performance</h3>
              <p className="text-xs text-vriddhi-muted mt-1">Average, highest & lowest scores by course</p>
            </div>
          </div>
          {loading ? (
            <div className="h-[300px] flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-vriddhi-muted" /></div>
          ) : computedData.coursePerformance.length === 0 ? (
            <div className="h-[300px] flex items-center justify-center text-vriddhi-muted">No course data available</div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={computedData.coursePerformance} barGap={4}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} vertical={false} />
                <XAxis dataKey="course" stroke={chartTheme.axis} fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke={chartTheme.axis} fontSize={12} tickLine={false} axisLine={false} domain={[0, 100]} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                <Bar dataKey="avg" name="Average" fill={COLORS.primary} radius={[4, 4, 0, 0]} />
                <Bar dataKey="highest" name="Highest" fill={COLORS.success} radius={[4, 4, 0, 0]} />
                <Bar dataKey="lowest" name="Lowest" fill={COLORS.danger} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="glass-card p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2"><PieChartIcon className="w-5 h-5 text-vriddhi-accent" />Grade Distribution</h3>
              <p className="text-xs text-vriddhi-muted mt-1">Student grade breakdown from all assessments</p>
            </div>
          </div>
          {loading ? (
            <div className="h-[300px] flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-vriddhi-muted" /></div>
          ) : computedData.gradeDistribution.length === 0 ? (
            <div className="h-[300px] flex items-center justify-center text-vriddhi-muted">No grade data available</div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={computedData.gradeDistribution} cx="50%" cy="50%" innerRadius={70} outerRadius={100} paddingAngle={4} dataKey="value" stroke="none">
                    {computedData.gradeDistribution.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap justify-center gap-3 mt-2">
                {computedData.gradeDistribution.map((item) => (
                  <div key={item.name} className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                    <span className="text-[11px] text-vriddhi-muted">{item.name}</span>
                    <span className="text-[11px] text-slate-900 dark:text-white font-medium">({item.value})</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Charts Row 2: Monthly Trend + Weekly Attendance */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="glass-card p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2"><TrendingUp className="w-5 h-5 text-vriddhi-accent" />Monthly Performance Trend</h3>
              <p className="text-xs text-vriddhi-muted mt-1">Average scores per course over time</p>
            </div>
          </div>
          {loading ? (
            <div className="h-[300px] flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-vriddhi-muted" /></div>
          ) : computedData.monthlyTrend.length === 0 ? (
            <div className="h-[300px] flex items-center justify-center text-vriddhi-muted">No trend data available</div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={computedData.monthlyTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} vertical={false} />
                <XAxis dataKey="month" stroke={chartTheme.axis} fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke={chartTheme.axis} fontSize={12} tickLine={false} axisLine={false} domain={[60, 100]} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                {Object.keys(computedData.monthlyTrend[0] || {}).filter(k => k !== 'month').map((key, i) => (
                  <Line key={key} type="monotone" dataKey={key} name={key.toUpperCase()}
                    stroke={[COLORS.accent, COLORS.success, COLORS.warning, COLORS.info, COLORS.purple][i % 5]}
                    strokeWidth={2.5} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="glass-card p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2"><Calendar className="w-5 h-5 text-vriddhi-accent" />Weekly Attendance</h3>
              <p className="text-xs text-vriddhi-muted mt-1">Present vs Absent by day</p>
            </div>
          </div>
          {loading ? (
            <div className="h-[300px] flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-vriddhi-muted" /></div>
          ) : weeklyAttendance.length === 0 ? (
            <div className="h-[300px] flex items-center justify-center text-vriddhi-muted">No attendance data available</div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={weeklyAttendance}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} vertical={false} />
                  <XAxis dataKey="day" stroke={chartTheme.axis} fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke={chartTheme.axis} fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                  <Bar dataKey="present" name="Present" fill={COLORS.success} radius={[4, 4, 0, 0]} stackId="a" />
                  <Bar dataKey="absent" name="Absent" fill={COLORS.danger} radius={[4, 4, 0, 0]} stackId="a" />
                </BarChart>
              </ResponsiveContainer>
              <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-vriddhi-border">
                {Object.entries(branchTotals).map(([branch, data]) => (
                  <div key={branch} className="text-center">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">{branch}</p>
                    <p className="text-xs text-vriddhi-muted mt-1">{data.totalPresent} present / {data.totalAbsent} absent</p>
                    <p className="text-xs text-green-600 dark:text-green-400 mt-1 font-medium">{data.totalStudents > 0 ? ((data.totalPresent / data.totalStudents) * 100).toFixed(1) : 0}%</p>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Charts Row 3: Batch Performance + Assessment Status */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="glass-card p-6 lg:col-span-2">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2"><Layers className="w-5 h-5 text-vriddhi-accent" />Batch-wise Performance</h3>
              <p className="text-xs text-vriddhi-muted mt-1">Average scores and student count by admission batch</p>
            </div>
          </div>
          {loading ? (
            <div className="h-[280px] flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-vriddhi-muted" /></div>
          ) : computedData.batchPerformance.length === 0 ? (
            <div className="h-[280px] flex items-center justify-center text-vriddhi-muted">No batch data available</div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={computedData.batchPerformance} layout="vertical" barGap={4}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} horizontal={false} />
                <XAxis type="number" stroke={chartTheme.axis} fontSize={12} tickLine={false} axisLine={false} domain={[0, 100]} />
                <YAxis dataKey="batch" type="category" stroke={chartTheme.axis} fontSize={12} tickLine={false} axisLine={false} width={50} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                <Bar dataKey="avg" name="Avg Score" fill={COLORS.primary} radius={[0, 4, 4, 0]} />
                <Bar dataKey="students" name="Students" fill={COLORS.accent} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="glass-card p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2"><Activity className="w-5 h-5 text-vriddhi-accent" />Assessment Status</h3>
              <p className="text-xs text-vriddhi-muted mt-1">Breakdown by status</p>
            </div>
          </div>
          {loading ? (
            <div className="h-[200px] flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-vriddhi-muted" /></div>
          ) : computedData.assessmentStatus.length === 0 ? (
            <div className="h-[200px] flex items-center justify-center text-vriddhi-muted">No assessment data</div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={computedData.assessmentStatus} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={5} dataKey="value" stroke="none">
                    {computedData.assessmentStatus.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2 mt-4">
                {computedData.assessmentStatus.map(item => (
                  <div key={item.name} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                      <span className="text-xs text-vriddhi-muted">{item.name}</span>
                    </div>
                    <span className="text-xs text-slate-900 dark:text-white font-medium">{item.value}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Row 4: Subject Performance + Top Performers */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="glass-card p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2"><BookOpen className="w-5 h-5 text-vriddhi-accent" />Subject-wise Performance</h3>
              <p className="text-xs text-vriddhi-muted mt-1">Top performing subjects by average score</p>
            </div>
          </div>
          {loading ? (
            <div className="h-[300px] flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-vriddhi-muted" /></div>
          ) : computedData.subjectPerformance.length === 0 ? (
            <div className="h-[300px] flex items-center justify-center text-vriddhi-muted">No subject data available</div>
          ) : (
            <div className="space-y-3">
              {computedData.subjectPerformance.map((subject) => (
                <div key={subject.subject} className="flex items-center gap-4">
                  <div className="w-32 flex-shrink-0">
                    <p className="text-sm text-slate-900 dark:text-white font-medium truncate">{subject.subject}</p>
                    <p className="text-[10px] text-vriddhi-muted">{subject.count} scores</p>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-2.5 bg-vriddhi-dark rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${Math.min(subject.avg, 100)}%`, backgroundColor: subject.avg >= 80 ? COLORS.success : subject.avg >= 60 ? COLORS.warning : COLORS.danger }}
                        />
                      </div>
                      <span className="text-sm font-semibold text-slate-900 dark:text-white w-12 text-right">{subject.avg}%</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="glass-card p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2"><Award className="w-5 h-5 text-amber-600 dark:text-amber-400" />Top Performers</h3>
              <p className="text-xs text-vriddhi-muted mt-1">Highest average scores across all assessments</p>
            </div>
          </div>
          {loading ? (
            <div className="h-[300px] flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-vriddhi-muted" /></div>
          ) : topPerformers.length === 0 ? (
            <div className="h-[300px] flex items-center justify-center text-vriddhi-muted">No performer data available</div>
          ) : (
            <div className="space-y-3">
              {topPerformers.map((student, i) => (
                <div key={student.regNo} className="flex items-center gap-4 p-3 rounded-xl hover:bg-slate-500/5 dark:hover:bg-white/5 transition-colors group">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0
                    ${i === 0 ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-400 ring-1 ring-amber-500/30' :
                      i === 1 ? 'bg-slate-400/20 text-slate-600 dark:text-slate-400 ring-1 ring-slate-400/30' :
                      i === 2 ? 'bg-orange-600/20 text-orange-600 dark:text-orange-400 ring-1 ring-orange-600/30' :
                      'bg-vriddhi-border/30 text-vriddhi-muted'}`}>
                    {student.rank}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900 dark:text-white truncate">{student.name}</p>
                    <p className="text-xs text-vriddhi-muted">{student.regNo} · {student.course}</p>
                    <p className="text-[10px] text-vriddhi-muted/60">{student.assessmentsTaken}/{student.totalAssessments} assessments taken</p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{student.avg}%</p>
                    <p className="text-[10px] text-vriddhi-muted">avg</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Row 5: Mentor Performance Table */}
      <div className="glass-card overflow-hidden mb-8">
        <div className="p-6 border-b border-vriddhi-border">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2"><Users className="w-5 h-5 text-vriddhi-accent" />Mentor Performance</h3>
              <p className="text-xs text-vriddhi-muted mt-1">Attendance marking and student performance by mentor</p>
            </div>
          </div>
        </div>
        {loading ? (
          <div className="h-[200px] flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-vriddhi-muted" /></div>
        ) : computedData.mentorPerformance.length === 0 ? (
          <div className="h-[200px] flex items-center justify-center text-vriddhi-muted">No mentor data available</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-vriddhi-border">
                  <th className="table-header">Mentor</th>
                  <th className="table-header text-center">Students</th>
                  <th className="table-header text-center">Classes</th>
                  <th className="table-header text-center">Avg Score</th>
                  <th className="table-header text-center">Attendance</th>
                  <th className="table-header text-center">Performance</th>
                </tr>
              </thead>
              <tbody>
                {computedData.mentorPerformance.map((mentor) => (
                  <tr key={mentor.name} className="hover:bg-vriddhi-dark/30 transition-colors">
                    <td className="table-cell">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-vriddhi-accent/20 flex items-center justify-center">
                          <span className="text-xs font-bold text-vriddhi-accent">{mentor.name.split(' ').map(n => n[0]).join('')}</span>
                        </div>
                        <span className="font-medium text-slate-900 dark:text-white">{mentor.name}</span>
                      </div>
                    </td>
                    <td className="table-cell text-center">{mentor.students}</td>
                    <td className="table-cell text-center">{mentor.classes}</td>
                    <td className="table-cell text-center">
                      <span className={`font-semibold ${mentor.avg >= 80 ? 'text-green-600 dark:text-green-400' : mentor.avg >= 60 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}`}>{mentor.avg}%</span>
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center justify-center gap-2">
                        <div className="w-20 h-2 bg-vriddhi-dark rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all duration-500"
                            style={{ width: `${Math.min(mentor.attendance, 100)}%`, backgroundColor: mentor.attendance >= 90 ? COLORS.success : mentor.attendance >= 75 ? COLORS.warning : COLORS.danger }}
                          />
                        </div>
                        <span className="text-xs text-vriddhi-muted w-10">{mentor.attendance}%</span>
                      </div>
                    </td>
                    <td className="table-cell text-center">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                        mentor.avg >= 80 ? 'bg-green-500/15 text-green-600 dark:text-green-400 ring-1 ring-green-500/20' :
                        mentor.avg >= 60 ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 ring-1 ring-amber-500/20' :
                        'bg-red-500/15 text-red-600 dark:text-red-400 ring-1 ring-red-500/20'
                      }`}>
                        {mentor.avg >= 80 ? 'Excellent' : mentor.avg >= 60 ? 'Good' : 'Needs Improvement'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="text-center text-xs text-vriddhi-muted/40 pb-4">
        Analytics data refreshed {new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
        · Based on {computedData.totalScores} score records from {computedData.totalAssessments} assessments
      </div>
    </div>
  )
}