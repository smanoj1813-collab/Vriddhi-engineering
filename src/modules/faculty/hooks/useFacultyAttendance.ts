import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/context/AuthContext';
import {
  fetchFacultyClassSessions,
  fetchStudentsForSession,
  fetchAttendanceForSession,
  saveAttendance,
} from '../api/facultyApi';
import { ensureIdentityClaims, type SelfHealOutcome } from '@/shared/services/identitySelfHeal';
import { isPermissionDeniedError, staleClaimMessage, staleDeployMessage } from '@/shared/utils/identityClaims';
import type {
  FacultyClassSession,
  FacultyStudent,
  FacultyAttendanceRecord,
  FacultyAttendanceDoc,
  AttendanceStatus,
} from '../types/attendance';
import type { RosterDiagnostics } from '@/shared/utils/cohortMatching';

interface AttendanceState {
  [studentId: string]: {
    status: AttendanceStatus;
    notes: string;
  };
}

function todayLocalISO(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

interface AttendanceStats {
  total: number;
  present: number;
  absent: number;
  late: number;
  leave: number;
  onDuty: number;
  medicalLeave: number;
}

export function useFacultyAttendance() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const preselectedSessionId = searchParams.get('sessionId');

  const collegeId = (user as any)?.collegeId as string | undefined;
  const facultyId = user?.id;
  const facultyName = user?.name || 'Faculty';

  const [selectedDate, setSelectedDate] = useState(todayLocalISO);
  const [classSessions, setClassSessions] = useState<FacultyClassSession[]>([]);
  const [selectedClass, setSelectedClass] = useState<FacultyClassSession | null>(null);
  const [students, setStudents] = useState<FacultyStudent[]>([]);
  const [rosterDiagnostics, setRosterDiagnostics] = useState<RosterDiagnostics | null>(null);
  const [attendance, setAttendance] = useState<AttendanceState>({});
  const [existingAttendance, setExistingAttendance] = useState<FacultyAttendanceDoc | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // One on-demand identity self-heal per mount (mirrors useMyStaffAttendance):
  // a permission denial on the save is exactly what a stale role/collegeId
  // claim produces, and re-issuing the claims mid-session can rescue the save
  // without a sign-out. The OUTCOME is kept so the error can say which real
  // fix is needed: 'unavailable' → the deployed functions are too old (deploy
  // functions); 'unchanged' → no document states this account's college
  // (superadmin Identity Repair / data fix); 'refreshed' → claims were
  // re-issued and the retry simply still failed (genuine rules/data issue).
  const healAttempts = useRef(0);
  const healOutcomeRef = useRef<SelfHealOutcome | null>(null);
  const selfHealOnce = useCallback(async (): Promise<SelfHealOutcome> => {
    if (!user || healAttempts.current > 0) return 'unavailable';
    healAttempts.current += 1;
    try {
      const outcome = await ensureIdentityClaims({
        role: user.role,
        collegeId: user.collegeId ?? null,
      });
      healOutcomeRef.current = outcome;
      if (outcome !== 'refreshed') {
        console.warn('[useFacultyAttendance] claim self-heal did not re-issue claims:', outcome);
      }
      return outcome;
    } catch (err) {
      console.warn('[useFacultyAttendance] claim self-heal failed:', err);
      healOutcomeRef.current = 'unavailable';
      return 'unavailable';
    }
  }, [user]);

  // ─── Load class sessions ────────────────────────────────
  useEffect(() => {
    if (!facultyId) return;
    const fid = facultyId;
    async function load() {
      setLoading(true);
      try {
        const sessions = await fetchFacultyClassSessions(fid, selectedDate);
        setClassSessions(sessions);

        const preselected = preselectedSessionId
          ? sessions.find((session) => session.id === preselectedSessionId)
          : undefined;
        setSelectedClass(preselected || sessions[0] || null);
        if (sessions.length === 0) {
          setStudents([]);
          setRosterDiagnostics(null);
          setAttendance({});
          setExistingAttendance(null);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load sessions');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [facultyId, preselectedSessionId, selectedDate]);

  // ─── Load students when class selected ──────────────────
  useEffect(() => {
    if (!selectedClass || !collegeId) return;

    const cls = selectedClass;
    const cid = collegeId;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const { students: studentsData, diagnostics } = await fetchStudentsForSession(
          {
            branch: cls.branch,
            batch: cls.batch,
            division: cls.division,
            // Section is part of the cohort — dropping it is how a class for
            // "A B" used to find nobody recorded under either letter.
            section: cls.section,
            semester: cls.semester,
            subject: cls.subject,
            subjectCode: cls.subjectCode,
          },
          cid
        );
        setStudents(studentsData);
        setRosterDiagnostics(diagnostics);

        const existing = await fetchAttendanceForSession(cls.id, cls.date);
        setExistingAttendance(existing);

        if (existing) {
          const existingState: AttendanceState = {};
          existing.records.forEach((r: FacultyAttendanceRecord) => {
            existingState[r.studentId] = {
              status: r.status,
              notes: r.notes || '',
            };
          });
          setAttendance(existingState);
        } else {
          const defaultState: AttendanceState = {};
          studentsData.forEach((s: FacultyStudent) => {
            defaultState[s.id] = { status: 'Present', notes: '' };
          });
          setAttendance(defaultState);
        }
      } catch (err) {
        console.error('[useFacultyAttendance] student roster load failed', err);
        setStudents([]);
        setRosterDiagnostics(null);
        setError(err instanceof Error ? err.message : 'Failed to load students');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [selectedClass, collegeId]);

  // ─── Stats computation ──────────────────────────────────
  const stats: AttendanceStats = {
    total: students.length,
    present: Object.values(attendance).filter((a) => a.status === 'Present').length,
    absent: Object.values(attendance).filter((a) => a.status === 'Absent').length,
    late: Object.values(attendance).filter((a) => a.status === 'Late').length,
    leave: Object.values(attendance).filter((a) => a.status === 'Leave').length,
    onDuty: Object.values(attendance).filter((a) => a.status === 'OnDuty').length,
    medicalLeave: Object.values(attendance).filter((a) => a.status === 'MedicalLeave').length,
  };

  // ─── Actions ────────────────────────────────────────────
  const updateStudentStatus = useCallback(
    (studentId: string, status: AttendanceStatus) => {
      setAttendance((prev) => ({
        ...prev,
        [studentId]: { ...prev[studentId], status },
      }));
    },
    []
  );

  const updateStudentNotes = useCallback(
    (studentId: string, notes: string) => {
      setAttendance((prev) => ({
        ...prev,
        [studentId]: { ...prev[studentId], notes },
      }));
    },
    []
  );

  const setAllStatus = useCallback(
    (status: AttendanceStatus) => {
      setAttendance((prev) => {
        const next: AttendanceState = {};
        students.forEach((s) => {
          next[s.id] = { status, notes: prev[s.id]?.notes || '' };
        });
        return next;
      });
    },
    [students]
  );

  const resetAttendance = useCallback(() => {
    const defaultState: AttendanceState = {};
    students.forEach((s) => {
      defaultState[s.id] = { status: 'Present', notes: '' };
    });
    setAttendance(defaultState);
  }, [students]);

  const handleSave = useCallback(async () => {
    if (!selectedClass || !facultyId || !collegeId) {
      setError('Your faculty account is missing a college assignment.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const records: FacultyAttendanceRecord[] = students.map((s) => ({
        studentId: s.id,
        name: s.name,
        usn: s.usn,
        regNo: s.regNo,
        status: attendance[s.id]?.status || 'Present',
        notes: attendance[s.id]?.notes || '',
      }));

      const attendanceId = await (async () => {
        try {
          return await saveAttendance(
            selectedClass,
            records,
            facultyId,
            facultyName,
            collegeId
          );
        } catch (err) {
          // A tenant-scoped write is exactly where a stale collegeId claim
          // hurts: re-issue the claims once and retry — the batched write is
          // an upsert keyed on session+date, so a retry cannot duplicate.
          if (isPermissionDeniedError(err)) {
            const outcome = await selfHealOnce();
            if (outcome === 'refreshed') {
              return saveAttendance(
                selectedClass,
                records,
                facultyId,
                facultyName,
                collegeId
              );
            }
          }
          throw err;
        }
      })();
      setSaveSuccess(true);
      setExistingAttendance({
        id: attendanceId,
        sessionId: selectedClass.id,
        facultyId,
        subject: selectedClass.subject,
        subjectCode: selectedClass.subjectCode,
        branch: selectedClass.branch,
        batch: selectedClass.batch,
        semester: selectedClass.semester,
        division: selectedClass.division,
        section: selectedClass.section,
        room: selectedClass.room,
        timeSlot: selectedClass.timeSlot,
        date: selectedClass.date,
        records,
        presentCount: records.filter((r) => r.status === 'Present').length,
        absentCount: records.filter((r) => r.status === 'Absent').length,
        lateCount: records.filter((r) => r.status === 'Late').length,
        leaveCount: records.filter((r) => r.status === 'Leave').length,
        onDutyCount: records.filter((r) => r.status === 'OnDuty').length,
        medicalLeaveCount: records.filter((r) => r.status === 'MedicalLeave').length,
        totalStudents: records.length,
        markedAt: new Date().toISOString(),
        markedBy: facultyName,
      });

      // The save materialises the session server-side (saveAttendance calls
      // ensureClassSession for virtual rows), so the in-memory class must flip
      // too — otherwise "Mark class complete" keeps seeing the pre-save
      // virtual row and tells the user to save first, forever, until a reload.
      // The id is deterministic (slotDateKey), so it survives unchanged.
      setClassSessions((prev) =>
        prev.map((s) =>
          s.id === selectedClass.id ? { ...s, materialised: true, attendanceMarked: true } : s
        )
      );
      setSelectedClass((prev) =>
        prev && prev.id === selectedClass.id
          ? {
              ...prev,
              materialised: true,
              attendanceMarked: true,
              status: prev.status === 'ongoing' ? ('completed' as const) : prev.status,
            }
          : prev
      );

      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      if (isPermissionDeniedError(err)) {
        // Say WHICH fix is needed instead of one generic message:
        //   'current'     — the token already carries the account's role and
        //                    college, so the deployed rules/functions predate
        //                    this code (redeploy, sign-out cannot help);
        //   'unavailable' — the deployed functions predate syncMyIdentity
        //                    (deploy functions);
        //   'unchanged'   — the identity service could not change the claims
        //                    (superadmin Identity Repair / re-grant).
        const outcome = healOutcomeRef.current;
        setError(
          outcome === 'current'
            ? staleDeployMessage('attendance save')
            : outcome === 'unavailable'
              ? 'Security rules refused this save, and the automatic identity refresh could not reach the identity service. The deployed backend is likely out of date — an admin must run "npm run deploy:functions", then you sign out and back in.'
              : outcome === 'unchanged'
                ? 'Security rules refused this save, and the identity service could not change your token claims. Ask a superadmin to re-grant your role and college (Access Control) or run Identity Repair, then sign out and back in.'
                : staleClaimMessage('attendance save')
        );
      } else {
        setError(err instanceof Error ? err.message : 'Failed to save attendance');
      }
    } finally {
      setSaving(false);
    }
  }, [selectedClass, facultyId, facultyName, collegeId, students, attendance, selfHealOnce]);

  return {
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
    /**
     * One on-demand claim refresh, shared with the "mark topics covered"
     * action on the page: completeClassSession reads the caller's role and
     * college from the same token, so a stale claim denies it exactly the way
     * it denies the attendance write, and the same one-shot heal + single
     * retry is the right response. Exposed rather than duplicated so the guard
     * (one attempt per mount) stays single-sourced.
     */
    selfHealOnce,
  };
}