import { useState, useEffect, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  ChevronLeft, ChevronRight, Calendar as CalendarIcon, Clock,
  MapPin, Users, Plus, Trash2, X, AlertCircle, Sun, Loader2, Check
} from 'lucide-react'
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  limit
} from 'firebase/firestore'
import { db } from '@/Firebase/config'
import { useAuth } from '@/modules/auth/context/AuthContext'
import { fetchCalendarEvents } from '@/modules/admin/api/calendarApi'
import {
  expandAcademicCalendar,
  isAcademicOverlayId,
  overlayLabel,
  type AcademicCalendarSource,
} from '@/shared/utils/academicCalendarOverlay'

interface CalendarEvent {
  id: string
  title: string
  type: 'class' | 'exam' | 'meeting' | 'deadline' | 'holiday' | 'other'
  date: string
  startTime: string
  endTime: string
  room: string
  batch: string
  subject: string
  color: string
  /** College academic-calendar entries are read-only here (single source of
   *  truth is the Academic Calendar page; writes are callable-only). */
  readOnly?: boolean
}

const eventColors: Record<string, string> = {
  class: 'bg-teal-500/20 text-teal-400 border-teal-500/30',
  exam: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
  meeting: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  deadline: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  // College academic calendar (holidays, study holidays, fests).
  holiday: 'bg-violet-500/20 text-violet-400 border-violet-500/30',
  other: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
}

const eventDotColors: Record<string, string> = {
  class: 'bg-teal-400',
  exam: 'bg-rose-400',
  meeting: 'bg-blue-400',
  deadline: 'bg-amber-400',
  holiday: 'bg-violet-400',
  other: 'bg-slate-400',
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export default function FacultyCalendar() {
  const { user } = useAuth()
  const collegeId = user?.collegeId || localStorage.getItem('vriddhi_college_id') || ''

  const [currentDate, setCurrentDate] = useState(() => new Date())
  const [selectedDate, setSelectedDate] = useState<string | null>(() => {
    const today = new Date()
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  })
  const [viewMode, setViewMode] = useState<'month' | 'week'>('month')
  const [events, setEvents] = useState<CalendarEvent[]>([])
  // College academic calendar (academicCalendar/{id}) — read-only overlay so
  // the faculty calendar and the Academic Calendar page can never disagree.
  const [academicEvents, setAcademicEvents] = useState<AcademicCalendarSource[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Add Event Form State
  const [newEvent, setNewEvent] = useState({
    title: '',
    type: 'class' as CalendarEvent['type'],
    date: selectedDate || '',
    startTime: '09:00',
    endTime: '10:30',
    room: 'Room 101',
    batch: '2026',
    subject: 'General',
  })

  const fetchCalendarData = useCallback(async () => {
    if (!collegeId) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      // 1. Fetch college events
      const eventsQuery = query(
        collection(db, 'colleges', collegeId, 'events'),
        limit(100)
      )
      const eventsSnap = await getDocs(eventsQuery).catch(() => null)

      const loadedEvents: CalendarEvent[] = []
      if (eventsSnap) {
        eventsSnap.docs.forEach(docSnap => {
          const d = docSnap.data()
          loadedEvents.push({
            id: docSnap.id,
            title: d.title || 'Event',
            type: (d.type || d.category || 'other') as CalendarEvent['type'],
            date: d.date || '',
            startTime: d.startTime || d.time || '09:00',
            endTime: d.endTime || '10:00',
            room: d.venue || d.room || 'Campus',
            batch: d.batch || '-',
            subject: d.subject || 'General',
            color: eventColors[d.type] || eventColors.other,
          })
        })
      }

      // 2. Fetch weekly schedules for faculty
      const schedQuery = query(
        collection(db, 'weeklySchedules'),
        where('collegeId', '==', collegeId),
        limit(100)
      )
      const schedSnap = await getDocs(schedQuery).catch(() => null)
      if (schedSnap) {
        const today = new Date()
        const currentYear = today.getFullYear()
        const currentMonth = today.getMonth()

        // Synthesize schedule occurrences for the active month
        schedSnap.docs.forEach(docSnap => {
          const s = docSnap.data()
          const dayName = s.dayOfWeek || s.day
          const dayIndex = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].indexOf(dayName)
          if (dayIndex >= 0) {
            for (let d = 1; d <= 31; d++) {
              const testDate = new Date(currentYear, currentMonth, d)
              if (testDate.getMonth() === currentMonth && testDate.getDay() === dayIndex) {
                const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
                const teachingGroup = [s.division, s.section]
                  .filter(Boolean)
                  .map((value: unknown) => String(value).replace(/,/g, '+'))
                  .join(' / ')
                loadedEvents.push({
                  id: `sched_${docSnap.id}_${d}`,
                  title: `${s.subject || 'Class'} (${s.branch || ''})${teachingGroup ? ` · Div ${teachingGroup}` : ''}`,
                  type: 'class',
                  date: dateStr,
                  startTime: s.startTime || '10:00',
                  endTime: s.endTime || '11:00',
                  room: s.room || 'Room 101',
                  batch: s.batch || '2026',
                  subject: s.subject || 'General',
                  color: eventColors.class,
                })
              }
            }
          }
        })
      }

      // 3. College academic calendar — holidays / study holidays / fests /
      //    exam windows. Read-only here: faculty read, the office writes
      //    through the saveCalendarEvent callable on the Academic Calendar page.
      const academic = await fetchCalendarEvents(collegeId).catch((err) => {
        console.warn('[FacultyCalendar] academic calendar unavailable:', err)
        return []
      })
      setAcademicEvents(academic.map((event) => ({
        id: event.id,
        title: event.title,
        type: event.type,
        startDate: event.startDate,
        endDate: event.endDate,
        suspendsClasses: event.suspendsClasses,
        ...(event.notes ? { notes: event.notes } : {}),
      })))

      setEvents(loadedEvents)
    } catch (err) {
      console.error('[FacultyCalendar] fetch error:', err)
    } finally {
      setLoading(false)
    }
  }, [collegeId])

  useEffect(() => {
    fetchCalendarData()
  }, [fetchCalendarData])

  const handleAddEvent = async () => {
    if (!newEvent.title || !newEvent.date || !collegeId) return
    setSubmitting(true)
    try {
      const payload = {
        title: newEvent.title.trim(),
        type: newEvent.type,
        date: newEvent.date,
        startTime: newEvent.startTime,
        endTime: newEvent.endTime,
        venue: newEvent.room,
        batch: newEvent.batch,
        subject: newEvent.subject,
        collegeId,
        createdBy: user?.uid || '',
        createdByName: user?.name || 'Faculty',
        createdAt: serverTimestamp(),
      }

      const docRef = await addDoc(collection(db, 'colleges', collegeId, 'events'), payload)
      const createdItem: CalendarEvent = {
        id: docRef.id,
        title: payload.title,
        type: payload.type,
        date: payload.date,
        startTime: payload.startTime,
        endTime: payload.endTime,
        room: payload.venue,
        batch: payload.batch,
        subject: payload.subject,
        color: eventColors[payload.type] || eventColors.other,
      }

      setEvents(prev => [...prev, createdItem])
      setShowAddModal(false)
      setNewEvent({
        title: '',
        type: 'class',
        date: selectedDate || '',
        startTime: '09:00',
        endTime: '10:30',
        room: 'Room 101',
        batch: '2026',
        subject: 'General',
      })
    } catch (err) {
      console.error('[FacultyCalendar] add event error:', err)
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeleteEvent = async (eventId: string) => {
    // Academic-calendar entries belong to the college office — never deletable
    // from a faculty calendar (the UI hides the button; this is the backstop).
    if (isAcademicOverlayId(eventId)) return
    if (eventId.startsWith('sched_')) {
      // Schedule template item, remove locally
      setEvents(prev => prev.filter(e => e.id !== eventId))
      return
    }
    try {
      await deleteDoc(doc(db, 'colleges', collegeId, 'events', eventId))
      setEvents(prev => prev.filter(e => e.id !== eventId))
    } catch (err) {
      console.error('[FacultyCalendar] delete event error:', err)
      setEvents(prev => prev.filter(e => e.id !== eventId))
    }
  }

  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()

  const firstDayOfMonth = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const daysInPrevMonth = new Date(year, month, 0).getDate()

  const calendarDays = useMemo(() => {
    const days: { date: number; month: 'prev' | 'current' | 'next'; fullDate: string }[] = []
    // Previous month days
    for (let i = firstDayOfMonth - 1; i >= 0; i--) {
      const d = daysInPrevMonth - i
      const prevMonth = month === 0 ? 11 : month - 1
      const prevYear = month === 0 ? year - 1 : year
      days.push({ date: d, month: 'prev', fullDate: `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}` })
    }
    // Current month days
    for (let d = 1; d <= daysInMonth; d++) {
      days.push({ date: d, month: 'current', fullDate: `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}` })
    }
    // Next month days
    const remaining = 42 - days.length
    for (let d = 1; d <= remaining; d++) {
      const nextMonth = month === 11 ? 0 : month + 1
      const nextYear = month === 11 ? year + 1 : year
      days.push({ date: d, month: 'next', fullDate: `${nextYear}-${String(nextMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}` })
    }
    return days
  }, [year, month, firstDayOfMonth, daysInMonth, daysInPrevMonth])

  // Own events + timetable occurrences + the college academic calendar,
  // expanded day by day across the grid actually on screen (week view reads
  // the same list, and its days always sit inside the month grid window).
  const allEvents = useMemo(() => {
    if (calendarDays.length === 0 || academicEvents.length === 0) return events
    const windowStart = calendarDays[0].fullDate
    const windowEnd = calendarDays[calendarDays.length - 1].fullDate
    const overlay: CalendarEvent[] = expandAcademicCalendar(academicEvents, windowStart, windowEnd)
      .map((entry) => {
        const type: CalendarEvent['type'] =
          entry.kind === 'exam' ? 'exam' : entry.kind === 'fest' ? 'other' : 'holiday'
        return {
          id: entry.id,
          title: overlayLabel(entry),
          type,
          date: entry.date,
          startTime: 'All day',
          endTime: '',
          room: 'Academic calendar',
          batch: '-',
          subject: entry.suspendsClasses ? 'Classes suspended' : 'Classes as usual',
          color: eventColors[type] || eventColors.other,
          readOnly: true,
        }
      })
    return [...events, ...overlay]
  }, [events, academicEvents, calendarDays])

  const getEventsForDate = (dateStr: string) => allEvents.filter(e => e.date === dateStr)
  const selectedEvents = selectedDate ? getEventsForDate(selectedDate) : []

  const navigateMonth = (dir: number) => {
    setCurrentDate(new Date(year, month + dir, 1))
    setSelectedDate(null)
  }

  const goToToday = () => {
    const today = new Date()
    setCurrentDate(today)
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    setSelectedDate(todayStr)
  }

  const weekStart = new Date(currentDate)
  weekStart.setDate(currentDate.getDate() - currentDate.getDay())

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart)
    d.setDate(weekStart.getDate() + i)
    return {
      dayName: DAYS[d.getDay()],
      date: d.getDate(),
      fullDate: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
      isToday: d.toDateString() === new Date().toDateString(),
    }
  })

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto min-h-screen">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div className="flex items-center gap-4">
          <Link to="/faculty" className="p-2 rounded-xl bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/50 hover:border-teal-500/30 hover:bg-teal-500/5 transition-all shadow-sm">
            <ChevronLeft className="w-5 h-5 text-slate-600 dark:text-slate-300" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <CalendarIcon className="w-6 h-6 text-teal-400" />
              Calendar
            </h1>
            <p className="text-slate-600 dark:text-slate-400 text-sm">
              Your classes and events, with the college academic calendar (holidays, study holidays, fests, exam windows) overlaid.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-teal-500 text-white text-sm font-medium hover:bg-teal-600 transition-all shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Add Event
          </button>
          <button
            onClick={goToToday}
            className="px-3 py-2 rounded-xl bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/50 text-slate-700 dark:text-slate-300 text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-all shadow-sm"
          >
            Today
          </button>
          <div className="flex bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/50 rounded-xl overflow-hidden shadow-sm">
            <button
              onClick={() => setViewMode('month')}
              className={`px-3 py-2 text-sm font-medium transition-all ${viewMode === 'month' ? 'bg-teal-500/20 text-teal-600 dark:text-teal-400' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'}`}
            >
              Month
            </button>
            <button
              onClick={() => setViewMode('week')}
              className={`px-3 py-2 text-sm font-medium transition-all ${viewMode === 'week' ? 'bg-teal-500/20 text-teal-600 dark:text-teal-400' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'}`}
            >
              Week
            </button>
          </div>
        </div>
      </div>

      {/* Month Navigation */}
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={() => navigateMonth(-1)}
          className="p-2 rounded-xl bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/50 hover:border-teal-500/30 hover:bg-teal-500/5 transition-all shadow-sm"
        >
          <ChevronLeft className="w-5 h-5 text-slate-600 dark:text-slate-300" />
        </button>
        <h2 className="text-xl font-bold text-slate-900 dark:text-white">
          {MONTHS[month]} {year}
        </h2>
        <button
          onClick={() => navigateMonth(1)}
          className="p-2 rounded-xl bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/50 hover:border-teal-500/30 hover:bg-teal-500/5 transition-all shadow-sm"
        >
          <ChevronRight className="w-5 h-5 text-slate-600 dark:text-slate-300" />
        </button>
      </div>

      {loading ? (
        <div className="py-20 text-center">
          <Loader2 className="w-8 h-8 animate-spin text-teal-400 mx-auto mb-2" />
          <p className="text-sm text-slate-500">Loading calendar events...</p>
        </div>
      ) : viewMode === 'month' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Calendar Grid */}
          <div className="lg:col-span-2">
            <div className="bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/50 rounded-2xl p-4 shadow-sm">
              {/* Day Headers */}
              <div className="grid grid-cols-7 gap-1 mb-2">
                {DAYS.map(day => (
                  <div key={day} className="text-center text-xs font-medium text-slate-500 py-2">
                    {day}
                  </div>
                ))}
              </div>

              {/* Days */}
              <div className="grid grid-cols-7 gap-1">
                {calendarDays.map((day, i) => {
                  const dayEvents = getEventsForDate(day.fullDate)
                  const isSelected = selectedDate === day.fullDate
                  const isToday = day.fullDate === new Date().toISOString().split('T')[0]

                  return (
                    <button
                      key={i}
                      onClick={() => setSelectedDate(day.fullDate)}
                      className={`aspect-square rounded-xl p-1.5 flex flex-col items-center justify-start transition-all relative ${
                        day.month !== 'current'
                          ? 'text-slate-400 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/30'
                          : isSelected
                          ? 'bg-teal-500/20 border border-teal-500/30 text-teal-600 dark:text-teal-400'
                          : isToday
                          ? 'bg-teal-500/10 border border-teal-500/20 text-teal-600 dark:text-teal-400'
                          : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/30'
                      }`}
                    >
                      <span className={`text-sm font-medium ${isToday ? 'font-bold' : ''}`}>{day.date}</span>
                      {dayEvents.length > 0 && (
                        <div className="flex gap-0.5 mt-1">
                          {dayEvents.slice(0, 3).map((e, j) => (
                            <div key={j} className={`w-1.5 h-1.5 rounded-full ${eventDotColors[e.type] || 'bg-slate-400'}`} />
                          ))}
                          {dayEvents.length > 3 && <div className="w-1.5 h-1.5 rounded-full bg-slate-500" />}
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Legend */}
            <div className="flex flex-wrap gap-3 mt-4">
              {Object.entries(eventColors).map(([type, _]) => (
                <div key={type} className="flex items-center gap-1.5">
                  <div className={`w-2.5 h-2.5 rounded-full ${eventDotColors[type] || 'bg-slate-400'}`} />
                  <span className="text-xs text-slate-600 dark:text-slate-400 capitalize">{type}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Selected Day Events */}
          <div>
            <div className="bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/50 rounded-2xl p-5 shadow-sm">
              <h3 className="font-semibold text-slate-900 dark:text-white mb-1">
                {selectedDate
                  ? new Date(selectedDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
                  : 'Select a date'}
              </h3>
              <p className="text-xs text-slate-500 mb-4">
                {selectedDate
                  ? `${selectedEvents.length} event${selectedEvents.length !== 1 ? 's' : ''}`
                  : 'Click a date to view events'}
              </p>

              <div className="space-y-2">
                {selectedEvents.length === 0 ? (
                  <div className="text-center py-8">
                    <Sun className="w-10 h-10 text-slate-400 dark:text-slate-400 mx-auto mb-2" />
                    <p className="text-sm text-slate-500">No events scheduled</p>
                  </div>
                ) : (
                  selectedEvents.map(event => (
                    <div key={event.id} className={`p-3 rounded-xl border ${event.color} relative group`}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${eventDotColors[event.type] || 'bg-slate-400'}`} />
                          <span className="text-sm font-medium">{event.title}</span>
                        </div>
                        {event.readOnly ? (
                          <span
                            className="text-[10px] uppercase tracking-wide opacity-70"
                            title="Maintained by the college office on the Academic Calendar"
                          >
                            Academic calendar
                          </span>
                        ) : (
                          <button
                            onClick={() => handleDeleteEvent(event.id)}
                            className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-rose-400 transition-opacity"
                            title="Delete Event"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-3 text-xs opacity-80">
                        <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {event.endTime ? `${event.startTime} - ${event.endTime}` : event.startTime}</span>
                        <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {event.room}</span>
                        {event.batch && event.batch !== '-' && <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {event.batch}</span>}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Upcoming Events Summary */}
            <div className="bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/50 rounded-2xl p-5 mt-4 shadow-sm">
              <h3 className="font-semibold text-slate-900 dark:text-white mb-3 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-400" />
                Upcoming Events
              </h3>
              <div className="space-y-2">
                {allEvents
                  .filter(e => e.date >= (selectedDate || ''))
                  .sort((a, b) => a.date.localeCompare(b.date))
                  .slice(0, 4)
                  .map(event => (
                    <div key={event.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700/30 transition-colors">
                      <div className={`w-1 h-8 rounded-full ${eventDotColors[event.type] || 'bg-slate-400'}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-slate-900 dark:text-white truncate">{event.title}</p>
                        <p className="text-xs text-slate-500">{event.date} • {event.startTime}</p>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Week View */
        <div className="bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/50 rounded-2xl p-4 overflow-x-auto shadow-sm">
          <div className="min-w-[800px]">
            {/* Week Header */}
            <div className="grid grid-cols-7 gap-2 mb-4">
              {weekDays.map((day, i) => (
                <div key={i} className={`text-center p-3 rounded-xl ${day.isToday ? 'bg-teal-500/10 border border-teal-500/20' : ''}`}>
                  <p className="text-xs text-slate-500">{day.dayName}</p>
                  <p className={`text-lg font-bold ${day.isToday ? 'text-teal-600 dark:text-teal-400' : 'text-slate-900 dark:text-white'}`}>{day.date}</p>
                </div>
              ))}
            </div>

            {/* Time slots */}
            <div className="grid grid-cols-7 gap-2">
              {weekDays.map((day, i) => {
                const dayEvents = getEventsForDate(day.fullDate)
                return (
                  <div key={i} className="min-h-[300px] bg-slate-50 dark:bg-slate-700/20 rounded-xl p-2 space-y-2">
                    {dayEvents.length === 0 ? (
                      <div className="h-full flex items-center justify-center">
                        <p className="text-xs text-slate-400 dark:text-slate-400">No events</p>
                      </div>
                    ) : (
                      dayEvents.map(event => (
                        <div key={event.id} className={`p-2.5 rounded-lg border ${event.color} text-xs`}>
                          <p className="font-medium mb-1">{event.title}</p>
                          <p className="opacity-80">{event.endTime ? `${event.startTime} - ${event.endTime}` : event.startTime}</p>
                          <p className="opacity-60 flex items-center gap-1 mt-1"><MapPin className="w-3 h-3" /> {event.room}</p>
                        </div>
                      ))
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Add Event Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl w-full max-w-md p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <CalendarIcon className="w-5 h-5 text-teal-400" />
                Add Calendar Event
              </h3>
              <button onClick={() => setShowAddModal(false)} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700">
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Title</label>
                <input
                  type="text"
                  placeholder="e.g., Guest Lecture on Macroeconomics"
                  value={newEvent.title}
                  onChange={e => setNewEvent(prev => ({ ...prev, title: e.target.value }))}
                  className="w-full bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Type</label>
                  <select
                    value={newEvent.type}
                    onChange={e => setNewEvent(prev => ({ ...prev, type: e.target.value as CalendarEvent['type'] }))}
                    className="w-full bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white"
                  >
                    <option value="class">Class</option>
                    <option value="exam">Exam</option>
                    <option value="meeting">Meeting</option>
                    <option value="deadline">Deadline</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Date</label>
                  <input
                    type="date"
                    value={newEvent.date}
                    onChange={e => setNewEvent(prev => ({ ...prev, date: e.target.value }))}
                    className="w-full bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Start Time</label>
                  <input
                    type="time"
                    value={newEvent.startTime}
                    onChange={e => setNewEvent(prev => ({ ...prev, startTime: e.target.value }))}
                    className="w-full bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">End Time</label>
                  <input
                    type="time"
                    value={newEvent.endTime}
                    onChange={e => setNewEvent(prev => ({ ...prev, endTime: e.target.value }))}
                    className="w-full bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Room / Venue</label>
                  <input
                    type="text"
                    placeholder="e.g. Lab 204"
                    value={newEvent.room}
                    onChange={e => setNewEvent(prev => ({ ...prev, room: e.target.value }))}
                    className="w-full bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Batch / Cohort</label>
                  <input
                    type="text"
                    placeholder="e.g. 2026"
                    value={newEvent.batch}
                    onChange={e => setNewEvent(prev => ({ ...prev, batch: e.target.value }))}
                    className="w-full bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white"
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowAddModal(false)}
                disabled={submitting}
                className="flex-1 px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-medium hover:bg-slate-200 dark:hover:bg-slate-600 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleAddEvent}
                disabled={submitting || !newEvent.title || !newEvent.date}
                className="flex-1 px-4 py-2 rounded-xl bg-teal-500 text-white font-medium hover:bg-teal-600 text-sm flex items-center justify-center gap-2 disabled:opacity-40"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {submitting ? 'Saving...' : 'Save Event'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
