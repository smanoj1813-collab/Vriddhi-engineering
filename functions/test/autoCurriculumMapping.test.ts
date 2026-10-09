// functions/test/autoCurriculumMapping.test.ts
// ─── Auto curriculum ↔ faculty mapping — pure core ──────────────────────────
//
// The callables are thin: identity (resolveSchedulingStaff) + one read path +
// runAutoMapping. Everything the HOD will actually see — who teaches what,
// why, at what score — is decided here, so that is what this suite pins.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  AUTO_MAP_WEIGHTS,
  DEFAULT_CAPACITY_WEEKLY_HOURS,
  DEFAULT_SEMESTER_WEEKS,
  hoursPerWeek,
  normalizeText,
  runAutoMapping,
  branchCode,
  facultyTeachesBranch,
  significantTokens,
  subjectFitRatio,
  validateAutoMapPayload,
  type AutoMapCourse,
  type AutoMapFaculty,
  type AutoMapExistingMapping,
  type AutoMapOptions,
} from '../src/autoCurriculumMapping.ts'

// ─── Fixtures ────────────────────────────────────────────────────────────────

let facSeq = 0
function fac(over: Partial<AutoMapFaculty> = {}): AutoMapFaculty {
  facSeq += 1
  const uid = over.uid ?? `uid-${facSeq}`
  return {
    uid,
    profileId: over.profileId ?? `FAC${facSeq}`,
    name: over.name ?? `Dr. Teacher ${facSeq}`,
    email: over.email ?? `t${facSeq}@college.edu`,
    department: over.department ?? 'Commerce',
    branches: over.branches ?? ['B.Com'],
    specialization: over.specialization ?? '',
    subjectsUG: over.subjectsUG ?? [],
    subjectsPG: over.subjectsPG ?? [],
    experienceYears: over.experienceYears ?? 5,
  }
}

function course(over: Partial<AutoMapCourse> = {}): AutoMapCourse {
  return {
    id: over.id ?? over.code ?? 'c1',
    code: over.code ?? 'CS01',
    name: over.name ?? 'Sample Course',
    credits: over.credits ?? 3,
    totalHours: over.totalHours ?? 60,
    semester: over.semester ?? 4,
    branch: over.branch ?? 'B.Com',
    modulesCount: over.modulesCount ?? 4,
  }
}

function mapping(over: Partial<AutoMapExistingMapping> = {}): AutoMapExistingMapping {
  return {
    curriculumId: over.curriculumId ?? 'cur-1',
    courseId: over.courseId ?? 'cx',
    courseCode: over.courseCode ?? 'CA01',
    courseName: over.courseName ?? 'Cost Accounting',
    facultyId: over.facultyId ?? '',
    facultyEmail: over.facultyEmail ?? null,
    branch: over.branch ?? 'B.Com',
    semester: over.semester ?? 4,
    batch: over.batch ?? '2026',
    division: over.division ?? null,
    section: over.section ?? null,
    totalHours: over.totalHours ?? 300,
  }
}

function opts(over: Partial<AutoMapOptions> = {}): AutoMapOptions {
  return {
    curriculumId: over.curriculumId ?? 'cur-1',
    branch: over.branch ?? 'B.Com',
    batch: over.batch ?? '2026',
    division: over.division ?? null,
    section: over.section ?? null,
    capacity: over.capacity ?? DEFAULT_CAPACITY_WEEKLY_HOURS,
    semesterWeeks: over.semesterWeeks ?? DEFAULT_SEMESTER_WEEKS,
    courses: over.courses ?? [course()],
    faculty: over.faculty ?? [],
    existing: over.existing ?? [],
    teachingGroups: over.teachingGroups,
  }
}

// ─── Normalisation ───────────────────────────────────────────────────────────

describe('normalizeText / significantTokens', () => {
  it('folds punctuation, case and spacing', () => {
    assert.equal(normalizeText('  B.Com '), 'b com')
    assert.equal(normalizeText('FAC & IT'), 'fac and it')
  })

  it('drops stopwords, single letters and expands abbreviations', () => {
    assert.deepEqual(significantTokens('B.Com'), ['commerce'])
    assert.deepEqual(significantTokens('Department of Commerce'), ['department', 'commerce'])
  })

  it('strips roman-numeral year markers from course names', () => {
    assert.deepEqual(significantTokens('Financial Accounting I'), ['financial', 'accounting'])
  })
})

describe('subjectFitRatio', () => {
  it('scores exact and near-exact subject names at 1', () => {
    assert.equal(subjectFitRatio('Financial Accounting', 'Financial Accounting'), 1)
    // Course "Financial Accounting I" vs subject "Financial Accounting" — the
    // "I" is not a significant token, so a full match.
    assert.equal(subjectFitRatio('Financial Accounting I', 'Financial Accounting'), 1)
  })

  it('scores partial overlap proportionally', () => {
    const r = subjectFitRatio('Business Economics', 'Economics')
    assert.ok(r > 0 && r < 1, `expected partial ratio, got ${r}`)
  })

  it('scores disjoint subjects at 0', () => {
    assert.equal(subjectFitRatio('Financial Accounting', 'Marketing'), 0)
  })
})

describe('hoursPerWeek', () => {
  it('converts total course hours with the semester length', () => {
    assert.equal(hoursPerWeek({ totalHours: 60, credits: 3 }, 15), 4)
    assert.equal(hoursPerWeek({ totalHours: 45, credits: 3 }, 15), 3)
  })

  it('falls back to credits × 4 when totalHours is missing', () => {
    assert.equal(hoursPerWeek({ totalHours: null, credits: 3 }, 15), 12)
    assert.equal(hoursPerWeek({ totalHours: 0, credits: 0 }, 15), 1)
  })
})

// ─── Assignment behaviour ────────────────────────────────────────────────────

describe('runAutoMapping — fit drives the choice', () => {
  it('picks the faculty who lists the subject over one who does not', () => {
    const accounting = fac({ name: 'Dr. A', subjectsUG: ['Financial Accounting'] })
    const marketing = fac({ name: 'Dr. M', subjectsUG: ['Marketing'] })
    const result = runAutoMapping(
      opts({
        courses: [course({ code: 'FA01', name: 'Financial Accounting I' })],
        faculty: [marketing, accounting], // order must not matter
      }),
    )
    const p = result.proposals[0]
    assert.equal(p.status, 'proposed')
    assert.equal(p.faculty?.uid, accounting.uid)
    assert.ok(p.score > 80, `expected a high-confidence score, got ${p.score}`)
  })

  it('breaks ties toward the faculty teaching the branch', () => {
    const inBranch = fac({ name: 'Dr. In', branches: ['B.Com'], subjectsUG: ['Financial Accounting'] })
    const outBranch = fac({
      name: 'Dr. Out',
      branches: ['BCA'],
      department: 'BCA',
      subjectsUG: ['Financial Accounting'],
    })
    const result = runAutoMapping(
      opts({ courses: [course({ code: 'FA01', name: 'Financial Accounting' })], faculty: [inBranch, outBranch] }),
    )
    const p = result.proposals[0]
    assert.equal(p.faculty?.uid, inBranch.uid)
    assert.ok(p.breakdown.branch === AUTO_MAP_WEIGHTS.branch)
  })
})

describe('runAutoMapping — load balancing', () => {
  it('gives the next course to the less-loaded equally-qualified faculty', () => {
    const heavy = fac({ uid: 'heavy', name: 'Dr. Heavy', subjectsUG: ['Financial Accounting'] })
    const light = fac({ uid: 'light', name: 'Dr. Light', subjectsUG: ['Financial Accounting'] })
    const result = runAutoMapping(
      opts({
        courses: [course({ code: 'FA01', name: 'Financial Accounting' })],
        faculty: [heavy, light],
        // heavy already teaches 300h ≈ 20 weekly periods
        existing: [mapping({ facultyId: 'heavy', totalHours: 300 })],
      }),
    )
    const p = result.proposals[0]
    assert.equal(p.faculty?.uid, 'light')
    const heavyLoad = result.facultyLoad.find((f) => f.uid === 'heavy')
    const lightLoad = result.facultyLoad.find((f) => f.uid === 'light')
    assert.equal(heavyLoad?.currentWeeklyHours, 20)
    assert.equal(heavyLoad?.proposedWeeklyHours, 0)
    assert.equal(lightLoad?.proposedWeeklyHours, 4)
  })

  it('proposes the only available faculty but flags the overload', () => {
    const solo = fac({ uid: 'solo', subjectsUG: ['Financial Accounting'] })
    const result = runAutoMapping(
      opts({
        courses: [course({ code: 'FA01', name: 'Financial Accounting', totalHours: 60 })],
        faculty: [solo],
        existing: [mapping({ facultyId: 'solo', totalHours: 330 })], // 22/24
      }),
    )
    const p = result.proposals[0]
    assert.equal(p.status, 'proposed')
    assert.equal(p.faculty?.uid, 'solo')
    assert.ok(p.flags.includes('overload-risk'))
    assert.equal(result.facultyLoad.find((f) => f.uid === 'solo')?.totalWeeklyHours, 26)
    assert.equal(result.summary.overloadFlags, 1)
  })
})

describe('runAutoMapping — teaching-group load arithmetic', () => {
  const fiveDivisions = ['A', 'B', 'C', 'D', 'E'].map((division) => ({
    branch: 'B.Com', batch: '2026', semester: 4, division, section: '',
  }))

  it('multiplies an unscoped mapping by each enrolled group served', () => {
    const teacher = fac({ uid: 'teacher', subjectsUG: ['Financial Accounting'] })
    const result = runAutoMapping(opts({
      courses: [course({ code: 'FA01', name: 'Financial Accounting', totalHours: 60 })],
      faculty: [teacher],
      teachingGroups: fiveDivisions,
    }))
    const proposal = result.proposals[0]
    assert.equal(proposal.groupsServed, 5)
    assert.ok(proposal.reasons.some((reason) => /4 periods × 5 groups = 20 periods\/week/.test(reason)))
    assert.equal(result.facultyLoad[0].proposedWeeklyHours, 20)
  })

  it('counts an explicit A,B merged mapping once, not once per member division', () => {
    const teacher = fac({ uid: 'teacher', subjectsUG: ['Financial Accounting'] })
    const current = mapping({
      facultyId: 'teacher', courseCode: 'FA00', totalHours: 60, division: 'A,B', section: null,
    })
    const result = runAutoMapping(opts({
      courses: [course({ code: 'FA01', name: 'Financial Accounting', totalHours: 60 })],
      faculty: [teacher],
      existing: [current],
      teachingGroups: fiveDivisions,
      division: 'A,B',
    }))
    assert.equal(result.facultyLoad[0].currentWeeklyHours, 4)
    assert.equal(result.proposals[0].groupsServed, 1)
    assert.ok(result.proposals[0].reasons.some((reason) => /4 periods × 1 group = 4 periods\/week/.test(reason)))
  })

  it('explains overload arithmetic and how merging groups can restore capacity', () => {
    const teacher = fac({ uid: 'teacher', subjectsUG: ['Financial Accounting'] })
    const result = runAutoMapping(opts({
      courses: [course({ code: 'FA01', name: 'Financial Accounting', totalHours: 60 })],
      faculty: [teacher],
      existing: [mapping({
        facultyId: 'teacher', courseCode: 'FA00', totalHours: 60, division: '', section: '',
      })],
      teachingGroups: fiveDivisions,
      capacity: 24,
    }))
    const proposal = result.proposals[0]
    assert.ok(proposal.flags.includes('overload-risk'))
    assert.ok(proposal.reasons.some((reason) => /4 periods × 5 groups = 20 periods\/week \(20 \+ 20 = 40\/24\)/.test(reason)))
    assert.ok(proposal.reasons.some((reason) => /Merge A\+B\+C\+D\+E.*saves 16 periods\/week; projected 24\/24/.test(reason)))
  })
})

describe('runAutoMapping — constrained courses first', () => {
  it('protects the sole specialist even when a "common" course sorts earlier', () => {
    const specialist = fac({
      uid: 'a',
      name: 'Dr. A',
      subjectsUG: ['Vedic Mathematics', 'General Science'],
    })
    const generalist = fac({ uid: 'b', name: 'Dr. B', subjectsUG: ['General Science'] })
    const vedic = course({ code: 'ZZ01', name: 'Vedic Mathematics', totalHours: 60 }) // sorts LAST by code
    const science = course({ code: 'AA02', name: 'General Science', totalHours: 60 })
    const result = runAutoMapping(
      opts({
        courses: [science, vedic],
        faculty: [specialist, generalist],
        // B is already mapped to Vedic Mathematics in this batch, so A is the
        // SOLE candidate for that course — it must be assigned FIRST, even
        // though "AA02" sorts before "ZZ01" by code. A carries one other
        // 60h course, so once A takes Vedic (capacity 8, 4+4) only B can
        // still take General Science.
        existing: [
          mapping({
            facultyId: 'b',
            courseCode: 'ZZ01',
            courseId: vedic.id,
            courseName: vedic.name,
            totalHours: 60, // 4 weekly periods at 15 weeks
          }),
          mapping({ facultyId: 'a', courseCode: 'XX00', courseName: 'Other Course', totalHours: 60 }),
        ],
        capacity: 8,
      }),
    )
    const vedicP = result.proposals.find((p) => p.courseId === vedic.id)!
    const scienceP = result.proposals.find((p) => p.courseId === science.id)!
    assert.equal(vedicP.faculty?.uid, 'a', 'sole candidate must keep the specialist')
    assert.equal(scienceP.faculty?.uid, 'b', 'capacity forces the generalist onto the common course')
    assert.equal(result.summary.overloadFlags, 0)
  })
})

describe('runAutoMapping — dedupe & unassignable', () => {
  it('never double-maps a faculty to the same course in the same batch', () => {
    const a = fac({ uid: 'a', subjectsUG: ['Financial Accounting'] })
    const b = fac({ uid: 'b', subjectsUG: ['Financial Accounting'] })
    const result = runAutoMapping(
      opts({
        courses: [course({ code: 'CA01', name: 'Cost Accounting' })],
        faculty: [a, b],
        existing: [mapping({ facultyId: 'a', courseCode: 'CA01', courseName: 'Cost Accounting' })],
      }),
    )
    const p = result.proposals[0]
    assert.equal(p.status, 'proposed')
    assert.equal(p.faculty?.uid, 'b')
  })

  it('treats an academic-year range as the same batch when skipping the already-mapped', () => {
    // The mapping row says "2026-2027", the run is for "2027". Both are the
    // class of 2027, so `a` IS already mapped to this course — comparing the
    // raw strings dropped the row and applyAutoMapping wrote a DUPLICATE
    // mapping for the same class.
    // `a` would WIN this course if they were a candidate: full subject fit and
    // 20 years to `b`'s 5, with the existing row carrying no hours so load
    // cannot tip the balance. The only reason the run can propose `b` is that
    // `a` is already mapped to this course for this class — under the old
    // string comparison `a` was proposed again and applyAutoMapping wrote a
    // second, duplicate row for them.
    const a = fac({ uid: 'a', name: 'Dr. A', subjectsUG: ['Cost Accounting'], experienceYears: 20 })
    const b = fac({ uid: 'b', name: 'Dr. B', subjectsUG: ['Cost Accounting'] })
    const result = runAutoMapping(
      opts({
        batch: '2027',
        courses: [course({ code: 'CA01', name: 'Cost Accounting' })],
        faculty: [a, b],
        existing: [
          mapping({
            facultyId: 'a',
            courseCode: 'CA01',
            courseName: 'Cost Accounting',
            batch: '2026-27',
            totalHours: 0,
          }),
        ],
      }),
    )
    const p = result.proposals[0]
    assert.equal(p.status, 'proposed')
    assert.notEqual(p.faculty?.uid, 'a', 'an already-mapped faculty must not be re-proposed')
    assert.equal(p.faculty?.uid, 'b', 'a is already mapped to this course for the class of 2027')
  })

  it('does not treat a different batch as already mapped', () => {
    // Same course, same faculty, but batch 2026 is a DIFFERENT cohort — the
    // run is free to propose them here (the row blocks only its own class).
    const a = fac({ uid: 'a', subjectsUG: ['Financial Accounting'] })
    const result = runAutoMapping(
      opts({
        batch: '2027',
        courses: [course({ code: 'CA01', name: 'Cost Accounting' })],
        faculty: [a],
        existing: [mapping({ facultyId: 'a', courseCode: 'CA01', batch: '2026' })],
      }),
    )
    assert.equal(result.proposals[0].faculty?.uid, 'a')
  })

  it('leaves a course unassigned when every faculty is already mapped to it', () => {
    const a = fac({ uid: 'a', subjectsUG: ['Financial Accounting'] })
    const b = fac({ uid: 'b', subjectsUG: ['Financial Accounting'] })
    const result = runAutoMapping(
      opts({
        courses: [course({ code: 'CA01', name: 'Cost Accounting' })],
        faculty: [a, b],
        existing: [
          mapping({ facultyId: 'a', courseCode: 'CA01' }),
          mapping({ facultyId: 'b', courseCode: 'CA01' }),
        ],
      }),
    )
    assert.equal(result.proposals[0].status, 'unassigned')
    assert.equal(result.proposals[0].faculty, null)
    assert.equal(result.summary.unassigned, 1)
  })

  it('reports every course unassigned when the college has no active faculty', () => {
    const result = runAutoMapping(
      opts({
        courses: [course({ code: 'CA01' }), course({ code: 'CA02' })],
        faculty: [],
      }),
    )
    assert.equal(result.summary.unassigned, 2)
    assert.ok(result.proposals[0].reasons.some((r) => r.includes('No active faculty')))
  })

  it('flags proposals whose faculty has no matching subject', () => {
    const a = fac({ uid: 'a', subjectsUG: ['Accounting'] })
    const result = runAutoMapping(
      opts({ courses: [course({ code: 'OR01', name: 'Operations Research' })], faculty: [a] }),
    )
    const p = result.proposals[0]
    assert.equal(p.status, 'proposed')
    assert.ok(p.flags.includes('no-subject-match'))
    assert.ok(p.breakdown.subject < 15)
  })
})

describe('runAutoMapping — identity & determinism', () => {
  it('resolves legacy mappings keyed by email into the right faculty', () => {
    const a = fac({ uid: 'uid-a', email: 'a@college.edu', subjectsUG: ['Financial Accounting'] })
    const result = runAutoMapping(
      opts({
        courses: [course({ code: 'FA01', name: 'Financial Accounting' })],
        faculty: [a],
        existing: [
          mapping({
            facultyId: '',
            facultyEmail: 'A@COLLEGE.EDU', // case must not matter
            courseCode: 'FA01',
            courseName: 'Financial Accounting',
            totalHours: 300,
          }),
        ],
      }),
    )
    // Email-keyed existing row both loads the faculty AND blocks the course.
    assert.equal(result.facultyLoad.find((f) => f.uid === 'uid-a')?.currentWeeklyHours, 20)
    assert.equal(result.proposals[0].status, 'unassigned')
  })

  it('is deterministic — identical input yields identical output', () => {
    const options = opts({
      courses: [
        course({ code: 'A01', name: 'Financial Accounting' }),
        course({ code: 'A02', name: 'Cost Accounting' }),
        course({ code: 'A03', name: 'Business Law' }),
      ],
      faculty: [
        fac({ uid: 'a', subjectsUG: ['Financial Accounting', 'Cost Accounting'] }),
        fac({ uid: 'b', subjectsUG: ['Business Law'] }),
        fac({ uid: 'c', subjectsUG: ['Financial Accounting'] }),
      ],
      existing: [mapping({ facultyId: 'c' })],
    })
    const first = runAutoMapping(options)
    const second = runAutoMapping(options)
    assert.deepEqual(
      first.proposals.map((p) => [p.courseId, p.faculty?.uid, p.score]),
      second.proposals.map((p) => [p.courseId, p.faculty?.uid, p.score]),
    )
  })
})

// ─── Payload validation ──────────────────────────────────────────────────────

describe('validateAutoMapPayload', () => {
  it('requires curriculumId and batch', () => {
    assert.throws(() => validateAutoMapPayload({}, 'hod', 'c1'), (e: any) => e.code === 'invalid-argument')
    assert.throws(
      () => validateAutoMapPayload({ curriculumId: 'cur-1' }, 'hod', 'c1'),
      (e: any) => e.code === 'invalid-argument',
    )
  })

  it('pins non-superadmin callers to their own college claim', () => {
    const p = validateAutoMapPayload(
      { curriculumId: 'cur-1', batch: '2026', collegeId: 'intruder-college' },
      'hod',
      'c1',
    )
    assert.equal(p.collegeId, 'c1')
    assert.equal(p.batch, '2026')
    assert.equal(p.capacity, DEFAULT_CAPACITY_WEEKLY_HOURS)
    assert.equal(p.semesterWeeks, DEFAULT_SEMESTER_WEEKS)
    assert.deepEqual(p.courseIds, [])
  })

  it('lets a superadmin name the target college', () => {
    const p = validateAutoMapPayload(
      { curriculumId: 'cur-1', batch: '2026', collegeId: 'c2' },
      'superadmin',
      '',
    )
    assert.equal(p.collegeId, 'c2')
  })

  it('rejects out-of-range capacity and semester length', () => {
    assert.throws(
      () => validateAutoMapPayload({ curriculumId: 'c', batch: 'b', capacity: 0 }, 'admin', 'c1'),
      (e: any) => e.code === 'invalid-argument',
    )
    const p = validateAutoMapPayload(
      { curriculumId: 'c', batch: 'b', capacity: 20, semesterWeeks: 14 },
      'admin',
      'c1',
    )
    assert.equal(p.capacity, 20)
    assert.equal(p.semesterWeeks, 14)
  })
})


// ─── G5: Guest faculty lifecycle ─────────────────────────────────────────────

function guest(over: Partial<AutoMapFaculty> = {}, contract?: AutoMapFaculty['guestContract']): AutoMapFaculty {
  return { ...fac(over), employmentType: 'PART_TIME', guestContract: contract ?? { periodRate: 500 } }
}

describe('runAutoMapping — guest faculty (G5)', () => {
  it('prefers a credible full-time teacher over a better-scoring guest', () => {
    const result = runAutoMapping(opts({
      courses: [course({ code: 'FA01', name: 'Financial Accounting', totalHours: 60 })],
      faculty: [
        fac({ uid: 'ft', subjectsUG: ['Financial Accounting'], experienceYears: 2 }),
        // Guest has perfect match AND far more experience — still loses,
        // because a full-time candidate clears the subject-fit bar (≥15).
        guest({ uid: 'g1', subjectsUG: ['Financial Accounting'], experienceYears: 20 }),
      ],
    }))
    assert.equal(result.proposals[0].faculty?.uid, 'ft')
    assert.equal(result.summary.guestAssigned, 0)
  })

  it('reaches for a guest when no full-time candidate has a subject fit, and flags it', () => {
    const result = runAutoMapping(opts({
      courses: [course({ code: 'FA01', name: 'Financial Accounting', totalHours: 60 })],
      faculty: [
        fac({ uid: 'ft', subjectsUG: ['Sociology'] }),
        guest({ uid: 'g1', subjectsUG: ['Financial Accounting'], experienceYears: 12 }, { periodRate: 600 }),
      ],
    }))
    assert.equal(result.proposals[0].faculty?.uid, 'g1')
    assert.ok(result.proposals[0].flags.includes('guest-assigned'))
    assert.equal(result.summary.guestAssigned, 1)
    const guestLoad = result.facultyLoad.find((f) => f.uid === 'g1')
    assert.equal(guestLoad?.capacity, 12)
    assert.equal(guestLoad?.isGuest, true)
  })

  it('excludes guests whose contract has ended, but keeps them in load', () => {
    const result = runAutoMapping(opts({
      courses: [course({ code: 'CA01', name: 'Corporate Accounting', totalHours: 60 })],
      faculty: [
        guest({ uid: 'g-exp', subjectsUG: ['Corporate Accounting'] }, { endDate: '2020-06-30', periodRate: 500 }),
        fac({ uid: 'ft', subjectsUG: ['Corporate Accounting'] }),
      ],
      existing: [mapping({ courseId: 'ca-old', courseCode: 'CA01', facultyId: 'g-exp', totalHours: 60 })],
    }))
    assert.equal(result.proposals[0].faculty?.uid, 'ft') // expired guest never proposed
    assert.equal(result.summary.contractExpiredGuests, 1)
    const row = result.facultyLoad.find((f) => f.uid === 'g-exp')
    assert.ok(row && row.currentWeeklyHours > 0) // current teaching still counts
  })

  it('respects the smaller guest capacity before flagging overload', () => {
    const result = runAutoMapping(opts({
      courses: [
        course({ id: 'A1', code: 'A1', name: 'Advanced Accounting', totalHours: 90 }),
        course({ id: 'A2', code: 'A2', name: 'Auditing Practices', totalHours: 90 }),
        course({ id: 'A3', code: 'A3', name: 'Taxation Practices', totalHours: 90 }),
      ],
      faculty: [guest({ uid: 'g1', subjectsUG: ['Accounting', 'Auditing', 'Taxation'] })],
    }))
    const assigned = result.proposals.filter((p) => p.faculty?.uid === 'g1')
    // 6+6=12 guest periods fit; the third 90h course (6/wk) exceeds the cap.
    assert.ok(assigned.some((p) => p.flags.includes('overload-risk')))
    const guestLoad = result.facultyLoad.find((f) => f.uid === 'g1')
    assert.ok((guestLoad?.totalWeeklyHours ?? 0) >= 12)
  })
})

// ─── Strict branch gate ──────────────────────────────────────────────────────

describe('branch gate', () => {
  it('treats common spellings of a branch as the same code', () => {
    assert.equal(branchCode('CSE'), 'cse')
    assert.equal(branchCode('Computer Science & Engineering'), 'cse')
    assert.equal(branchCode('Dept. of Computer Science and Engineering'), 'cse')
    assert.equal(branchCode('Electronics and Communication Engineering'), 'ece')
    assert.equal(branchCode('EEE'), 'eee')
    assert.equal(branchCode('Civil Engineering'), 'civil')
  })

  it('falls back to department when a faculty has no branches', () => {
    assert.equal(facultyTeachesBranch({ branches: [], department: 'Computer Science' }, 'CSE'), true)
    assert.equal(facultyTeachesBranch({ branches: [], department: 'ECE' }, 'CSE'), false)
  })

  it('only proposes faculty of the curriculum branch', () => {
    const ece = fac({ branches: ['ECE'], department: 'ECE', subjectsUG: ['Engineering Mathematics'] })
    const cse = fac({ branches: ['CSE'], department: 'CSE' })
    const result = runAutoMapping(
      opts({
        branch: 'CSE',
        courses: [course({ code: 'BMAT101', name: 'Engineering Mathematics', branch: 'CSE' })],
        faculty: [ece, cse],
      }),
    )
    assert.equal(result.proposals[0].faculty?.uid, cse.uid)
  })

  it('leaves a course unassigned when the branch has no faculty', () => {
    const eee = fac({ branches: ['EEE'], department: 'EEE' })
    const result = runAutoMapping(
      opts({ branch: 'CSE', courses: [course({ branch: 'CSE' })], faculty: [eee] }),
    )
    const p = result.proposals[0]
    assert.equal(p.faculty, null)
    assert.match(p.reasons[0], /No CSE faculty/)
  })
})
