import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore'
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'

const PROJECT_ID = 'demo-vriddhi-student-portal'
const COLLEGE_A = 'college-a'
const COLLEGE_B = 'college-b'
const STUDENT_UID = 'student-auth-a'
const OTHER_UID = 'student-auth-b'
const STUDENT_ID = 'student-domain-a'
const OTHER_STUDENT_ID = 'student-domain-b'

function emulatorAddress(envName: string, fallbackPort: number): { host: string; port: number } {
  const value = process.env[envName]
  if (!value) {
    throw new Error(
      `${envName} is missing. Run this suite through Firebase emulators:exec (npm test).`
    )
  }
  const [host, rawPort] = value.split(':')
  return { host, port: Number(rawPort || fallbackPort) }
}

let testEnv: RulesTestEnvironment

before(async () => {
  const firestore = emulatorAddress('FIRESTORE_EMULATOR_HOST', 8080)
  const storage = emulatorAddress('FIREBASE_STORAGE_EMULATOR_HOST', 9199)
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      ...firestore,
      rules: readFileSync(resolve(process.cwd(), '../firestore.rules'), 'utf8'),
    },
    storage: {
      ...storage,
      rules: readFileSync(resolve(process.cwd(), '../storage.rules'), 'utf8'),
    },
  })
})

after(async () => {
  await testEnv.cleanup()
})

beforeEach(async () => {
  await Promise.all([
    testEnv.clearFirestore(),
    testEnv.clearStorage(),
  ])
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore()
    await Promise.all([
      setDoc(doc(db, 'users', STUDENT_UID), {
        uid: STUDENT_UID,
        role: 'student',
        collegeId: COLLEGE_A,
        email: 'student-a@example.edu',
      }),
      setDoc(doc(db, 'users', OTHER_UID), {
        uid: OTHER_UID,
        role: 'student',
        collegeId: COLLEGE_A,
        email: 'student-b@example.edu',
      }),
      setDoc(doc(db, 'users', 'faculty-a'), {
        uid: 'faculty-a',
        role: 'faculty',
        collegeId: COLLEGE_A,
      }),
      // Legacy faculty: no users/{uid} document and, in the real app, no custom
      // claims. Identity must resolve from the role profile collection alone.
      setDoc(doc(db, 'faculty', 'legacy-faculty-a'), {
        uid: 'legacy-faculty-a',
        role: 'faculty',
        collegeId: COLLEGE_A,
        email: 'legacy-faculty@example.edu',
        firstName: 'Legacy',
        lastName: 'Faculty',
      }),
      setDoc(doc(db, 'students', STUDENT_ID), {
        userId: STUDENT_UID,
        name: 'Student A',
        collegeId: COLLEGE_A,
        regNo: 'A001',
      }),
      setDoc(doc(db, 'students', OTHER_STUDENT_ID), {
        userId: OTHER_UID,
        name: 'Student B',
        collegeId: COLLEGE_A,
        regNo: 'A002',
      }),
      setDoc(doc(db, 'students', 'student-domain-c'), {
        userId: 'student-auth-c',
        name: 'Student C',
        collegeId: COLLEGE_B,
        regNo: 'B001',
      }),
      setDoc(doc(db, 'colleges', COLLEGE_A, 'students', 'A001'), {
        userId: STUDENT_UID,
        studentDocId: STUDENT_ID,
        name: 'Student A',
        collegeId: COLLEGE_A,
      }),
      setDoc(doc(db, 'colleges', COLLEGE_A, 'students', 'A002'), {
        userId: OTHER_UID,
        studentDocId: OTHER_STUDENT_ID,
        name: 'Student B',
        collegeId: COLLEGE_A,
      }),
      setDoc(doc(db, 'attendanceRecords', 'attendance-own'), {
        studentId: STUDENT_ID,
        collegeId: COLLEGE_A,
        date: '2026-08-29',
        status: 'present',
      }),
      setDoc(doc(db, 'attendanceRecords', 'attendance-other'), {
        studentId: OTHER_STUDENT_ID,
        collegeId: COLLEGE_A,
        date: '2026-08-29',
        status: 'present',
      }),
      setDoc(doc(db, 'weeklySchedules', 'schedule-a'), {
        collegeId: COLLEGE_A,
        branch: 'B.Com',
        batch: '2026',
        semester: 1,
        division: 'A',
        dayOfWeek: 'monday',
        startTime: '09:00',
        endTime: '10:00',
      }),
      setDoc(doc(db, 'weeklySchedules', 'schedule-b'), {
        collegeId: COLLEGE_B,
        branch: 'B.Com',
        batch: '2026',
        semester: 1,
        division: 'A',
        dayOfWeek: 'monday',
        startTime: '09:00',
        endTime: '10:00',
      }),
      setDoc(doc(db, 'weeklySchedules', 'schedule-legacy-a'), {
        collegeId: COLLEGE_A,
        facultyId: 'legacy-faculty-a',
        facultyName: 'Legacy Faculty',
        // A different stream from the student timetable fixture (B.Com) so the
        // student-scoped list query does not pick this legacy row up. All values
        // here are non-technical UG/PG programs, matching academicPrograms.ts.
        branch: 'B.Sc',
        batch: '2026',
        semester: 1,
        division: 'A',
        dayOfWeek: 'monday',
        startTime: '09:00',
        endTime: '10:00',
      }),
      setDoc(doc(db, 'classSessions', 'session-legacy-a'), {
        collegeId: COLLEGE_A,
        facultyId: 'legacy-faculty-a',
        facultyName: 'Legacy Faculty',
        date: '2026-09-02',
        timeSlot: '09:00-10:00',
      }),
      setDoc(doc(db, 'questions', 'question-a'), {
        collegeId: COLLEGE_A,
        status: 'published',
        text: 'Two plus two?',
        correctAnswer: '4',
      }),
      setDoc(doc(db, 'papers', 'paper-a'), {
        collegeId: COLLEGE_A,
        createdBy: 'faculty-a',
        status: 'published',
        verificationStatus: 'approved-by-hod',
        title: 'Internal assessment',
        questions: [{ text: 'Two plus two?', correctAnswer: '4' }],
      }),
      // Faculty topic planner (src/hooks/useTopics.ts). Tenancy is the owning
      // uid: these rows carry no collegeId.
      setDoc(doc(db, 'facultyTopics', 'topic-own'), {
        facultyId: 'faculty-a',
        title: 'Linear equations',
        subject: 'Mathematics',
        status: 'planned',
        createdAt: '2026-09-01T09:00:00.000Z',
      }),
      setDoc(doc(db, 'facultyTopics', 'topic-other'), {
        facultyId: 'faculty-b',
        title: 'Another faculty topic',
        subject: 'Physics',
        status: 'planned',
        createdAt: '2026-09-02T09:00:00.000Z',
      }),
      setDoc(doc(db, 'scheduledTests', 'test-a'), {
        collegeId: COLLEGE_A,
        paperId: 'paper-a',
        status: 'published',
        title: 'Internal assessment',
      }),
      setDoc(doc(db, 'scheduledTests', 'test-a', 'assessmentQuestions', 'q-0001'), {
        id: 'q-0001',
        text: 'Two plus two?',
        options: [{ id: '4', text: '4', isCorrect: true }],
        correctAnswer: '4',
      }),
      setDoc(doc(db, 'studentAssessments', 'test-a_student-domain-a'), {
        collegeId: COLLEGE_A,
        testId: 'test-a',
        studentId: STUDENT_ID,
        studentUid: STUDENT_UID,
        status: 'graded',
        marksObtained: 10,
        gradingBreakdown: [{ questionId: 'q-0001', status: 'correct' }],
      }),
      setDoc(doc(db, 'studentAssessments', 'test-a_student-domain-b'), {
        collegeId: COLLEGE_A,
        testId: 'test-a',
        studentId: OTHER_STUDENT_ID,
        studentUid: OTHER_UID,
        status: 'graded',
        marksObtained: 6,
      }),
      setDoc(doc(db, 'assignments', 'assignment-a'), {
        collegeId: COLLEGE_A,
        facultyUid: 'faculty-a',
        status: 'published',
        targetType: 'specific',
        studentIds: [STUDENT_ID],
      }),
      setDoc(doc(db, 'assignments', 'assignment-legacy-a'), {
        collegeId: COLLEGE_A,
        facultyUid: 'legacy-faculty-a',
        facultyName: 'Legacy Faculty',
        status: 'published',
        targetType: 'cohort',
        title: 'Legacy Faculty Assignment',
        createdAt: Timestamp.fromMillis(Date.now()),
      }),
      setDoc(doc(db, 'assignmentSubmissionDrafts', 'session-own'), {
        assignmentId: 'assignment-a',
        studentId: STUDENT_ID,
        studentUid: STUDENT_UID,
        collegeId: COLLEGE_A,
        status: 'uploading',
        expiresAt: Timestamp.fromMillis(Date.now() + 60 * 60 * 1000),
      }),
      setDoc(doc(db, 'assignmentSubmissionDrafts', 'session-other'), {
        assignmentId: 'assignment-a',
        studentId: OTHER_STUDENT_ID,
        studentUid: OTHER_UID,
        collegeId: COLLEGE_A,
        status: 'uploading',
        expiresAt: Timestamp.fromMillis(Date.now() + 60 * 60 * 1000),
      }),
      setDoc(doc(db, 'submissions', 'assignment-a_student-domain-a'), {
        assignmentId: 'assignment-a',
        collegeId: COLLEGE_A,
        studentId: STUDENT_ID,
        studentUid: STUDENT_UID,
        status: 'submitted',
        files: [],
      }),
      setDoc(doc(db, 'gradeRecords', 'grade-own'), {
        collegeId: COLLEGE_A,
        studentId: STUDENT_ID,
        status: 'published',
        semester: 1,
        subject: 'Mathematics',
        grade: 'A',
      }),
      setDoc(doc(db, 'gradeRecords', 'grade-other'), {
        collegeId: COLLEGE_A,
        studentId: OTHER_STUDENT_ID,
        status: 'published',
        semester: 1,
        subject: 'Mathematics',
        grade: 'A',
      }),
      setDoc(doc(db, 'gradeRecords', 'grade-own-draft'), {
        collegeId: COLLEGE_A,
        studentId: STUDENT_ID,
        status: 'draft',
        semester: 2,
        subject: 'Physics',
        grade: 'B',
      }),
      setDoc(doc(db, 'notifications', 'notif-own'), {
        collegeId: COLLEGE_A,
        userId: STUDENT_UID,
        studentId: STUDENT_ID,
        title: 'Addressed to Student A',
      }),
      setDoc(doc(db, 'notifications', 'notif-other'), {
        collegeId: COLLEGE_A,
        userId: OTHER_UID,
        studentId: OTHER_STUDENT_ID,
        title: 'Addressed to Student B',
      }),
      setDoc(doc(db, 'notifications', 'notif-broadcast'), {
        collegeId: COLLEGE_A,
        title: 'College-wide announcement',
        message: 'Visible to every student under the old sameCollege rule',
      }),
      // Staff (faculty) attendance. Document ids follow the storage contract in
      // src/shared/api/staffAttendanceApi.ts: {collegeId}__{facultyUid}__{date}.
      setDoc(doc(db, 'staffAttendance', `${COLLEGE_A}__faculty-a__2026-09-01`), {
        collegeId: COLLEGE_A,
        facultyId: 'faculty-a',
        facultyName: 'Faculty A',
        date: '2026-09-01',
        month: '2026-09',
        status: 'present',
        source: 'self',
        markedBy: 'faculty-a',
      }),
      setDoc(doc(db, 'staffAttendance', `${COLLEGE_A}__faculty-b__2026-09-01`), {
        collegeId: COLLEGE_A,
        facultyId: 'faculty-b',
        facultyName: 'Faculty B',
        date: '2026-09-01',
        month: '2026-09',
        status: 'present',
        source: 'self',
        markedBy: 'faculty-b',
      }),
      setDoc(doc(db, 'staffAttendance', `${COLLEGE_B}__faculty-c__2026-09-01`), {
        collegeId: COLLEGE_B,
        facultyId: 'faculty-c',
        facultyName: 'Faculty C',
        date: '2026-09-01',
        month: '2026-09',
        status: 'present',
        source: 'self',
        markedBy: 'faculty-c',
      }),
    ])
  })
})

function studentContext() {
  return testEnv.authenticatedContext(STUDENT_UID, {
    role: 'student',
    collegeId: COLLEGE_A,
    email: 'student-a@example.edu',
  })
}

function facultyContext() {
  return testEnv.authenticatedContext('faculty-a', {
    role: 'faculty',
    collegeId: COLLEGE_A,
  })
}

function adminContext() {
  return testEnv.authenticatedContext('admin-a', {
    role: 'admin',
    collegeId: COLLEGE_A,
  })
}

function principalContext() {
  return testEnv.authenticatedContext('principal-a', {
    role: 'principal',
    collegeId: COLLEGE_A,
  })
}

function hodContext(collegeId = COLLEGE_A) {
  return testEnv.authenticatedContext(`hod-${collegeId}`, {
    role: 'hod',
    collegeId,
  })
}

function superadminContext() {
  return testEnv.authenticatedContext('platform-root', { role: 'superadmin' })
}

// Faculty of the OTHER college, whose uid also owns one row in college A —
// exercises the owner branch of the curriculum mapping rules.
function facultyBContext() {
  return testEnv.authenticatedContext('faculty-b', {
    role: 'faculty',
    collegeId: COLLEGE_B,
  })
}

describe('scheme packs (global reference reads and tenant-scoped customs)', () => {
  async function seedPacks() {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore()
      await Promise.all([
        setDoc(doc(db, 'schemePacks', 'VTU_BE_2022_5050'), {
          code: 'VTU_BE_2022_5050', name: 'VTU BE 2022', global: true, scope: 'platform',
        }),
        setDoc(doc(db, 'schemePacks', 'custom-a'), {
          code: 'CUSTOM_A', name: 'College A custom', collegeId: COLLEGE_A,
        }),
        setDoc(doc(db, 'schemePacks', 'custom-b'), {
          code: 'CUSTOM_B', name: 'College B custom', collegeId: COLLEGE_B,
        }),
      ])
    })
  }

  it('lets signed-in users read global presets, but never write scheme packs', async () => {
    await seedPacks()
    const student = studentContext().firestore()
    const globalRef = doc(student, 'schemePacks', 'VTU_BE_2022_5050')
    await assertSucceeds(getDoc(globalRef))
    const globalRows = await assertSucceeds(getDocs(query(
      collection(student, 'schemePacks'),
      where('global', '==', true),
    )))
    assert.equal(globalRows.size, 1)
    await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), 'schemePacks', 'VTU_BE_2022_5050')))
    await assertFails(setDoc(globalRef, { code: 'FORGED', global: true }))
    await assertFails(updateDoc(globalRef, { name: 'Forged preset' }))
    await assertFails(deleteDoc(globalRef))
    await assertFails(setDoc(doc(superadminContext().firestore(), 'schemePacks', 'forged-global'), {
      code: 'FORGED', global: true,
    }))
  })

  it('keeps college customs tenant-scoped and requires filters on list queries', async () => {
    await seedPacks()
    const staff = adminContext().firestore()
    await assertSucceeds(getDoc(doc(staff, 'schemePacks', 'custom-a')))
    await assertFails(getDoc(doc(staff, 'schemePacks', 'custom-b')))
    await assertFails(getDocs(collection(staff, 'schemePacks')))
    const ownCustoms = await assertSucceeds(getDocs(query(
      collection(staff, 'schemePacks'),
      where('collegeId', '==', COLLEGE_A),
    )))
    assert.equal(ownCustoms.size, 1)
    const student = studentContext().firestore()
    await assertSucceeds(getDoc(doc(student, 'schemePacks', 'custom-a')))
    await assertFails(getDoc(doc(student, 'schemePacks', 'custom-b')))
    await assertFails(getDocs(collection(student, 'schemePacks')))
    const studentCollegePacks = await assertSucceeds(getDocs(query(
      collection(student, 'schemePacks'),
      where('collegeId', '==', COLLEGE_A),
    )))
    assert.equal(studentCollegePacks.size, 1)
  })
})

describe('student identity and profile isolation', () => {
  it('resolves the provisioned profile by canonical userId', async () => {
    const db = studentContext().firestore()
    const result = await assertSucceeds(
      getDocs(
        query(
          collection(db, 'students'),
          where('userId', '==', STUDENT_UID),
          limit(1)
        )
      )
    )
    assert.equal(result.size, 1)
    assert.equal(result.docs[0].id, STUDENT_ID)
  })

  it('allows the own profile and denies another student profile', async () => {
    const db = studentContext().firestore()
    await assertSucceeds(getDoc(doc(db, 'students', STUDENT_ID)))
    await assertFails(getDoc(doc(db, 'students', OTHER_STUDENT_ID)))
    await assertFails(getDoc(doc(db, 'colleges', COLLEGE_A, 'students', 'A002')))
  })

  it('requires server code for profile mutations', async () => {
    const db = studentContext().firestore()
    await assertFails(updateDoc(doc(db, 'students', STUDENT_ID), { name: 'Changed in browser' }))
  })
})

describe('login provisioning paths these rules gate', () => {
  // Each case here is a bug that was only visible as "the login is broken".
  // They are rules-level because the app cannot fix them from the client.
  function collegeAdminContext() {
    return testEnv.authenticatedContext('admin-a', { role: 'admin', collegeId: COLLEGE_A })
  }

  it('allows a student-scoped list but never an unbounded one', async () => {
    const db = studentContext().firestore()
    const mine = await assertSucceeds(
      getDocs(query(collection(db, 'students'), where('userId', '==', STUDENT_UID)))
    )
    assert.equal(mine.size, 1)
    // A student must not be able to sweep the collection to discover ids.
    await assertFails(getDocs(query(collection(db, 'students'), limit(10))))
  })

  it('lets an account with no role claim find its own faculty profile', async () => {
    // Sign-in identity resolution runs a `where('uid','==',auth.uid)` query. If
    // `faculty` list were staff-only, an imported account whose claim has not
    // been issued yet could not even discover who it is — the exact state a
    // half-finished import leaves behind.
    const db = testEnv.authenticatedContext('legacy-faculty-a', {
      email: 'legacy-faculty@example.edu',
    }).firestore()
    const byUid = await assertSucceeds(
      getDocs(query(collection(db, 'faculty'), where('uid', '==', 'legacy-faculty-a')))
    )
    assert.equal(byUid.size, 1)
    const byEmail = await assertSucceeds(
      getDocs(query(collection(db, 'faculty'), where('email', '==', 'legacy-faculty@example.edu')))
    )
    assert.equal(byEmail.size, 1)
    // Still no ability to list the rest of the college.
    await assertFails(getDocs(query(collection(db, 'faculty'), limit(10))))
  })

  it('refuses to store a credential on a student profile', async () => {
    const db = collegeAdminContext().firestore()
    await assertFails(
      setDoc(doc(db, 'students', 'student-with-password'), {
        userId: 'student-auth-d',
        name: 'Credential Carrier',
        collegeId: COLLEGE_A,
        regNo: 'A004',
        password: 'Temp!1234567',
      })
    )
    // The same row without credential material is the supported shape: the
    // password belongs to Firebase Authentication, not to a readable document.
    await assertSucceeds(
      setDoc(doc(db, 'students', 'student-with-password'), {
        userId: 'student-auth-d',
        name: 'Credential Carrier',
        collegeId: COLLEGE_A,
        regNo: 'A004',
      })
    )
  })

  it('refuses a role field smuggled onto a student profile', async () => {
    const db = collegeAdminContext().firestore()
    await assertFails(
      setDoc(doc(db, 'students', 'student-forged-role'), {
        userId: 'student-auth-e',
        name: 'Forged',
        collegeId: COLLEGE_A,
        regNo: 'A005',
        role: 'superadmin',
      })
    )
  })
})

describe('student academic reads', () => {
  it('reads only attendance belonging to the canonical domain student ID', async () => {
    const db = studentContext().firestore()
    const own = await assertSucceeds(
      getDocs(
        query(
          collection(db, 'attendanceRecords'),
          where('collegeId', '==', COLLEGE_A),
          where('studentId', '==', STUDENT_ID),
          orderBy('date', 'desc')
        )
      )
    )
    assert.equal(own.size, 1)
    await assertFails(getDoc(doc(db, 'attendanceRecords', 'attendance-other')))
  })

  it('reads same-college timetable rows but not another college timetable', async () => {
    const db = studentContext().firestore()
    const schedule = await assertSucceeds(
      getDocs(
        query(
          collection(db, 'weeklySchedules'),
          where('collegeId', '==', COLLEGE_A),
          where('branch', '==', 'B.Com')
        )
      )
    )
    assert.equal(schedule.size, 1)
    await assertFails(getDoc(doc(db, 'weeklySchedules', 'schedule-b')))
  })

  it('denies students direct access to authoring assignments, questions, and papers', async () => {
    const db = studentContext().firestore()
    await assertFails(getDoc(doc(db, 'assignments', 'assignment-a')))
    await assertFails(getDoc(doc(db, 'questions', 'question-a')))
    await assertFails(getDoc(doc(db, 'papers', 'paper-a')))
  })

  it('keeps students out of test authoring and answer keys, but lets each read their own attempt', async () => {
    const db = studentContext().firestore()
    // Authoring and answer keys stay staff-only.
    await assertFails(getDoc(doc(db, 'scheduledTests', 'test-a')))
    await assertFails(getDoc(doc(db, 'scheduledTests', 'test-a', 'assessmentQuestions', 'q-0001')))
    // A student reads their own attempt (how the portal shows results), but not
    // another student's, and never writes one.
    await assertSucceeds(getDoc(doc(db, 'studentAssessments', 'test-a_student-domain-a')))
    await assertFails(getDoc(doc(db, 'studentAssessments', 'test-a_student-domain-b')))
    await assertFails(setDoc(doc(db, 'studentAssessments', 'forged-attempt'), {
      collegeId: COLLEGE_A,
      studentId: STUDENT_ID,
      marksObtained: 100,
    }))
  })

  it('allows same-college faculty to review tests and attempts but not mutate authoritative state', async () => {
    const db = facultyContext().firestore()
    await assertSucceeds(getDoc(doc(db, 'scheduledTests', 'test-a')))
    await assertSucceeds(getDoc(doc(db, 'scheduledTests', 'test-a', 'assessmentQuestions', 'q-0001')))
    const attempt = doc(db, 'studentAssessments', 'test-a_student-domain-a')
    await assertSucceeds(getDoc(attempt))
    await assertFails(updateDoc(attempt, { marksObtained: 100 }))
  })

  it('allows only the student to read a finalized submission and denies browser writes', async () => {
    const ownDb = studentContext().firestore()
    const otherDb = testEnv.authenticatedContext(OTHER_UID, {
      role: 'student',
      collegeId: COLLEGE_A,
    }).firestore()
    const submission = doc(ownDb, 'submissions', 'assignment-a_student-domain-a')
    await assertSucceeds(getDoc(submission))
    await assertFails(getDoc(doc(otherDb, 'submissions', 'assignment-a_student-domain-a')))
    await assertFails(updateDoc(submission, { remarks: 'browser mutation' }))
  })

  it('reads only the student’s published official grade records', async () => {
    const db = studentContext().firestore()
    const grades = await assertSucceeds(
      getDocs(
        query(
          collection(db, 'gradeRecords'),
          where('collegeId', '==', COLLEGE_A),
          where('studentId', '==', STUDENT_ID),
          where('status', '==', 'published'),
          orderBy('semester', 'desc')
        )
      )
    )
    assert.equal(grades.size, 1)
    await assertFails(getDoc(doc(db, 'gradeRecords', 'grade-other')))
    await assertFails(getDoc(doc(db, 'gradeRecords', 'grade-own-draft')))
  })

  it('allows same-college faculty to read authoring records but denies direct assignment lifecycle writes', async () => {
    const db = facultyContext().firestore()
    await assertSucceeds(getDoc(doc(db, 'questions', 'question-a')))
    await assertSucceeds(getDoc(doc(db, 'papers', 'paper-a')))
    await assertSucceeds(getDoc(doc(db, 'assignments', 'assignment-a')))
    await assertFails(updateDoc(doc(db, 'assignments', 'assignment-a'), { status: 'graded' }))
    await assertFails(setDoc(doc(db, 'assignments', 'forged-assignment'), {
      collegeId: COLLEGE_A,
      facultyUid: 'faculty-a',
      status: 'published',
      title: 'Unvalidated assignment',
    }))
    await assertFails(updateDoc(doc(db, 'gradeRecords', 'grade-own-draft'), {
      status: 'published',
    }))
    await assertFails(updateDoc(doc(db, 'papers', 'paper-a'), {
      verificationStatus: 'rejected-by-hod',
      status: 'draft',
    }))
    await assertFails(setDoc(doc(db, 'papers', 'forged-published-paper'), {
      collegeId: COLLEGE_A,
      createdBy: 'faculty-a',
      status: 'published',
      verificationStatus: 'approved-by-hod',
      title: 'Forged publication',
    }))
  })
})

describe('faculty topic planner (facultyTopics)', () => {
  it('lets a faculty member list, create, update, and delete their own topics', async () => {
    const db = facultyContext().firestore()

    // The page's first query: owned rows only, keyed by the signed-in uid.
    const own = await assertSucceeds(
      getDocs(
        query(
          collection(db, 'facultyTopics'),
          where('facultyId', '==', 'faculty-a')
        )
      )
    )
    assert.equal(own.size, 1)
    assert.equal(own.docs[0].id, 'topic-own')

    const created = await assertSucceeds(
      addDoc(collection(db, 'facultyTopics'), {
        facultyId: 'faculty-a',
        title: 'Quadratic equations',
        subject: 'Mathematics',
        status: 'planned',
        createdAt: '2026-09-03T09:00:00.000Z',
      })
    )
    await assertSucceeds(updateDoc(created, { status: 'completed' }))
    await assertSucceeds(deleteDoc(created))
  })

  it('refuses topics stamped with, or handed to, another faculty id', async () => {
    const db = facultyContext().firestore()

    await assertFails(addDoc(collection(db, 'facultyTopics'), {
      facultyId: 'faculty-b',
      title: 'Forged ownership',
      subject: 'Mathematics',
      status: 'planned',
      createdAt: '2026-09-03T09:00:00.000Z',
    }))
    // Re-parenting an owned row onto someone else is denied too.
    await assertFails(updateDoc(doc(db, 'facultyTopics', 'topic-own'), {
      facultyId: 'faculty-b',
    }))
  })

  it('denies a faculty member updating or deleting another faculty topic', async () => {
    const db = facultyContext().firestore()
    await assertFails(updateDoc(doc(db, 'facultyTopics', 'topic-other'), { title: 'Hijacked' }))
    await assertFails(deleteDoc(doc(db, 'facultyTopics', 'topic-other')))
  })

  it('keeps students and claim-less accounts out of the planner', async () => {
    const studentDb = studentContext().firestore()
    await assertFails(
      getDocs(
        query(
          collection(studentDb, 'facultyTopics'),
          where('facultyId', '==', 'faculty-a')
        )
      )
    )
    await assertFails(getDoc(doc(studentDb, 'facultyTopics', 'topic-own')))
    await assertFails(addDoc(collection(studentDb, 'facultyTopics'), {
      facultyId: 'faculty-a',
      title: 'Student-authored topic',
      subject: 'Mathematics',
      status: 'planned',
      createdAt: '2026-09-03T09:00:00.000Z',
    }))

    // No role/collegeId claims: staff access is claim-only, so even a faculty
    // profile document must not open the planner.
    const legacyDb = testEnv
      .authenticatedContext('legacy-faculty-a', { email: 'legacy-faculty@example.edu' })
      .firestore()
    await assertFails(
      getDocs(
        query(
          collection(legacyDb, 'facultyTopics'),
          where('facultyId', '==', 'legacy-faculty-a')
        )
      )
    )
  })
})

describe('staff (faculty) attendance', () => {
  // The collection the faculty "My Attendance" page writes and the principal's
  // Faculty Attendance tab reads. Ownership is the whole security story: a
  // teacher marks their own day, the people who run the college read everyone's.
  //
  // `isStaff()` is deliberately NOT the college-wide read gate — it includes
  // faculty and mentors, so it would let any teacher list every colleague's
  // attendance. The first test below is the one that would catch that.
  function ownDay(collegeId = COLLEGE_A, uid = 'faculty-a', date = '2026-09-01') {
    return `${collegeId}__${uid}__${date}`
  }

  function principalContext(collegeId = COLLEGE_A) {
    return testEnv.authenticatedContext(`principal-${collegeId}`, {
      role: 'principal',
      collegeId,
    })
  }

  it('lets a faculty member read and mark only their own day', async () => {
    const db = facultyContext().firestore()

    // The page's own-month query: scoped to the signed-in uid.
    const mine = await assertSucceeds(
      getDocs(
        query(
          collection(db, 'staffAttendance'),
          where('facultyId', '==', 'faculty-a'),
          where('date', '>=', '2026-09-01'),
          where('date', '<=', '2026-09-30')
        )
      )
    )
    assert.equal(mine.size, 1)
    assert.equal(mine.docs[0].id, ownDay())

    await assertSucceeds(getDoc(doc(db, 'staffAttendance', ownDay())))

    // Writing a NEW day for yourself, at the deterministic id.
    await assertSucceeds(
      setDoc(doc(db, 'staffAttendance', ownDay(COLLEGE_A, 'faculty-a', '2026-09-02')), {
        collegeId: COLLEGE_A,
        facultyId: 'faculty-a',
        facultyName: 'Faculty A',
        date: '2026-09-02',
        month: '2026-09',
        status: 'present',
        source: 'self',
        markedBy: 'faculty-a',
      })
    )
    // Correcting an existing day of your own.
    await assertSucceeds(updateDoc(doc(db, 'staffAttendance', ownDay()), { status: 'late' }))
  })

  it('refuses a record stamped with another faculty id', async () => {
    const db = facultyContext().firestore()

    // Marking someone else present/absent is the forgery this collection most
    // needs to prevent.
    await assertFails(
      setDoc(doc(db, 'staffAttendance', ownDay(COLLEGE_A, 'faculty-b', '2026-09-02')), {
        collegeId: COLLEGE_A,
        facultyId: 'faculty-b',
        facultyName: 'Faculty B',
        date: '2026-09-02',
        month: '2026-09',
        status: 'absent',
        source: 'self',
        markedBy: 'faculty-a',
      })
    )

    // So is re-parenting your own row onto a colleague, which would move a day
    // of attendance between people without creating a new document.
    await assertFails(updateDoc(doc(db, 'staffAttendance', ownDay()), { facultyId: 'faculty-b' }))

    // And reading or editing theirs directly.
    await assertFails(getDoc(doc(db, 'staffAttendance', ownDay(COLLEGE_A, 'faculty-b'))))
    await assertFails(updateDoc(doc(db, 'staffAttendance', ownDay(COLLEGE_A, 'faculty-b')), { status: 'absent' }))
  })

  it('keeps the college-wide list away from ordinary faculty', async () => {
    const db = facultyContext().firestore()
    // The principal's query. A teacher must not be able to run it: the rollup
    // names who is absent, which is exactly what a colleague should not see.
    await assertFails(
      getDocs(query(collection(db, 'staffAttendance'), where('collegeId', '==', COLLEGE_A)))
    )
  })

  it('reserves deletion for admin and principal', async () => {
    // A teacher cannot delete their own history either — a day of attendance is
    // payroll-relevant, so removing one is a management action.
    await assertFails(deleteDoc(doc(facultyContext().firestore(), 'staffAttendance', ownDay())))

    const hodDb = testEnv
      .authenticatedContext('hod-a', { role: 'hod', collegeId: COLLEGE_A })
      .firestore()
    await assertFails(deleteDoc(doc(hodDb, 'staffAttendance', ownDay())))

    await assertSucceeds(deleteDoc(doc(principalContext().firestore(), 'staffAttendance', ownDay())))
  })

  it('gives management the college rollup but not another college\'s', async () => {
    const db = principalContext().firestore()

    // Exercise the exact date-range and month query shapes used by
    // staffAttendanceApi, not just a simplified college-only approximation.
    const collegeA = await assertSucceeds(
      getDocs(query(
        collection(db, 'staffAttendance'),
        where('collegeId', '==', COLLEGE_A),
        where('date', '>=', '2026-09-01'),
        where('date', '<=', '2026-09-30')
      ))
    )
    assert.equal(collegeA.size, 2)
    const collegeAMonth = await assertSucceeds(
      getDocs(query(
        collection(db, 'staffAttendance'),
        where('collegeId', '==', COLLEGE_A),
        where('month', '==', '2026-09')
      ))
    )
    assert.equal(collegeAMonth.size, 2)

    // Tenancy comes from the claim, so the same role in another college sees
    // only its own rows.
    const otherDb = principalContext(COLLEGE_B).firestore()
    await assertFails(getDoc(doc(otherDb, 'staffAttendance', ownDay())))
    const collegeB = await assertSucceeds(
      getDocs(query(collection(otherDb, 'staffAttendance'), where('collegeId', '==', COLLEGE_B)))
    )
    assert.equal(collegeB.size, 1)
  })

  it('lets management correct a record but not move it between people', async () => {
    const db = principalContext().firestore()
    await assertSucceeds(updateDoc(doc(db, 'staffAttendance', ownDay()), { status: 'absent', source: 'admin' }))
    await assertFails(updateDoc(doc(db, 'staffAttendance', ownDay()), { facultyId: 'faculty-b' }))
  })

  it('keeps students and claim-less accounts out entirely', async () => {
    const studentDb = studentContext().firestore()
    await assertFails(getDoc(doc(studentDb, 'staffAttendance', ownDay())))
    await assertFails(
      getDocs(query(collection(studentDb, 'staffAttendance'), where('facultyId', '==', 'faculty-a')))
    )

    // No role/collegeId claims: staff access is claim-only, so even a faculty
    // profile document must not open the collection.
    const legacyDb = testEnv
      .authenticatedContext('legacy-faculty-a', { email: 'legacy-faculty@example.edu' })
      .firestore()
    await assertFails(
      getDocs(query(collection(legacyDb, 'staffAttendance'), where('facultyId', '==', 'faculty-a')))
    )
    await assertFails(
      setDoc(doc(legacyDb, 'staffAttendance', ownDay(COLLEGE_A, 'legacy-faculty-a', '2026-09-02')), {
        collegeId: COLLEGE_A,
        facultyId: 'legacy-faculty-a',
        facultyName: 'Legacy Faculty',
        date: '2026-09-02',
        month: '2026-09',
        status: 'present',
        source: 'self',
        markedBy: 'legacy-faculty-a',
      })
    )
  })

  // ─── Stale identity claims (the "My Attendance" production bug) ──────────
  //
  // A faculty token with the correct ROLE claim but a missing or wrong
  // COLLEGE claim can read its own rows (ownership is uid-based and
  // claim-independent) but every write is denied, because writes require
  // the tenant claim (`isCollegeStaff` + `sameCollege`). The rules
  // intentionally keep that requirement: the fix is claim issuance
  // (syncMyIdentity, self-healed by the client), not rule relaxation.
  // These tests pin both halves of that boundary.
  describe('stale identity claims', () => {
    function newDay(collegeId: string, uid: string, date: string) {
      return {
        collegeId,
        facultyId: uid,
        facultyName: 'Faculty A',
        date,
        month: date.slice(0, 7),
        status: 'present',
        source: 'self',
        markedBy: uid,
      }
    }

    it('lets a role-only token read its own history but refuse its writes', async () => {
      // Correct role claim, NO collegeId claim.
      const db = testEnv.authenticatedContext('faculty-a', { role: 'faculty' }).firestore()

      // Ownership reads are claim-independent and must keep working — this
      // is why the symptom is "the month loads, the save fails", not a full
      // lock-out.
      const mine = await assertSucceeds(
        getDocs(
          query(
            collection(db, 'staffAttendance'),
            where('facultyId', '==', 'faculty-a'),
            where('date', '>=', '2026-09-01'),
            where('date', '<=', '2026-09-30')
          )
        )
      )
      assert.equal(mine.size, 1)
      await assertSucceeds(getDoc(doc(db, 'staffAttendance', ownDay())))

      // The get on a not-yet-written deterministic id is denied by design
      // (the rule cannot prove ownership of a document with no data, and
      // widening `get` for it would open ownership probes on another
      // faculty's id space). The client expects this and treats it as
      // "no record yet" — it must not become a real permission failure.
      await assertFails(getDoc(doc(db, 'staffAttendance', ownDay(COLLEGE_A, 'faculty-a', '2026-09-03'))))

      // The writes the faculty actually makes: denied until syncMyIdentity
      // re-issues the college claim and the token is force-refreshed.
      await assertFails(
        setDoc(doc(db, 'staffAttendance', ownDay(COLLEGE_A, 'faculty-a', '2026-09-04')), newDay(COLLEGE_A, 'faculty-a', '2026-09-04'))
      )
      await assertFails(updateDoc(doc(db, 'staffAttendance', ownDay()), { status: 'late' }))
    })

    it('refuses writes when the college claim points at another college', async () => {
      // Correct role claim, collegeId claim for the WRONG college.
      const db = testEnv
        .authenticatedContext('faculty-a', { role: 'faculty', collegeId: COLLEGE_B })
        .firestore()

      // Ownership reads still work (uid-based)…
      await assertSucceeds(
        getDocs(query(collection(db, 'staffAttendance'), where('facultyId', '==', 'faculty-a')))
      )

      // …but the record the UI writes is stamped with the profile's college,
      // which does not match the stale claim — denied, not silently moved
      // across tenants.
      await assertFails(
        setDoc(doc(db, 'staffAttendance', ownDay(COLLEGE_A, 'faculty-a', '2026-09-05')), newDay(COLLEGE_A, 'faculty-a', '2026-09-05'))
      )
      // And the existing record (college A) cannot be corrected by a token
      // that claims college B.
      await assertFails(updateDoc(doc(db, 'staffAttendance', ownDay()), { status: 'late' }))
    })

    it('lets the repaired token create, update and re-read its own day', async () => {
      // After syncMyIdentity: role AND college claim agree with the profile.
      const db = facultyContext().firestore()

      await assertSucceeds(
        setDoc(doc(db, 'staffAttendance', ownDay(COLLEGE_A, 'faculty-a', '2026-09-06')), newDay(COLLEGE_A, 'faculty-a', '2026-09-06'))
      )
      await assertSucceeds(updateDoc(doc(db, 'staffAttendance', ownDay(COLLEGE_A, 'faculty-a', '2026-09-06')), { status: 'late' }))
      // A get on the now-existing deterministic id is allowed: the document
      // exists and is owned, which is exactly when the single-day prefill
      // must succeed.
      await assertSucceeds(getDoc(doc(db, 'staffAttendance', ownDay(COLLEGE_A, 'faculty-a', '2026-09-06'))))
    })

    it('denies cross-college faculty the record, the list and the write', async () => {
      // A correctly-claimed faculty of another college.
      const db = testEnv
        .authenticatedContext('faculty-c', { role: 'faculty', collegeId: COLLEGE_B })
        .firestore()

      await assertFails(getDoc(doc(db, 'staffAttendance', ownDay())))
      await assertFails(
        getDocs(query(collection(db, 'staffAttendance'), where('facultyId', '==', 'faculty-a')))
      )
      await assertFails(
        setDoc(doc(db, 'staffAttendance', ownDay(COLLEGE_A, 'faculty-a', '2026-09-07')), newDay(COLLEGE_A, 'faculty-a', '2026-09-07'))
      )
    })
  })
})

describe('legacy no-claim faculty reads', () => {
  function legacyFacultyContext() {
    // No role/collegeId claims and no users/{uid} document: the account is only
    // a legacy faculty profile. Identity for AUTHORIZATION is claim-only, so
    // staff-scoped reads are denied until identity repair issues claims and the
    // user signs in again. (The profile doc still lets them sign IN — it just
    // cannot authorize a staff query. See firestore.rules header.)
    return testEnv.authenticatedContext('legacy-faculty-a', {
      email: 'legacy-faculty@example.edu',
    })
  }

  it('denies staff-scoped queries to a legacy faculty until claims are issued', async () => {
    const db = legacyFacultyContext().firestore()

    // Role comes from the token claim ONLY — a claim-less account must not be
    // able to read staff-only collections by virtue of a client-writable
    // profile document.
    await assertFails(
      getDocs(
        query(
          collection(db, 'weeklySchedules'),
          where('facultyId', '==', 'legacy-faculty-a'),
          limit(100)
        )
      )
    )

    await assertFails(
      getDocs(
        query(
          collection(db, 'classSessions'),
          where('facultyId', '==', 'legacy-faculty-a'),
          limit(100)
        )
      )
    )

    await assertFails(
      getDocs(
        query(
          collection(db, 'assignments'),
          where('collegeId', '==', COLLEGE_A),
          where('facultyUid', '==', 'legacy-faculty-a'),
          orderBy('createdAt', 'desc'),
          limit(100)
        )
      )
    )
  })

  it('does not grant legacy faculty implicit superadmin or write access', async () => {
    const db = legacyFacultyContext().firestore()
    await assertFails(updateDoc(doc(db, 'assignments', 'assignment-legacy-a'), {
      status: 'graded',
    }))
    await assertFails(setDoc(doc(db, 'users', 'legacy-faculty-a'), {
      uid: 'legacy-faculty-a',
      role: 'superadmin',
    }))
  })
})

describe('notification identity & access', () => {
  // The direct student read these tests asserted was REMOVED on purpose when
  // the panel was rewired: students now receive their feed through the
  // `getMyNotifications` callable (which resolves batch/branch server-side
  // and can scope per-recipient reads the rules cannot express). Rules for the
  // collection are superadmin+staff only — any browser path a student tries
  // must fail, addressed to their own id or not.
  it('refuses students every direct notification read', async () => {
    const db = studentContext().firestore()
    await assertFails(getDoc(doc(db, 'notifications', 'notif-own')))
    await assertFails(getDoc(doc(db, 'notifications', 'notif-other')))
    await assertFails(getDoc(doc(db, 'notifications', 'notif-broadcast')))
  })

  it('refuses the student notification list query outright', async () => {
    const db = studentContext().firestore()
    await assertFails(
      getDocs(
        query(
          collection(db, 'notifications'),
          where('studentId', '==', STUDENT_ID),
          limit(50)
        )
      )
    )
  })

  it('keeps same-college staff able to read notifications but not students at large', async () => {
    const db = facultyContext().firestore()
    await assertSucceeds(getDoc(doc(db, 'notifications', 'notif-broadcast')))
    await assertSucceeds(getDoc(doc(db, 'notifications', 'notif-own')))
  })
})

describe('paper authoring storage', () => {
  it('allows staff uploads only in their tenant and author namespace', async () => {
    const storage = facultyContext().storage()
    const contents = new Uint8Array([37, 80, 68, 70])
    await assertSucceeds(uploadBytes(
      ref(storage, `paper-files/${COLLEGE_A}/faculty-a/paper-new/paper_exam.pdf`),
      contents,
      { contentType: 'application/pdf' }
    ))
    await assertFails(uploadBytes(
      ref(storage, `paper-files/${COLLEGE_B}/faculty-a/paper-new/paper_exam.pdf`),
      contents,
      { contentType: 'application/pdf' }
    ))
    await assertFails(uploadBytes(
      ref(storage, `paper-files/${COLLEGE_A}/other-faculty/paper-new/paper_exam.pdf`),
      contents,
      { contentType: 'application/pdf' }
    ))
  })
})

describe('question-paper import storage', () => {
  // Path contract: question-paper-imports/{uid}/{jobId}/{fileName}
  // Only the superadmin who owns the job folder may write; the document must be
  // a supported type; a college user gets nothing.
  it('allows the superadmin to upload into their own job folder only', async () => {
    const storage = superadminContext().storage()
    const pdf = new Uint8Array([37, 80, 68, 70])
    await assertSucceeds(uploadBytes(
      ref(storage, 'question-paper-imports/platform-root/job-abc123/BCU-BCom-5-Sem-2024.zip'),
      pdf,
      { contentType: 'application/zip' }
    ))
    // Someone else's uid segment: denied even for a superadmin.
    await assertFails(uploadBytes(
      ref(storage, 'question-paper-imports/other-admin/job-abc123/papers.zip'),
      pdf,
      { contentType: 'application/zip' }
    ))
    // Unsupported type: denied.
    await assertFails(uploadBytes(
      ref(storage, 'question-paper-imports/platform-root/job-abc123/answers.exe'),
      pdf,
      { contentType: 'application/x-msdownload' }
    ))
  })

  it('denies college staff and students entirely', async () => {
    const contents = new Uint8Array([37, 80, 68, 70])
    await assertFails(uploadBytes(
      ref(facultyContext().storage(), 'question-paper-imports/faculty-a/job-abc123/papers.zip'),
      contents,
      { contentType: 'application/zip' }
    ))
    await assertFails(getDownloadURL(ref(facultyContext().storage(), 'question-paper-imports/platform-root/job-abc123/papers.zip')))
  })
})

describe('question bank import jobs are server-only', () => {
  // Collection contract: questionBankImportJobs/{jobId} is written by the api
  // function's /question-import routes with the Admin SDK, never by a browser.
  // The panel reads job state back through GET /jobs/:id.
  it('denies client reads and writes even for a superadmin', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'questionBankImportJobs', 'job-abc123'), {
        jobId: 'job-abc123',
        ownerUid: 'platform-root',
        status: 'awaiting-upload',
        counters: { files: 3, drafted: 0 },
      })
    })

    const db = superadminContext().firestore()
    await assertFails(getDoc(doc(db, 'questionBankImportJobs', 'job-abc123')))
    await assertFails(getDocs(query(collection(db, 'questionBankImportJobs'), limit(10))))
    await assertFails(setDoc(doc(db, 'questionBankImportJobs', 'forged'), {
      jobId: 'forged',
      ownerUid: 'platform-root',
      status: 'complete',
      counters: { files: 999, drafted: 999 },
    }))
    await assertFails(updateDoc(doc(db, 'questionBankImportJobs', 'job-abc123'), {
      'counters.drafted': 999,
    }))
    await assertFails(deleteDoc(doc(db, 'questionBankImportJobs', 'job-abc123')))
  })

  it('leaves the drafts the worker writes readable in the question bank', async () => {
    // The boundary that matters: only the bookkeeping is closed. Drafts land in
    // questionBank_meta as `pending` and a superadmin still reviews them.
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'questionBank_meta', 'draft-1'), {
        questionId: 'draft-1',
        previewText: 'State the features of Indian economy.',
        status: 'pending',
        createdBy: { userId: 'platform-root', collegeId: null },
      })
    })

    const db = superadminContext().firestore()
    await assertSucceeds(getDoc(doc(db, 'questionBank_meta', 'draft-1')))
  })
})

describe('attendance summaries (item 3.1)', () => {
  // attendanceSummaries/{studentId} is written only by the attendanceSummary
  // Cloud Functions. A student reads their own; college staff read their
  // college's; a client can never write a percentage.
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'attendanceSummaries', STUDENT_ID), {
        studentId: STUDENT_ID,
        collegeId: COLLEGE_A,
        total: 120,
        present: 100,
        absent: 15,
        late: 5,
        updatedAt: '2026-09-25T02:30:00.000Z',
      })
      await setDoc(doc(context.firestore(), 'attendanceSummaries', OTHER_STUDENT_ID), {
        studentId: OTHER_STUDENT_ID,
        collegeId: COLLEGE_A,
        total: 90,
        present: 60,
        absent: 30,
        updatedAt: '2026-09-25T02:30:00.000Z',
      })
    })
  })

  it('lets a student read their own summary and not another student\u2019s', async () => {
    const db = studentContext().firestore()
    await assertSucceeds(getDoc(doc(db, 'attendanceSummaries', STUDENT_ID)))
    await assertFails(getDoc(doc(db, 'attendanceSummaries', OTHER_STUDENT_ID)))
  })

  it('denies every client write, including from a superadmin', async () => {
    const student = studentContext().firestore()
    await assertFails(setDoc(doc(student, 'attendanceSummaries', STUDENT_ID), { total: 999, present: 999 }))
    await assertFails(updateDoc(doc(student, 'attendanceSummaries', STUDENT_ID), { present: 120 }))
    const admin = superadminContext().firestore()
    await assertFails(updateDoc(doc(admin, 'attendanceSummaries', STUDENT_ID), { present: 120 }))
    await assertFails(deleteDoc(doc(admin, 'attendanceSummaries', STUDENT_ID)))
  })

  it('lets same-college staff read a student summary', async () => {
    await assertSucceeds(getDoc(doc(facultyContext().firestore(), 'attendanceSummaries', STUDENT_ID)))
  })
})

describe('platform documents are server-only', () => {
  // `platform/stats` (refreshPlatformStats, item 2.4) and
  // `platform/aiModelCanary` (model canary, item 2.1) are written only by Cloud
  // Functions with the Admin SDK. A superadmin may READ them — the console needs
  // to — but no client may write, so counters cannot be forged or wiped.
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore()
      await setDoc(doc(db, 'platform', 'stats'), {
        totalColleges: 3,
        totalStudents: 120,
        updatedAt: '2026-09-25T06:00:00.000Z',
      })
      await setDoc(doc(db, 'platform', 'aiModelCanary'), {
        checkedAt: '2026-09-25T01:00:00.000Z',
        degradedTiers: [],
      })
    })
  })

  it('lets a superadmin read the stats and canary documents', async () => {
    const db = superadminContext().firestore()
    await assertSucceeds(getDoc(doc(db, 'platform', 'stats')))
    await assertSucceeds(getDoc(doc(db, 'platform', 'aiModelCanary')))
  })

  it('denies every client write, including from a superadmin', async () => {
    const db = superadminContext().firestore()
    await assertFails(setDoc(doc(db, 'platform', 'stats'), { totalStudents: 999999 }))
    await assertFails(updateDoc(doc(db, 'platform', 'stats'), { totalColleges: 999 }))
    await assertFails(deleteDoc(doc(db, 'platform', 'aiModelCanary')))
  })

  it('denies reads to college staff and students', async () => {
    await assertFails(getDoc(doc(facultyContext().firestore(), 'platform', 'stats')))
    await assertFails(getDoc(doc(studentContext().firestore(), 'platform', 'stats')))
    await assertFails(getDoc(doc(facultyContext().firestore(), 'platform', 'aiModelCanary')))
  })
})

describe('prep model answers and MCQ sets (items 3.4 / 3.5)', () => {
  // The label a student sees is "Model answer · AI-generated, reviewed". That is
  // only true if a draft cannot be read and the status cannot be flipped from a
  // browser, which is what these assertions pin down.
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore()
      await setDoc(doc(db, 'prep_paper_answers', 'paper-1__A__1'), {
        paperId: 'paper-1',
        qid: 'A__1',
        status: 'published',
        answerMd: 'Cost audit is the verification of cost records.',
      })
      await setDoc(doc(db, 'prep_paper_answers', 'paper-1__A__2'), {
        paperId: 'paper-1',
        qid: 'A__2',
        status: 'draft',
        answerMd: 'Draft that no student may see.',
      })
      await setDoc(doc(db, 'prep_mcq_sets', 'paper-1__A__1'), {
        paperId: 'paper-1',
        status: 'published',
        items: [{ question: 'Which document records cost?', options: ['Cost sheet', 'Ledger', 'Cash book', 'None'], correctIndex: 0 }],
      })
      await setDoc(doc(db, 'prep_mcq_sets', 'paper-1__A__2'), {
        paperId: 'paper-1',
        status: 'draft',
        items: [],
      })
    })
  })

  it('lets a signed-in learner read a published answer but never a draft', async () => {
    const db = studentContext().firestore()
    await assertSucceeds(getDoc(doc(db, 'prep_paper_answers', 'paper-1__A__1')))
    await assertFails(getDoc(doc(db, 'prep_paper_answers', 'paper-1__A__2')))
  })

  it('lets a superadmin read the draft so the review queue can be shown', async () => {
    const db = superadminContext().firestore()
    await assertSucceeds(getDoc(doc(db, 'prep_paper_answers', 'paper-1__A__2')))
  })

  it('denies writes to every client, including a superadmin', async () => {
    const db = superadminContext().firestore()
    await assertFails(updateDoc(doc(db, 'prep_paper_answers', 'paper-1__A__2'), { status: 'published' }))
    await assertFails(setDoc(doc(db, 'prep_paper_answers', 'paper-1__A__3'), { status: 'published' }))
    await assertFails(deleteDoc(doc(db, 'prep_paper_answers', 'paper-1__A__1')))
  })

  it('applies the same boundary to the quick-revision MCQ sets', async () => {
    const student = studentContext().firestore()
    await assertSucceeds(getDoc(doc(student, 'prep_mcq_sets', 'paper-1__A__1')))
    await assertFails(getDoc(doc(student, 'prep_mcq_sets', 'paper-1__A__2')))
    await assertFails(updateDoc(doc(student, 'prep_mcq_sets', 'paper-1__A__2'), { status: 'published' }))
  })
})

describe('ai content cache is server-only (item 4.1)', () => {
  // `aiContentCache/{sha256}` is written by the content engine and read by the
  // engine alone. The cache key addresses syllabus content platform-wide, so a
  // readable collection would let any signed-in user enumerate the draft
  // library; a writable one would let them poison what every college is served.
  const cacheDoc = {
    content: '{"title":"Demand and Supply"}',
    model: 'gemini-2.5-flash-lite',
    promptVersion: 'study-pack-v1',
    createdAt: '2026-09-26T00:00:00.000Z',
  }
  const docId = 'a'.repeat(64)

  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'aiContentCache', docId), cacheDoc)
    })
  })

  it('denies reads to students, staff and superadmins', async () => {
    await assertFails(getDoc(doc(studentContext().firestore(), 'aiContentCache', docId)))
    await assertFails(getDoc(doc(facultyContext().firestore(), 'aiContentCache', docId)))
    await assertFails(getDoc(doc(superadminContext().firestore(), 'aiContentCache', docId)))
  })

  it('denies writes and deletes from every client', async () => {
    const db = superadminContext().firestore()
    await assertFails(setDoc(doc(db, 'aiContentCache', docId), { content: 'forged' }))
    await assertFails(updateDoc(doc(db, 'aiContentCache', docId), { content: 'forged' }))
    await assertFails(deleteDoc(doc(db, 'aiContentCache', docId)))
  })

  it('denies listing the collection', async () => {
    const db = studentContext().firestore()
    await assertFails(getDocs(query(collection(db, 'aiContentCache'), limit(5))))
  })
})

describe('ai chat quota counters are server-only', () => {
  // `ai_chat_quota/{uid}_{YYYY-MM-DD}` (D2) is read and written only by the
  // /ai/chat route through the Admin SDK. If a student could write it, the
  // daily cap would be decorative; if anyone could read it, one student's usage
  // would be another's business.
  const quotaDoc = { uid: 'quota-student', day: '2026-09-26', turns: 4 }

  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'ai_chat_quota', 'quota-student_2026-09-26'), quotaDoc)
    })
  })

  it('denies reads to the student it belongs to', async () => {
    await assertFails(getDoc(doc(studentContext().firestore(), 'ai_chat_quota', 'quota-student_2026-09-26')))
  })

  it('denies reads to staff and superadmins', async () => {
    await assertFails(getDoc(doc(facultyContext().firestore(), 'ai_chat_quota', 'quota-student_2026-09-26')))
    await assertFails(getDoc(doc(superadminContext().firestore(), 'ai_chat_quota', 'quota-student_2026-09-26')))
  })

  it('denies writes, so a cap can never be reset from a client', async () => {
    const db = studentContext().firestore()
    await assertFails(setDoc(doc(db, 'ai_chat_quota', 'quota-student_2026-09-26'), { ...quotaDoc, turns: 0 }))
    await assertFails(updateDoc(doc(db, 'ai_chat_quota', 'quota-student_2026-09-26'), { turns: 0 }))
    await assertFails(deleteDoc(doc(db, 'ai_chat_quota', 'quota-student_2026-09-26')))
  })

  it('denies listing the collection', async () => {
    const db = studentContext().firestore()
    await assertFails(getDocs(query(collection(db, 'ai_chat_quota'), limit(5))))
  })
})

describe('teaching materials storage', () => {
  it('allows staff uploads only in their own tenant', async () => {
    const contents = new Uint8Array([37, 80, 68, 70])
    await assertSucceeds(uploadBytes(
      ref(facultyContext().storage(), `colleges/${COLLEGE_A}/materials/1700000000000_notes.pdf`),
      contents,
      { contentType: 'application/pdf' }
    ))
    // Other college's tenant — the cross-tenant boundary.
    await assertFails(uploadBytes(
      ref(facultyBContext().storage(), `colleges/${COLLEGE_A}/materials/1700000000000_notes.pdf`),
      contents,
      { contentType: 'application/pdf' }
    ))
    // facultyBContext is tenant COLLEGE_B, so writing into B must succeed.
    await assertSucceeds(uploadBytes(
      ref(facultyBContext().storage(), `colleges/${COLLEGE_B}/materials/1700000000001_notes.pdf`),
      contents,
      { contentType: 'application/pdf' }
    ))
  })

  it('lets same-college students read but never write', async () => {
    const contents = new Uint8Array([37, 80, 68, 70])
    await assertSucceeds(uploadBytes(
      ref(facultyContext().storage(), `colleges/${COLLEGE_A}/materials/1700000000002_handout.pdf`),
      contents,
      { contentType: 'application/pdf' }
    ))
    await assertSucceeds(getDownloadURL(
      ref(studentContext().storage(), `colleges/${COLLEGE_A}/materials/1700000000002_handout.pdf`)
    ))
    // A student of the OTHER college cannot read A's materials.
    const otherCollegeStudent = testEnv.authenticatedContext('student-b', {
      role: 'student',
      collegeId: COLLEGE_B,
    })
    await assertFails(getDownloadURL(
      ref(otherCollegeStudent.storage(), `colleges/${COLLEGE_A}/materials/1700000000002_handout.pdf`)
    ))
    await assertFails(uploadBytes(
      ref(studentContext().storage(), `colleges/${COLLEGE_A}/materials/1700000000003_x.pdf`),
      contents,
      { contentType: 'application/pdf' }
    ))
  })

  it('lets a superadmin read any tenant and rejects unsupported types and oversize files', async () => {
    const contents = new Uint8Array([37, 80, 68, 70])
    await assertSucceeds(uploadBytes(
      ref(facultyContext().storage(), `colleges/${COLLEGE_A}/materials/1700000000004_video.mp4`),
      contents,
      { contentType: 'video/mp4' }
    ))
    await assertSucceeds(getDownloadURL(
      ref(superadminContext().storage(), `colleges/${COLLEGE_A}/materials/1700000000004_video.mp4`)
    ))
    // HTML is not a teaching material type.
    await assertFails(uploadBytes(
      ref(facultyContext().storage(), `colleges/${COLLEGE_A}/materials/1700000000005_page.html`),
      new TextEncoder().encode('<script>alert(1)</script>'),
      { contentType: 'text/html' }
    ))
    // Anything above the 50 MB contract is rejected before upload completes.
    await assertFails(uploadBytes(
      ref(facultyContext().storage(), `colleges/${COLLEGE_A}/materials/1700000000006_big.mp4`),
      new Uint8Array(51 * 1024 * 1024),
      { contentType: 'video/mp4' }
    ))
  })
})

describe('assignment submission storage', () => {
  it('allows a student to upload only inside their canonical submission path', async () => {
    const storage = studentContext().storage()
    const contents = new Uint8Array([37, 80, 68, 70])

    await assertSucceeds(
      uploadBytes(
        ref(storage, `assignment-submissions/${STUDENT_ID}/assignment-a/session-own/own.pdf`),
        contents,
        { contentType: 'application/pdf' }
      )
    )
    await assertFails(
      uploadBytes(
        ref(storage, `assignment-submissions/${OTHER_STUDENT_ID}/assignment-a/session-other/other.pdf`),
        contents,
        { contentType: 'application/pdf' }
      )
    )
  })

  it('rejects unsupported files and files above the declared limit contract', async () => {
    const storage = studentContext().storage()
    await assertFails(
      uploadBytes(
        ref(storage, `assignment-submissions/${STUDENT_ID}/assignment-a/session-own/script.html`),
        new TextEncoder().encode('<script>alert(1)</script>'),
        { contentType: 'text/html' }
      )
    )
  })
})

// ─── "Connect with mentors" — colleges/{id}/facultyAvailability +
// colleges/{id}/facultyAppointments. Before these rules existed, the
// catch-all denied every read and write, so faculty could not save office
// hours and students could not file or see requests. The rows name auth UIDs
// (AuthContext exposes user.id === uid); these tests seed through the
// sanctioned client paths themselves, so they pin the write rules too.
describe('connect with mentors (faculty availability & appointments)', () => {
  const slot = {
    id: '1',
    dayOfWeek: 'Monday',
    startTime: '15:00',
    endTime: '16:30',
    location: 'Cabin 12',
    isAcceptingRequests: true,
  }

  function appointmentPayload(overrides: Record<string, unknown> = {}) {
    return {
      collegeId: COLLEGE_A,
      studentId: STUDENT_UID,
      studentName: 'Student A',
      studentEmail: 'student-a@example.edu',
      facultyId: 'faculty-a',
      facultyName: 'Dr. A',
      subject: 'Thermodynamics',
      topic: 'Entropy balances',
      doubtDescription: 'How does the open-system entropy balance handle mass flow?',
      meetingType: 'doubt_clearing',
      preferredDate: '2026-09-21',
      preferredTimeSlot: '15:00 - 16:30',
      status: 'pending',
      createdAt: '2026-09-13T09:00:00.000Z',
      updatedAt: '2026-09-13T09:00:00.000Z',
      ...overrides,
    }
  }

  it('faculty save their own office hours; the row cannot mislabel or impersonate', async () => {
    const fDb = facultyContext().firestore()
    const own = doc(fDb, 'colleges', COLLEGE_A, 'facultyAvailability', 'faculty-a')
    await assertSucceeds(setDoc(own, { facultyId: 'faculty-a', slots: [slot], updatedAt: '2026-09-13T09:00:00.000Z' }))
    // A facultyId field pointing at someone else cannot live under this key.
    await assertFails(setDoc(own, { facultyId: 'faculty-z', slots: [slot] }))
    // And the key itself cannot be another person's uid.
    await assertFails(setDoc(
      doc(fDb, 'colleges', COLLEGE_A, 'facultyAvailability', 'admin-a'),
      { facultyId: 'admin-a', slots: [slot] }
    ))
    // Only college management may remove the row; the faculty owner may not.
    await assertFails(deleteDoc(own))
    const adminDb = adminContext().firestore()
    await assertSucceeds(setDoc(own, { facultyId: 'faculty-a', slots: [] }))
    await assertSucceeds(deleteDoc(doc(adminDb, 'colleges', COLLEGE_A, 'facultyAvailability', 'faculty-a')))
  })

  it('students read their college office hours but never write or list them', async () => {
    const fDb = facultyContext().firestore()
    await assertSucceeds(setDoc(
      doc(fDb, 'colleges', COLLEGE_A, 'facultyAvailability', 'faculty-a'),
      { facultyId: 'faculty-a', slots: [slot] }
    ))
    const sDb = studentContext().firestore()
    const hours = doc(sDb, 'colleges', COLLEGE_A, 'facultyAvailability', 'faculty-a')
    await assertSucceeds(getDoc(hours))
    await assertFails(setDoc(doc(sDb, 'colleges', COLLEGE_A, 'facultyAvailability', STUDENT_UID), { facultyId: STUDENT_UID, slots: [slot] }))
    await assertFails(updateDoc(hours, { slots: [] }))
    await assertFails(getDocs(collection(sDb, 'colleges', COLLEGE_A, 'facultyAvailability')))
    const foreignStudent = testEnv.authenticatedContext('student-auth-c', {
      role: 'student',
      collegeId: COLLEGE_B,
    }).firestore()
    await assertFails(getDoc(doc(foreignStudent, 'colleges', COLLEGE_A, 'facultyAvailability', 'faculty-a')))
    await assertFails(getDoc(doc(facultyBContext().firestore(), 'colleges', COLLEGE_A, 'facultyAvailability', 'faculty-a')))
  })

  it('students file pending requests for themselves only', async () => {
    const sDb = studentContext().firestore()
    const ref = collection(sDb, 'colleges', COLLEGE_A, 'facultyAppointments')
    await assertSucceeds(addDoc(ref, appointmentPayload()))
    await assertFails(addDoc(ref, appointmentPayload({ studentId: OTHER_UID })))
    await assertFails(addDoc(ref, appointmentPayload({ status: 'confirmed' })))
    await assertFails(addDoc(ref, appointmentPayload({ facultyId: null })))
    // A student's college is the claim; neither the path nor the field may
    // point at another college.
    await assertFails(addDoc(
      collection(sDb, 'colleges', COLLEGE_B, 'facultyAppointments'),
      appointmentPayload({ collegeId: COLLEGE_B })
    ))
    const mine = await assertSucceeds(
      getDocs(query(ref, where('studentId', '==', STUDENT_UID)))
    )
    assert.equal(mine.size, 1)
  })

  it('the named faculty answer, other students stay silent, management moderates', async () => {
    const sDb = studentContext().firestore()
    const created = await assertSucceeds(
      addDoc(collection(sDb, 'colleges', COLLEGE_A, 'facultyAppointments'), appointmentPayload())
    )
    const id = created.id
    const appt = doc(sDb, 'colleges', COLLEGE_A, 'facultyAppointments', id)

    const fDb = facultyContext().firestore()
    const addressed = doc(fDb, 'colleges', COLLEGE_A, 'facultyAppointments', id)
    await assertSucceeds(getDoc(addressed))
    await assertSucceeds(updateDoc(addressed, {
      status: 'confirmed',
      facultyRemarks: 'Come to Monday office hours.',
      meetingLocation: 'Cabin 12',
      updatedAt: '2026-09-13T10:00:00.000Z',
    }))
    // The answer fields only — the request text belongs to the student.
    await assertFails(updateDoc(addressed, { studentName: 'Someone Else' }))

    await assertSucceeds(updateDoc(appt, { status: 'cancelled', updatedAt: '2026-09-13T10:05:00.000Z' }))
    await assertFails(updateDoc(appt, { status: 'completed' }))

    const otherDb = testEnv.authenticatedContext(OTHER_UID, {
      role: 'student',
      collegeId: COLLEGE_A,
    }).firestore()
    await assertFails(getDoc(doc(otherDb, 'colleges', COLLEGE_A, 'facultyAppointments', id)))
    await assertFails(updateDoc(doc(otherDb, 'colleges', COLLEGE_A, 'facultyAppointments', id), { status: 'cancelled' }))

    await assertFails(getDoc(doc(facultyBContext().firestore(), 'colleges', COLLEGE_A, 'facultyAppointments', id)))

    const pDb = principalContext().firestore()
    await assertSucceeds(getDoc(doc(pDb, 'colleges', COLLEGE_A, 'facultyAppointments', id)))
    await assertFails(deleteDoc(appt))
    await assertSucceeds(deleteDoc(doc(pDb, 'colleges', COLLEGE_A, 'facultyAppointments', id)))
  })
})

// ── Department scoping (admin ≡ department HOD) ─────────────────────────────
// The `department` custom claim narrows admin/hod POINT reads via deptScoped()
// in firestore.rules. Deliberate tolerances pinned here:
//   - no claim, or an untagged document (or department 'All') ⇒ still visible
//   - case-insensitive match between claim and document tag
//   - `list` statements stay college-wide — current client queries are scoped
//     to collegeId only and filter by department in the UI (departmentScope.ts),
//     because a resource.data-dependent list rule would deny mixed-dept queries
//     outright. Row-level list enforcement is future work.
describe('department scoping for admin and hod claims', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore()
      await Promise.all([
        setDoc(doc(db, 'students', 'student-cse'), {
          userId: 'auth-cse', name: 'CSE Student', collegeId: COLLEGE_A,
          department: 'CSE', regNo: 'C001',
        }),
        setDoc(doc(db, 'students', 'student-cse-lower'), {
          userId: 'auth-cse-lower', name: 'CSE Student (lowercase tag)',
          collegeId: COLLEGE_A, department: 'cse', regNo: 'C002',
        }),
        setDoc(doc(db, 'students', 'student-eee'), {
          userId: 'auth-eee', name: 'EEE Student', collegeId: COLLEGE_A,
          department: 'EEE', regNo: 'E001',
        }),
        setDoc(doc(db, 'colleges', COLLEGE_A, 'students', 'E001'), {
          userId: 'auth-eee', studentDocId: 'student-eee', name: 'EEE Student',
          collegeId: COLLEGE_A, department: 'EEE',
        }),
        setDoc(doc(db, 'classSessions', 'session-cse'), {
          collegeId: COLLEGE_A, department: 'CSE', facultyId: 'faculty-a',
          branch: 'B.Com', batch: 'A', dayOfWeek: 1,
          startTime: '09:00', endTime: '10:00',
        }),
        setDoc(doc(db, 'classSessions', 'session-eee'), {
          collegeId: COLLEGE_A, department: 'EEE', facultyId: 'faculty-a',
          branch: 'B.Com', batch: 'B', dayOfWeek: 2,
          startTime: '10:00', endTime: '11:00',
        }),
        setDoc(doc(db, 'papers', 'paper-cse'), {
          collegeId: COLLEGE_A, department: 'CSE', createdBy: 'faculty-a',
          title: 'CSE Paper', status: 'draft', verificationStatus: 'draft',
        }),
        setDoc(doc(db, 'papers', 'paper-eee'), {
          collegeId: COLLEGE_A, department: 'EEE', createdBy: 'faculty-a',
          title: 'EEE Paper', status: 'draft', verificationStatus: 'draft',
        }),
        setDoc(doc(db, 'questionReviews', 'qr-cse'), {
          collegeId: COLLEGE_A, department: 'CSE', status: 'pending',
        }),
        setDoc(doc(db, 'questionReviews', 'qr-eee'), {
          collegeId: COLLEGE_A, department: 'EEE', status: 'pending',
        }),
      ])
    })
  })

  function adminCseContext() {
    return testEnv.authenticatedContext('admin-cse', {
      role: 'admin', collegeId: COLLEGE_A, department: 'CSE',
    })
  }

  function hodCseContext() {
    return testEnv.authenticatedContext('hod-cse', {
      role: 'hod', collegeId: COLLEGE_A, department: 'CSE',
    })
  }

  it('narrows admin point reads to their department, case-insensitively and tolerantly', async () => {
    const db = adminCseContext().firestore()
    await assertSucceeds(getDoc(doc(db, 'students', 'student-cse')))
    // Lowercase document tag matches the uppercase claim.
    await assertSucceeds(getDoc(doc(db, 'students', 'student-cse-lower')))
    // Another department is not readable…
    await assertFails(getDoc(doc(db, 'students', 'student-eee')))
    // …but an untagged legacy row stays visible (tolerant default until the
    // backfill stamps it), including inside the college path.
    await assertSucceeds(getDoc(doc(db, 'students', STUDENT_ID)))
    await assertSucceeds(getDoc(doc(db, 'colleges', COLLEGE_A, 'students', 'A001')))
    await assertFails(getDoc(doc(db, 'colleges', COLLEGE_A, 'students', 'E001')))
    // Tenancy is unchanged: another college never becomes readable.
    await assertFails(getDoc(doc(db, 'students', 'student-domain-c')))
  })

  it('keeps list queries college-wide so existing collegeId-scoped clients keep working', async () => {
    const db = adminCseContext().firestore()
    const snap = await assertSucceeds(
      getDocs(query(collection(db, 'students'), where('collegeId', '==', COLLEGE_A)))
    )
    // Server does not drop other-department rows from the list; the client
    // filters them (shared/utils/departmentScope). If list were dept-scoped
    // without query predicates this whole request would be permission-denied.
    assert.ok(snap.docs.some((d) => d.id === 'student-eee'))
    assert.ok(snap.docs.some((d) => d.id === 'student-cse'))
  })

  it('applies the same narrowing to hod claims on sessions, papers and reviews', async () => {
    const db = hodCseContext().firestore()
    await assertSucceeds(getDoc(doc(db, 'classSessions', 'session-cse')))
    await assertFails(getDoc(doc(db, 'classSessions', 'session-eee')))
    await assertSucceeds(getDoc(doc(db, 'papers', 'paper-cse')))
    await assertFails(getDoc(doc(db, 'papers', 'paper-eee')))
    await assertSucceeds(getDoc(doc(db, 'questionReviews', 'qr-cse')))
    await assertFails(getDoc(doc(db, 'questionReviews', 'qr-eee')))
    // Lists of the same collections remain college-wide.
    await assertSucceeds(getDocs(query(collection(db, 'papers'), where('collegeId', '==', COLLEGE_A))))
    await assertSucceeds(getDocs(query(collection(db, 'classSessions'), where('collegeId', '==', COLLEGE_A))))
  })

  it('does not narrow principals, faculty or superadmins, even with a department claim', async () => {
    const principal = testEnv.authenticatedContext('principal-a', {
      role: 'principal', collegeId: COLLEGE_A, department: 'CSE',
    }).firestore()
    await assertSucceeds(getDoc(doc(principal, 'students', 'student-eee')))
    await assertSucceeds(getDoc(doc(principal, 'classSessions', 'session-eee')))

    const faculty = testEnv.authenticatedContext('faculty-a', {
      role: 'faculty', collegeId: COLLEGE_A, department: 'CSE',
    }).firestore()
    await assertSucceeds(getDoc(doc(faculty, 'students', 'student-eee')))
    await assertSucceeds(getDoc(doc(faculty, 'papers', 'paper-eee')))

    const superadmin = superadminContext().firestore()
    await assertSucceeds(getDoc(doc(superadmin, 'students', 'student-eee')))
  })

  it('an admin without a department claim keeps the full college view', async () => {
    const db = adminContext().firestore()
    await assertSucceeds(getDoc(doc(db, 'students', 'student-eee')))
    await assertSucceeds(getDoc(doc(db, 'classSessions', 'session-eee')))
    await assertSucceeds(getDoc(doc(db, 'papers', 'paper-eee')))
  })
})

describe('academic calendar (Auto-Scheduler v2)', () => {
  // The holiday/fest/exam model `generateClassSessions` consults before
  // materialising a session. Staff read it (timetable screens banner
  // "Holiday — no classes"); writes are callable-only (saveCalendarEvent /
  // deleteCalendarEvent), so a client — even a college admin — can never
  // silently void or resurrect a class day.
  function seedEvent(id: string, collegeId = COLLEGE_A) {
    return testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'academicCalendar', id), {
        collegeId,
        title: 'Diwali',
        type: 'public-holiday',
        startDate: '2026-11-09',
        endDate: '2026-11-09',
        suspendsClasses: true,
      })
    })
  }

  it('staff can read; students cannot', async () => {
    await seedEvent('ev-a')
    const faculty = facultyContext().firestore()
    await assertSucceeds(getDoc(doc(faculty, 'academicCalendar', 'ev-a')))
    await assertSucceeds(
      getDocs(query(collection(faculty, 'academicCalendar'), where('collegeId', '==', COLLEGE_A), limit(5))),
    )
    const principal = principalContext().firestore()
    await assertSucceeds(getDoc(doc(principal, 'academicCalendar', 'ev-a')))

    const student = studentContext().firestore()
    await assertFails(getDoc(doc(student, 'academicCalendar', 'ev-a')))
  })

  it('no client write — create, update and delete all fail (callable-only)', async () => {
    await seedEvent('ev-a')
    const db = adminContext().firestore()
    await assertFails(
      setDoc(doc(db, 'academicCalendar', 'ev-new'), {
        collegeId: COLLEGE_A,
        title: 'Forged holiday',
        type: 'public-holiday',
        startDate: '2026-12-01',
        endDate: '2026-12-01',
        suspendsClasses: true,
      }),
    )
    await assertFails(updateDoc(doc(db, 'academicCalendar', 'ev-a'), { suspendsClasses: false }))
    await assertFails(deleteDoc(doc(db, 'academicCalendar', 'ev-a')))

    const superadmin = superadminContext().firestore()
    await assertFails(setDoc(doc(superadmin, 'academicCalendar', 'ev-sa'), {
      collegeId: COLLEGE_A,
      title: 'Also forged',
      type: 'fest',
      startDate: '2026-12-02',
      endDate: '2026-12-02',
      suspendsClasses: false,
    }))
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// College office roles: accounts (finance) / operations (library, inventory)
// ═══════════════════════════════════════════════════════════════════════════
describe('office roles — finance moved from HODs to the accounts team', () => {
  const accounts = () => testEnv.authenticatedContext('accounts-a', { role: 'accounts', collegeId: COLLEGE_A })
  const operations = () => testEnv.authenticatedContext('ops-a', { role: 'operations', collegeId: COLLEGE_A })
  const hod = () => testEnv.authenticatedContext('hod-a', { role: 'hod', collegeId: COLLEGE_A })
  const accountsB = () => testEnv.authenticatedContext('accounts-b', { role: 'accounts', collegeId: COLLEGE_B })

  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore()
      await Promise.all([
        setDoc(doc(db, 'colleges', COLLEGE_A, 'feePayments', 'fp1'), {
          studentId: STUDENT_ID, studentName: 'Student A', amount: 1000, paidAmount: 0, category: 'tuition', collegeId: COLLEGE_A,
        }),
        setDoc(doc(db, 'colleges', COLLEGE_A, 'payslips', '2026-09_p1'), {
          facultyUid: 'faculty-a', facultyProfileId: 'p1', payslipNo: 'PS-202609-P1',
          net: 100, month: '2026-09', status: 'pending_approval',
        }),
        setDoc(doc(db, 'colleges', COLLEGE_A, 'salaryStructures', 'p1'), {
          facultyUid: 'faculty-a', facultyProfileId: 'p1', basic: 1000,
        }),
        setDoc(doc(db, 'colleges', COLLEGE_A, 'libraryTitles', 't1'), { title: 'Algorithms', collegeId: COLLEGE_A }),
        setDoc(doc(db, 'colleges', COLLEGE_A, 'libraryLoans', 'l1'), {
          memberUid: STUDENT_UID, status: 'issued', titleId: 't1', dueDate: '2026-10-01',
        }),
        setDoc(doc(db, 'colleges', COLLEGE_A, 'libraryLoans', 'l2'), {
          memberUid: OTHER_UID, status: 'issued', titleId: 't1', dueDate: '2026-10-01',
        }),
        setDoc(doc(db, 'colleges', COLLEGE_A, 'libraryFines', 'f1'), {
          memberUid: STUDENT_UID, status: 'pending', amount: 20,
        }),
      ])
    })
  })

  it('accounts reads and writes the fee ledger; HODs, admins and operations cannot', async () => {
    await assertSucceeds(getDoc(doc(accounts().firestore(), 'colleges', COLLEGE_A, 'feePayments', 'fp1')))
    await assertSucceeds(updateDoc(doc(accounts().firestore(), 'colleges', COLLEGE_A, 'feePayments', 'fp1'), { paidAmount: 500 }))
    await assertSucceeds(updateDoc(doc(principalContext().firestore(), 'colleges', COLLEGE_A, 'feePayments', 'fp1'), { remarks: 'ok' }))
    for (const ctx of [hod(), adminContext(), operations(), facultyContext()]) {
      await assertFails(getDoc(doc(ctx.firestore(), 'colleges', COLLEGE_A, 'feePayments', 'fp1')))
      await assertFails(updateDoc(doc(ctx.firestore(), 'colleges', COLLEGE_A, 'feePayments', 'fp1'), { paidAmount: 1 }))
    }
    await assertFails(getDoc(doc(accountsB().firestore(), 'colleges', COLLEGE_A, 'feePayments', 'fp1')))
  })

  it('operations may post an unpaid library fine to a fee account, nothing else', async () => {
    const db = operations().firestore()
    await assertSucceeds(setDoc(doc(db, 'colleges', COLLEGE_A, 'feePayments', 'lib1'), {
      studentId: STUDENT_ID, amount: 30, paidAmount: 0, category: 'library', collegeId: COLLEGE_A,
    }))
    await assertFails(setDoc(doc(db, 'colleges', COLLEGE_A, 'feePayments', 'lib2'), {
      studentId: STUDENT_ID, amount: 30, paidAmount: 0, category: 'tuition', collegeId: COLLEGE_A,
    }))
    await assertFails(setDoc(doc(db, 'colleges', COLLEGE_A, 'feePayments', 'lib3'), {
      studentId: STUDENT_ID, amount: 30, paidAmount: 30, category: 'library', collegeId: COLLEGE_A,
    }))
  })

  it('finance settings: accounts owns payroll policy; principal may change non-payroll settings only', async () => {
    const accountFinance = doc(accounts().firestore(), 'colleges', COLLEGE_A, 'config', 'finance')
    const principalFinance = doc(principalContext().firestore(), 'colleges', COLLEGE_A, 'config', 'finance')
    await assertSucceeds(setDoc(accountFinance, { fees: { modes: ['cash'] }, payroll: { requireApproval: true } }))
    await assertSucceeds(updateDoc(principalFinance, { fees: { modes: ['cash', 'upi'] } }))
    await assertFails(updateDoc(principalFinance, { payroll: { requireApproval: false } }))
    await assertFails(setDoc(doc(hod().firestore(), 'colleges', COLLEGE_A, 'config', 'finance'), { x: 1 }))
    await assertFails(setDoc(doc(accounts().firestore(), 'colleges', COLLEGE_A, 'config', 'access'), { payrollRoles: ['accounts'] }))
    await assertSucceeds(setDoc(doc(principalContext().firestore(), 'colleges', COLLEGE_A, 'config', 'access'), { payrollRoles: ['accounts'] }))
    await assertSucceeds(setDoc(doc(operations().firestore(), 'colleges', COLLEGE_A, 'config', 'library'), { x: 1 }))
    await assertFails(setDoc(doc(accounts().firestore(), 'colleges', COLLEGE_A, 'config', 'library'), { x: 1 }))
    // borrowers can read the loan rules
    await assertSucceeds(getDoc(doc(studentContext().firestore(), 'colleges', COLLEGE_A, 'config', 'library')))
  })

  it('payroll: accounts prepares/processes while principal may only review submitted payslips', async () => {
    const path = ['colleges', COLLEGE_A, 'payslips', '2026-09_p1'] as const
    const principalRef = doc(principalContext().firestore(), ...path)
    const accountsRef = doc(accounts().firestore(), ...path)
    const structurePath = ['colleges', COLLEGE_A, 'salaryStructures', 'p1'] as const

    await assertSucceeds(getDoc(principalRef))
    await assertSucceeds(getDoc(accountsRef))
    await assertFails(getDoc(doc(facultyContext().firestore(), ...path)))
    await assertFails(getDoc(doc(hod().firestore(), ...path)))
    await assertFails(getDoc(doc(operations().firestore(), ...path)))

    const draftData = { month: '2026-09', facultyProfileId: 'p2', facultyUid: 'faculty-b', payslipNo: 'PS-202609-P2', status: 'draft', gross: 100, net: 100, history: [] }
    const accountDraftRef = doc(accounts().firestore(), 'colleges', COLLEGE_A, 'payslips', '2026-09_p2')
    const principalDraftRef = doc(principalContext().firestore(), 'colleges', COLLEGE_A, 'payslips', '2026-09_p2')
    await assertSucceeds(setDoc(accountDraftRef, draftData))
    await assertSucceeds(updateDoc(accountDraftRef, {
      status: 'pending_approval', submittedBy: 'Accounts', submittedByUid: 'accounts-a', submittedAt: Timestamp.now(),
    }))
    await assertSucceeds(updateDoc(principalDraftRef, {
      status: 'draft', reviewedBy: 'Principal', reviewedByUid: 'principal-a', reviewedAt: Timestamp.now(),
      reviewDecision: 'changes_requested', reviewNote: 'Please verify the LOP days.',
    }))
    await assertFails(getDoc(principalDraftRef))
    const principalPayslips = collection(principalContext().firestore(), 'colleges', COLLEGE_A, 'payslips')
    await assertFails(getDocs(query(principalPayslips, where('month', '==', '2026-09'))))
    await assertSucceeds(getDocs(query(principalPayslips, where('month', '==', '2026-09'), where('status', 'in', ['pending_approval', 'approved', 'paid']))))
    await assertSucceeds(updateDoc(accountDraftRef, { gross: 110 }))

    await assertSucceeds(getDoc(doc(accounts().firestore(), ...structurePath)))
    await assertFails(getDoc(doc(principalContext().firestore(), ...structurePath)))
    await assertSucceeds(updateDoc(doc(accounts().firestore(), ...structurePath), { basic: 1200 }))
    await assertFails(updateDoc(doc(principalContext().firestore(), ...structurePath), { basic: 2000 }))

    const accountCertificate = doc(accounts().firestore(), 'colleges', COLLEGE_A, 'salaryCertificates', 'cert1')
    const principalCertificate = doc(principalContext().firestore(), 'colleges', COLLEGE_A, 'salaryCertificates', 'cert1')
    await assertSucceeds(setDoc(accountCertificate, { facultyUid: 'faculty-a', certificateNo: 'CERT-1' }))
    await assertFails(getDoc(principalCertificate))
    await assertFails(setDoc(principalCertificate, { facultyUid: 'faculty-a', certificateNo: 'CERT-2' }))

    // Accounts cannot self-approve or process a payslip before approval.
    await assertFails(updateDoc(accountsRef, { status: 'approved', approvedBy: 'Accounts' }))
    await assertFails(updateDoc(accountsRef, { status: 'paid', paidOn: '2026-09-30', markedPaidBy: 'Accounts', markedPaidByUid: 'accounts-a' }))
    // Principal cannot alter the financial figures or jump directly to paid.
    await assertFails(updateDoc(principalRef, { status: 'approved', gross: 999999 }))
    await assertFails(updateDoc(principalRef, { status: 'paid', paidOn: '2026-09-30' }))
    await assertSucceeds(updateDoc(principalRef, {
      status: 'approved', reviewedBy: 'Principal', reviewedByUid: 'principal-a',
      reviewedAt: Timestamp.now(), reviewDecision: 'approved', reviewNote: '',
      approvedBy: 'Principal', approvedByUid: 'principal-a', approvedAt: Timestamp.now(),
    }))
    // Once approved, only accounts may record the bank payment.
    await assertSucceeds(updateDoc(accountsRef, {
      status: 'paid', paidOn: '2026-09-30', paymentRef: 'BANK-123',
      markedPaidBy: 'Accounts', markedPaidByUid: 'accounts-a',
    }))
    await assertFails(updateDoc(principalRef, { paymentRef: 'PRINCIPAL-EDIT' }))

    // Faculty still sees their own payslip.
    await assertSucceeds(getDoc(doc(facultyContext().firestore(), ...path)))
  })

  it('library: borrowers see only their own loans and may only request renewal', async () => {
    const st = studentContext().firestore()
    await assertSucceeds(getDoc(doc(st, 'colleges', COLLEGE_A, 'libraryTitles', 't1')))
    await assertSucceeds(getDoc(doc(st, 'colleges', COLLEGE_A, 'libraryLoans', 'l1')))
    await assertFails(getDoc(doc(st, 'colleges', COLLEGE_A, 'libraryLoans', 'l2')))
    await assertSucceeds(updateDoc(doc(st, 'colleges', COLLEGE_A, 'libraryLoans', 'l1'), { renewRequestedAt: '2026-09-25T10:00:00Z' }))
    await assertFails(updateDoc(doc(st, 'colleges', COLLEGE_A, 'libraryLoans', 'l1'), { dueDate: '2027-01-01' }))
    await assertFails(setDoc(doc(st, 'colleges', COLLEGE_A, 'libraryTitles', 't2'), { title: 'x' }))
    await assertSucceeds(updateDoc(doc(operations().firestore(), 'colleges', COLLEGE_A, 'libraryLoans', 'l1'), { dueDate: '2026-10-15' }))
    await assertFails(updateDoc(doc(accounts().firestore(), 'colleges', COLLEGE_A, 'libraryLoans', 'l1'), { dueDate: '2026-10-15' }))
    await assertFails(updateDoc(doc(hod().firestore(), 'colleges', COLLEGE_A, 'libraryLoans', 'l1'), { dueDate: '2026-10-15' }))
  })

  it('library fines: both offices work them, only finance may waive', async () => {
    const path = ['colleges', COLLEGE_A, 'libraryFines', 'f1'] as const
    await assertSucceeds(getDoc(doc(accounts().firestore(), ...path)))
    await assertSucceeds(getDoc(doc(operations().firestore(), ...path)))
    await assertSucceeds(getDoc(doc(studentContext().firestore(), ...path)))
    await assertSucceeds(updateDoc(doc(operations().firestore(), ...path), { status: 'collected' }))
    await assertFails(updateDoc(doc(operations().firestore(), ...path), { status: 'waived' }))
    await assertSucceeds(updateDoc(doc(accounts().firestore(), ...path), { status: 'waived' }))
  })

  it('reservations: a member reserves for themselves only', async () => {
    const st = studentContext().firestore()
    await assertSucceeds(setDoc(doc(st, 'colleges', COLLEGE_A, 'libraryReservations', 'r1'), { memberUid: STUDENT_UID, status: 'waiting', titleId: 't1' }))
    await assertFails(setDoc(doc(st, 'colleges', COLLEGE_A, 'libraryReservations', 'r2'), { memberUid: OTHER_UID, status: 'waiting', titleId: 't1' }))
    await assertFails(setDoc(doc(st, 'colleges', COLLEGE_A, 'libraryReservations', 'r3'), { memberUid: STUDENT_UID, status: 'ready', titleId: 't1' }))
  })

  it('office roles read the student directory but not academic records', async () => {
    await assertSucceeds(getDocs(query(collection(accounts().firestore(), 'students'), where('collegeId', '==', COLLEGE_A))))
    await assertSucceeds(getDocs(query(collection(operations().firestore(), 'students'), where('collegeId', '==', COLLEGE_A))))
    await assertFails(getDocs(query(collection(accounts().firestore(), 'students'), where('collegeId', '==', COLLEGE_B))))
  })

  it('procurement: HOD raises a request in their own name; vendor bills are finance-owned', async () => {
    const h = hod().firestore()
    await assertSucceeds(setDoc(doc(h, 'colleges', COLLEGE_A, 'purchaseRequests', 'pr1'), {
      status: 'submitted', requestedBy: { uid: 'hod-a', name: 'HOD' }, items: [],
    }))
    await assertFails(setDoc(doc(h, 'colleges', COLLEGE_A, 'purchaseRequests', 'pr2'), {
      status: 'submitted', requestedBy: { uid: 'someone-else', name: 'X' }, items: [],
    }))
    await assertFails(setDoc(doc(h, 'colleges', COLLEGE_A, 'vendorBills', 'vb1'), { amount: 10 }))
    await assertSucceeds(setDoc(doc(operations().firestore(), 'colleges', COLLEGE_A, 'vendorBills', 'vb1'), { amount: 10, status: 'pending' }))
    await assertFails(updateDoc(doc(operations().firestore(), 'colleges', COLLEGE_A, 'vendorBills', 'vb1'), { status: 'paid' }))
    await assertSucceeds(updateDoc(doc(accounts().firestore(), 'colleges', COLLEGE_A, 'vendorBills', 'vb1'), { status: 'paid' }))
    await assertFails(setDoc(doc(operations().firestore(), 'colleges', COLLEGE_A, 'officeStaff', 'x'), { role: 'accounts' }))
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// College course assignment and learner-progress tenancy
// ═══════════════════════════════════════════════════════════════════════════
describe('course assignments and course progress', () => {
  const studentBContext = () => testEnv.authenticatedContext('student-auth-c', {
    role: 'student', collegeId: COLLEGE_B,
  })

  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore()
      await Promise.all([
        setDoc(doc(db, 'colleges', COLLEGE_A, 'config', 'courses'), {
          assignments: {
            'genai-certification': {
              enabled: true,
              assignedAt: '2026-09-26T10:00:00.000Z',
              assignedBy: 'admin-a',
            },
          },
          updatedAt: '2026-09-26T10:00:00.000Z',
          updatedBy: 'admin-a',
        }),
        setDoc(doc(db, 'colleges', COLLEGE_B, 'config', 'courses'), { assignments: {} }),
        setDoc(doc(db, 'colleges', COLLEGE_A, 'courseProgress', `${STUDENT_UID}__genai-certification`), {
          uid: STUDENT_UID,
          collegeId: COLLEGE_A,
          courseId: 'genai-certification',
          courseVersion: '1.0.0',
          completed: { 'm1-t1': '2026-09-26T10:00:00.000Z' },
          quiz: {},
          percent: 2,
          completedCount: 1,
          quizAverage: null,
        }),
        setDoc(doc(db, 'colleges', COLLEGE_A, 'courseProgress', `${OTHER_UID}__genai-certification`), {
          uid: OTHER_UID,
          collegeId: COLLEGE_A,
          courseId: 'genai-certification',
          courseVersion: '1.0.0',
          completed: {},
          quiz: {},
          percent: 0,
          completedCount: 0,
          quizAverage: null,
        }),
        setDoc(doc(db, 'colleges', COLLEGE_B, 'courseProgress', `student-auth-c__genai-certification`), {
          uid: 'student-auth-c',
          collegeId: COLLEGE_B,
          courseId: 'genai-certification',
          courseVersion: '1.0.0',
          completed: {},
          quiz: {},
          percent: 0,
          completedCount: 0,
          quizAverage: null,
        }),
      ])
    })
  })

  it('students can read only their college Coding Lab assignment and only superadmin can change it', async () => {
    const studentDb = studentContext().firestore()
    const adminDb = adminContext().firestore()
    const superadminDb = superadminContext().firestore()
    const assignmentPath = (db: any, college: string) =>
      doc(db, 'colleges', college, 'config', 'codingLab')

    await assertSucceeds(getDoc(assignmentPath(studentDb, COLLEGE_A)))
    await assertFails(getDoc(assignmentPath(studentDb, COLLEGE_B)))
    await assertFails(getDoc(assignmentPath(facultyContext().firestore(), COLLEGE_A)))
    await assertFails(setDoc(assignmentPath(studentDb, COLLEGE_A), { enabled: true }))
    await assertFails(setDoc(assignmentPath(adminDb, COLLEGE_A), { enabled: true }))
    await assertSucceeds(setDoc(assignmentPath(superadminDb, COLLEGE_A), { enabled: true }))
  })

  it('college module toggles are readable by the college and writable only by its managers', async () => {
    // config/modules gates optional product modules (Assignments, ...).
    // Students need the read so navigation can hide a switched-off module;
    // unlike codingLab, staff of the college also read it, and the college's
    // own admin/hod/principal may write it (superadmin anywhere).
    const modulesPath = (db: any, college: string) =>
      doc(db, 'colleges', college, 'config', 'modules')
    const payload = { assignments: { enabled: false } }

    const studentDb = studentContext().firestore()
    await assertSucceeds(getDoc(modulesPath(studentDb, COLLEGE_A)))
    await assertFails(getDoc(modulesPath(studentDb, COLLEGE_B)))
    await assertFails(setDoc(modulesPath(studentDb, COLLEGE_A), payload))

    await assertSucceeds(getDoc(modulesPath(facultyContext().firestore(), COLLEGE_A)))
    await assertFails(setDoc(modulesPath(facultyContext().firestore(), COLLEGE_A), payload))

    await assertSucceeds(setDoc(modulesPath(adminContext().firestore(), COLLEGE_A), payload))
    await assertSucceeds(setDoc(modulesPath(principalContext().firestore(), COLLEGE_A), payload))
    await assertSucceeds(setDoc(modulesPath(hodContext().firestore(), COLLEGE_A), payload))
    await assertFails(setDoc(modulesPath(adminContext().firestore(), COLLEGE_B), payload))

    await assertSucceeds(setDoc(modulesPath(superadminContext().firestore(), COLLEGE_B), payload))
  })

  it('company-prep switch is readable by the college; only the platform superadmin writes it', async () => {
    // config/prep gates the Placement Prep nav entry for students and feeds
    // the /prep catalogue filter. Reads: the college's own students (nav
    // gating) and staff. Writes: superadmin only — company prep visibility is
    // a platform control, mirroring courses/codingLab.
    const prepPath = (db: any, college: string) =>
      doc(db, 'colleges', college, 'config', 'prep')
    const payload = { companyPrep: { enabled: false, hiddenCompanies: ['tcs-nqt'] } }

    const studentDb = studentContext().firestore()
    await assertSucceeds(getDoc(prepPath(studentDb, COLLEGE_A)))
    await assertFails(getDoc(prepPath(studentDb, COLLEGE_B)))
    await assertFails(setDoc(prepPath(studentDb, COLLEGE_A), payload))

    await assertSucceeds(getDoc(prepPath(facultyContext().firestore(), COLLEGE_A)))
    await assertFails(setDoc(prepPath(facultyContext().firestore(), COLLEGE_A), payload))
    await assertFails(setDoc(prepPath(adminContext().firestore(), COLLEGE_A), payload))
    await assertFails(setDoc(prepPath(principalContext().firestore(), COLLEGE_A), payload))

    await assertSucceeds(setDoc(prepPath(superadminContext().firestore(), COLLEGE_A), payload))
  })

  it('students and college course managers can access only their college assignment settings', async () => {
    const studentDb = studentContext().firestore()
    const adminDb = adminContext().firestore()
    const assignmentPath = (db: any, college: string) =>
      doc(db, 'colleges', college, 'config', 'courses')
    await assertSucceeds(getDoc(assignmentPath(studentDb, COLLEGE_A)))
    await assertFails(getDoc(assignmentPath(studentDb, COLLEGE_B)))
    // The courses carve-out opens specific docs only — an unrelated config
    // doc (finance policy) stays closed to students.
    await assertFails(getDoc(doc(studentDb, 'colleges', COLLEGE_A, 'config', 'finance')))
    await assertSucceeds(getDoc(assignmentPath(adminDb, COLLEGE_A)))
    await assertFails(getDoc(assignmentPath(adminDb, COLLEGE_B)))

    // Course assignments are platform curriculum control: college staff keep
    // READ access (their learners' course list resolves from this doc) but the
    // writes are superadmin-only, so a principal cannot switch course packs on
    // or off for their own college.
    const payload = {
      assignments: { 'genai-certification': { enabled: false } },
      updatedAt: '2026-09-26T11:00:00.000Z',
      updatedBy: 'admin-a',
    }
    await assertFails(setDoc(assignmentPath(adminDb, COLLEGE_A), payload))
    await assertFails(setDoc(assignmentPath(principalContext().firestore(), COLLEGE_A), payload))
    await assertFails(setDoc(assignmentPath(hodContext().firestore(), COLLEGE_A), payload))
    await assertFails(getDoc(assignmentPath(facultyContext().firestore(), COLLEGE_A)))
    await assertFails(setDoc(assignmentPath(facultyContext().firestore(), COLLEGE_A), payload))
    await assertFails(setDoc(assignmentPath(adminContext().firestore(), COLLEGE_B), { assignments: {} }))
    await assertSucceeds(setDoc(assignmentPath(superadminContext().firestore(), COLLEGE_B), { assignments: {} }))
  })

  it('a student reads and writes only their own progress record in their college', async () => {
    const db = studentContext().firestore()
    const own = doc(db, 'colleges', COLLEGE_A, 'courseProgress', `${STUDENT_UID}__genai-certification`)
    await assertSucceeds(getDoc(own))
    await assertFails(getDoc(doc(db, 'colleges', COLLEGE_A, 'courseProgress', `${OTHER_UID}__genai-certification`)))
    await assertFails(getDoc(doc(db, 'colleges', COLLEGE_B, 'courseProgress', 'student-auth-c__genai-certification')))

    await assertSucceeds(updateDoc(own, {
      completed: { 'm1-t1': '2026-09-26T11:00:00.000Z', 'm1-t2': '2026-09-26T11:01:00.000Z' },
      percent: 5,
      completedCount: 2,
      updatedAt: '2026-09-26T11:01:00.000Z',
    }))
    await assertSucceeds(setDoc(doc(db, 'colleges', COLLEGE_A, 'courseProgress', `${STUDENT_UID}__another-course`), {
      uid: STUDENT_UID,
      collegeId: COLLEGE_A,
      courseId: 'another-course',
      completed: {},
      quiz: {},
      percent: 0,
      completedCount: 0,
    }))
    await assertFails(setDoc(doc(db, 'colleges', COLLEGE_A, 'courseProgress', 'forged-owner'), {
      uid: OTHER_UID,
      collegeId: COLLEGE_A,
      courseId: 'genai-certification',
      completed: {},
      quiz: {},
    }))
    await assertFails(setDoc(doc(db, 'colleges', COLLEGE_A, 'courseProgress', `${STUDENT_UID}__wrong-id`), {
      uid: STUDENT_UID,
      collegeId: COLLEGE_A,
      courseId: 'genai-certification',
      completed: {},
      quiz: {},
    }))
    await assertFails(setDoc(doc(db, 'colleges', COLLEGE_B, 'courseProgress', `${STUDENT_UID}__genai-certification`), {
      uid: STUDENT_UID,
      collegeId: COLLEGE_B,
      courseId: 'genai-certification',
      completed: {},
      quiz: {},
    }))
  })

  it('college staff can report only within their college; students cannot list another learner', async () => {
    const staff = adminContext().firestore()
    await assertSucceeds(getDoc(doc(staff, 'colleges', COLLEGE_A, 'courseProgress', `${STUDENT_UID}__genai-certification`)))
    const report = await assertSucceeds(getDocs(collection(staff, 'colleges', COLLEGE_A, 'courseProgress')))
    assert.equal(report.size, 2)
    const faculty = facultyContext().firestore()
    await assertFails(getDoc(doc(faculty, 'colleges', COLLEGE_A, 'courseProgress', `${STUDENT_UID}__genai-certification`)))
    await assertFails(getDocs(collection(faculty, 'colleges', COLLEGE_A, 'courseProgress')))
    await assertFails(getDocs(collection(staff, 'colleges', COLLEGE_B, 'courseProgress')))
    await assertFails(getDocs(collection(studentContext().firestore(), 'colleges', COLLEGE_A, 'courseProgress')))

    const studentB = studentBContext().firestore()
    const ownRows = await assertSucceeds(getDocs(query(
      collection(studentB, 'colleges', COLLEGE_B, 'courseProgress'),
      where('uid', '==', 'student-auth-c'),
    )))
    assert.equal(ownRows.size, 1)
    await assertFails(getDocs(query(
      collection(studentB, 'colleges', COLLEGE_B, 'courseProgress'),
      where('uid', '==', STUDENT_UID),
    )))
  })
})

// ─── Vriddhi platform employees ─────────────────────────────────────────────
//
// `employee` is a platform-wide role, but it is scoped to ONE college at a time
// by the collegeId claim (the active college). The claim is what every
// college-scoped rule compares against, so these tests pin the boundary: work
// freely inside the active college, nothing outside it, and nothing at all when
// the assignment is suspended — even if a stale college claim is still present.
describe('vriddhi platform employees (employee role)', () => {
  const EMPLOYEE_UID = 'employee-a'

  function activeEmployee() {
    return testEnv
      .authenticatedContext(EMPLOYEE_UID, {
        role: 'employee',
        collegeId: COLLEGE_A,
        employeeStatus: 'active',
      })
      .firestore()
  }

  function suspendedEmployeeWithStaleClaim() {
    return testEnv
      .authenticatedContext(EMPLOYEE_UID, {
        role: 'employee',
        collegeId: COLLEGE_A,
        employeeStatus: 'suspended',
      })
      .firestore()
  }

  function availability(collegeId: string) {
    return {
      collegeId,
      facultyId: EMPLOYEE_UID,
      slots: [{ day: 'monday', startTime: '09:00', endTime: '10:00' }],
    }
  }

  it('works inside the active college like college staff', async () => {
    const db = activeEmployee()
    await assertSucceeds(getDoc(doc(db, 'colleges', COLLEGE_A)))
    await assertSucceeds(setDoc(doc(db, 'colleges', COLLEGE_A, 'facultyAvailability', EMPLOYEE_UID), availability(COLLEGE_A)))
    // Own faculty row (faculty-mode profile / settings / availability).
    await assertSucceeds(setDoc(doc(db, 'faculty', EMPLOYEE_UID), {
      uid: EMPLOYEE_UID,
      email: 'employee-a@vriddhi.example',
      name: 'Employee A',
      collegeId: COLLEGE_A,
    }))
  })

  it('is refused in any college that is not the active claim', async () => {
    const db = activeEmployee()
    await assertFails(getDoc(doc(db, 'colleges', COLLEGE_B)))
    await assertFails(setDoc(doc(db, 'colleges', COLLEGE_B, 'facultyAvailability', EMPLOYEE_UID), availability(COLLEGE_B)))
    await assertFails(setDoc(doc(db, 'faculty', EMPLOYEE_UID), {
      uid: EMPLOYEE_UID,
      collegeId: COLLEGE_B,
    }))
  })

  it('loses every staff grant while suspended, even with a stale college claim', async () => {
    const db = suspendedEmployeeWithStaleClaim()
    // Staff-gated reads and writes are refused.
    await assertFails(getDoc(doc(db, 'users', 'faculty-a')))
    await assertFails(getDoc(doc(db, 'faculty', 'legacy-faculty-a')))
    await assertFails(setDoc(doc(db, 'colleges', COLLEGE_A, 'facultyAvailability', EMPLOYEE_UID), availability(COLLEGE_A)))
  })

  it('keeps the assignment document server-written and self-readable', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'platform_employees', EMPLOYEE_UID), {
        uid: EMPLOYEE_UID,
        email: 'employee-a@vriddhi.example',
        name: 'Employee A',
        status: 'active',
        assignedCollegeIds: [COLLEGE_A],
        assignedColleges: [{ id: COLLEGE_A, name: 'College A', code: 'CA' }],
        grants: ['schedule', 'curriculum'],
        activeCollegeId: COLLEGE_A,
      })
    })
    const db = activeEmployee()
    await assertSucceeds(getDoc(doc(db, 'platform_employees', EMPLOYEE_UID)))
    // A compromised session must not be able to widen its own assignment.
    await assertFails(updateDoc(doc(db, 'platform_employees', EMPLOYEE_UID), {
      assignedCollegeIds: [COLLEGE_A, COLLEGE_B],
    }))
    const otherEmployee = testEnv
      .authenticatedContext('employee-b', { role: 'employee', collegeId: COLLEGE_A, employeeStatus: 'active' })
      .firestore()
    await assertFails(getDoc(doc(otherEmployee, 'platform_employees', EMPLOYEE_UID)))
  })
})
