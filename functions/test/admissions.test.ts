import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DEFAULT_INTAKE_DEFAULTS,
  DEFAULT_MERIT_WEIGHTS,
  MAPPABLE_FIELDS,
  STUDENT_CSV_COLUMNS,
  allowedTransitions,
  buildAppsScriptSnippet,
  canTransition,
  coerceApplicantNumbers,
  computeMeritScore,
  generateIngestToken,
  hashToken,
  intakeDocumentId,
  mapFormAnswers,
  toCsv,
  toStudentCsvRow,
} from '../src/admissions'

// The Admission Center decides who gets an offer and what lands in the student
// CSV, so both the stage machine and the merit maths are pinned here.

describe('admission stage machine', () => {
  it('walks the pipeline one stage at a time', () => {
    assert.equal(canTransition('enquiry', 'application'), true)
    assert.equal(canTransition('application', 'screening'), true)
    assert.equal(canTransition('screening', 'offer'), true)
    assert.equal(canTransition('offer', 'fee'), true)
    assert.equal(canTransition('fee', 'enrolled'), true)
  })

  it('refuses to skip the funnel', () => {
    // An applicant must not reach enrolled without an offer and a fee — that is
    // exactly what the CSV export trusts.
    assert.equal(canTransition('enquiry', 'enrolled'), false)
    assert.equal(canTransition('enquiry', 'offer'), false)
    assert.equal(canTransition('application', 'enrolled'), false)
    assert.equal(canTransition('application', 'fee'), false)
    assert.equal(canTransition('screening', 'enrolled'), false)
  })

  it('never moves backwards through the pipeline', () => {
    assert.equal(canTransition('enrolled', 'fee'), false)
    assert.equal(canTransition('offer', 'screening'), false)
    assert.equal(canTransition('fee', 'offer'), false)
  })

  it('lets any pre-enrolment stage be rejected or withdrawn', () => {
    for (const from of ['enquiry', 'application', 'screening', 'offer'] as const) {
      assert.equal(canTransition(from, 'rejected'), true, `${from} -> rejected`)
      assert.equal(canTransition(from, 'withdrawn'), true, `${from} -> withdrawn`)
    }
    assert.equal(canTransition('fee', 'rejected'), false, 'fee is past the decision point')
    assert.equal(canTransition('fee', 'withdrawn'), true)
  })

  it('treats enrolled as terminal', () => {
    assert.deepEqual(allowedTransitions('enrolled'), [])
  })

  it('allows a rejected applicant to reapply, keeping the audit trail', () => {
    assert.equal(canTransition('rejected', 'application'), true)
    assert.equal(canTransition('withdrawn', 'enquiry'), true)
    // But not straight back into the funnel past application.
    assert.equal(canTransition('rejected', 'offer'), false)
  })
})

describe('merit score', () => {
  it('weights the components by the configured policy', () => {
    // qualifying 80 × 50%, entrance (120/200 = 60) × 40%, interview (8 → 80) × 10%
    // = (80×50 + 60×40 + 80×10) / 100 = (4000 + 2400 + 800) / 100 = 72
    const result = computeMeritScore(
      { qualifyingPercentage: 80, entranceScore: 120, entranceMaxScore: 200, interviewRating: 8 },
      DEFAULT_MERIT_WEIGHTS
    )
    assert.equal(result.score, 72)
    assert.deepEqual(result.missing, [])
  })

  it('normalises entrance scores so different exams stay comparable', () => {
    const result = computeMeritScore(
      { qualifyingPercentage: null, entranceScore: 450, entranceMaxScore: 600, interviewRating: null },
      DEFAULT_MERIT_WEIGHTS
    )
    // 450/600 = 75, and it is the only component so it carries the whole score.
    assert.equal(result.score, 75)
  })

  it('excludes a missing component and re-normalises instead of scoring it zero', () => {
    // With no entrance exam recorded, qualifying (50) and interview (10) carry
    // the weight: (80×50 + 80×10) / 60 = 80. Treating the exam as zero would
    // have produced 56 and ranked the applicant last for unfiled paperwork.
    const result = computeMeritScore(
      { qualifyingPercentage: 80, entranceScore: null, entranceMaxScore: null, interviewRating: 8 },
      DEFAULT_MERIT_WEIGHTS
    )
    assert.equal(result.score, 80)
    assert.deepEqual(result.missing, ['Entrance exam'])
    assert.equal(result.components.length, 2)
    // Re-normalised shares must still total 100%.
    assert.equal(
      Math.round(result.components.reduce((sum, c) => sum + c.weight, 0)),
      100
    )
  })

  it('returns null rather than 0 when nothing has been recorded', () => {
    const result = computeMeritScore(
      { qualifyingPercentage: null, entranceScore: null, entranceMaxScore: null, interviewRating: null },
      DEFAULT_MERIT_WEIGHTS
    )
    assert.equal(result.score, null)
    assert.deepEqual(result.components, [])
    assert.equal(result.missing.length, 3)
  })

  it('ignores an entrance score with no maximum, since it cannot be normalised', () => {
    const result = computeMeritScore(
      { qualifyingPercentage: 90, entranceScore: 150, entranceMaxScore: null, interviewRating: null },
      DEFAULT_MERIT_WEIGHTS
    )
    // Only qualifying was recorded, so it carries the whole score on its own.
    assert.equal(result.score, 90)
    // Both the entrance exam and the interview are absent here, so both are
    // reported as unscored rather than silently folded in as zero.
    assert.deepEqual(result.missing, ['Entrance exam', 'Interview'])
  })

  it('rejects a zero or negative maximum score', () => {
    const result = computeMeritScore(
      { qualifyingPercentage: null, entranceScore: 100, entranceMaxScore: 0, interviewRating: null },
      DEFAULT_MERIT_WEIGHTS
    )
    assert.equal(result.score, null)
  })

  it('clamps out-of-range inputs instead of producing a score above 100', () => {
    const result = computeMeritScore(
      { qualifyingPercentage: 140, entranceScore: null, entranceMaxScore: null, interviewRating: 25 },
      DEFAULT_MERIT_WEIGHTS
    )
    assert.ok((result.score as number) <= 100, `expected <= 100, got ${result.score}`)
  })

  it('reports the weight a college actually configured', () => {
    const result = computeMeritScore(
      { qualifyingPercentage: 70, entranceScore: null, entranceMaxScore: null, interviewRating: null },
      { qualifying: 100, entrance: 0, interview: 0 }
    )
    assert.equal(result.score, 70)
    // Zero-weight components are not "missing" — the college chose not to use them.
    assert.deepEqual(result.missing, [])
  })
})

describe('student CSV hand-off', () => {
  const complete = {
    applicationNo: 'ADM-2026-0001',
    applicantName: 'Asha Verma',
    email: 'asha@example.com',
    phone: '+919876543210',
    dateOfBirth: '2007-03-15',
    gender: 'Female',
    bloodGroup: 'B+',
    program: 'B.Com',
    department: 'Commerce',
    batch: '2026',
    division: 'A',
    regNo: 'R2026001',
    mentorId: 'FAC001',
  }

  it('maps a complete applicant onto the student template columns', () => {
    const { row, blocked } = toStudentCsvRow(complete)
    assert.deepEqual(blocked, [])
    assert.ok(row)
    assert.equal(row!.regNo, 'R2026001')
    assert.equal(row!.course, 'B.Com')
    assert.equal(row!.department, 'Commerce')
    assert.equal(row!.division, 'A')
    // A fresh admission always starts in semester 1.
    assert.equal(row!.semester, '1')
    // The bulk-upload template validates gender as a lowercase select.
    assert.equal(row!.gender, 'female')
  })

  it('blocks an applicant with no registration number rather than inventing one', () => {
    const { row, blocked } = toStudentCsvRow({ ...complete, regNo: '' })
    assert.equal(row, null)
    assert.equal(blocked.length, 1)
    assert.match(blocked[0], /no registration number/)
  })

  it('blocks an applicant with no division assigned', () => {
    const { row, blocked } = toStudentCsvRow({ ...complete, division: '' })
    assert.equal(row, null)
    assert.match(blocked[0], /no division/)
  })

  it('reports every missing field at once, not one per round trip', () => {
    const { row, blocked } = toStudentCsvRow({ applicationNo: 'ADM-2026-0002' })
    assert.equal(row, null)
    assert.equal(blocked.length, 7)
    assert.ok(blocked.every((reason) => reason.startsWith('ADM-2026-0002')))
  })

  it('emits exactly the columns the bulk-upload template expects, in order', () => {
    const { row } = toStudentCsvRow(complete)
    const csv = toCsv([row!])
    const header = csv.split('\n')[0].split(',')
    assert.deepEqual(header, [...STUDENT_CSV_COLUMNS])
    assert.deepEqual(header, [
      'regNo', 'name', 'email', 'phone', 'dateOfBirth', 'gender', 'bloodGroup',
      'course', 'department', 'batch', 'semester', 'division', 'mentorId',
    ])
  })
})

describe('CSV escaping', () => {
  it('quotes values containing commas, quotes and newlines (RFC 4180)', () => {
    const csv = toCsv([
      {
        regNo: 'R1',
        name: 'Verma, Asha "Ash"',
        email: 'a@b.com',
        phone: '1',
        dateOfBirth: '',
        gender: '',
        bloodGroup: '',
        course: 'B.Com',
        department: 'Line1\nLine2',
        batch: '2026',
        semester: '1',
        division: 'A',
        mentorId: '',
      },
    ])
    const body = csv.split('\n').slice(1).join('\n')
    assert.ok(body.includes('"Verma, Asha ""Ash"""'), body)
    assert.ok(body.includes('"Line1\nLine2"'), body)
  })

  it('produces a header-only file when there are no rows', () => {
    const csv = toCsv([])
    assert.equal(csv.split('\n').length, 1)
  })
})

// ─── Google Form intake ─────────────────────────────────────────────────────

const FORM_DEFAULTS = { ...DEFAULT_INTAKE_DEFAULTS, program: 'B.Tech CSE', batch: '2026' }

describe('form answer mapping', () => {
  it('matches question titles ignoring case and whitespace', () => {
    // A college retyping "Full  Name" on the form must not silently start
    // dropping every applicant name.
    const { applicant } = mapFormAnswers(
      { 'FULL   NAME ': 'Asha Verma', 'phone Number': '9876543210' },
      { applicantName: 'Full Name', phone: 'Phone Number' },
      FORM_DEFAULTS
    )
    assert.equal(applicant.applicantName, 'Asha Verma')
    assert.equal(applicant.phone, '9876543210')
  })

  it('joins array answers and skips blanks', () => {
    const { applicant } = mapFormAnswers(
      { Q1: ['B.Tech', 'CSE'], Q2: '   ' },
      { program: 'Q1', city: 'Q2' },
      FORM_DEFAULTS
    )
    assert.equal(applicant.program, 'B.Tech, CSE')
    // A blank answer is skipped, not stored as an empty string.
    assert.equal(applicant.city, undefined)
  })

  it('fills program, batch and department from the college defaults', () => {
    const { applicant } = mapFormAnswers(
      { 'Full name': 'Asha' },
      { applicantName: 'Full name' },
      { program: 'B.Tech CSE', batch: '2026', source: 'Google Form', department: 'Computer Science' }
    )
    assert.equal(applicant.program, 'B.Tech CSE')
    assert.equal(applicant.batch, '2026')
    assert.equal(applicant.department, 'Computer Science')
  })

  it('lets an explicit form answer override the default', () => {
    const { applicant } = mapFormAnswers(
      { 'Full name': 'Asha', 'Which program?': 'B.Tech ECE' },
      { applicantName: 'Full name', program: 'Which program?' },
      { program: 'B.Tech CSE', batch: '2026', source: 'Google Form', department: 'Computer Science' }
    )
    assert.equal(applicant.program, 'B.Tech ECE')
  })

  it('reports unmapped questions instead of guessing', () => {
    const { applicant, unmappedQuestions } = mapFormAnswers(
      { 'Full name': 'Asha', 'Favourite colour': 'Teal' },
      { applicantName: 'Full name' },
      FORM_DEFAULTS
    )
    assert.deepEqual(unmappedQuestions, ['Favourite colour'])
    assert.equal(applicant.applicantName, 'Asha')
  })

  it('forces the configured source label over whatever the form says', () => {
    const { applicant } = mapFormAnswers(
      { Name: 'Asha', Src: 'Walk-in' },
      { applicantName: 'Name' },
      { ...FORM_DEFAULTS, source: 'Google Form' }
    )
    assert.equal(applicant.source, 'Google Form')
  })

  it('returns no applicant name when nothing maps to it', () => {
    const { applicant } = mapFormAnswers({ Junk: 'x' }, {}, FORM_DEFAULTS)
    assert.equal(String(applicant.applicantName || '').trim(), '')
  })

  it('exposes every mappable field', () => {
    assert.equal(MAPPABLE_FIELDS.length, 18)
    assert.ok(MAPPABLE_FIELDS.includes('applicantName'))
    assert.ok(MAPPABLE_FIELDS.includes('entranceMaxScore'))
  })
})

describe('numeric coercion', () => {
  it('parses scores with stray units and separators', () => {
    const applicant = coerceApplicantNumbers({
      qualifyingPercentage: '85%',
      entranceScore: '142 / 180',
      entranceMaxScore: '180',
    })
    assert.equal(applicant.qualifyingPercentage, 85)
    assert.equal(applicant.entranceScore, 142)
    assert.equal(applicant.entranceMaxScore, 180)
  })

  it('leaves unparseable values empty rather than inventing zero', () => {
    const applicant = coerceApplicantNumbers({
      qualifyingPercentage: 'awaiting results',
      entranceScore: '',
    })
    assert.equal(applicant.qualifyingPercentage, null)
    assert.equal(applicant.entranceScore, '')
  })

  it('keeps already-numeric values intact', () => {
    const applicant = coerceApplicantNumbers({ qualifyingPercentage: 92.5 })
    assert.equal(applicant.qualifyingPercentage, 92.5)
  })
})

describe('ingest tokens', () => {
  it('generates a distinct 32-character token each time', () => {
    const a = generateIngestToken()
    const b = generateIngestToken()
    assert.equal(a.length, 32)
    assert.notEqual(a, b)
  })

  it('stores only a hash, never the plaintext', () => {
    const token = generateIngestToken()
    const digest = hashToken(token)
    assert.equal(digest.length, 64)
    assert.equal(/^[0-9a-f]{64}$/.test(digest), true)
    assert.equal(digest.includes(token), false)
    assert.equal(hashToken(token), digest)
  })
})

describe('idempotent intake ids', () => {
  it('is stable for a re-delivered submission', () => {
    assert.equal(
      intakeDocumentId('college-1', 'resp-42'),
      intakeDocumentId('college-1', 'resp-42')
    )
  })

  it('differs per submission and per college', () => {
    assert.notEqual(intakeDocumentId('college-1', 'resp-42'), intakeDocumentId('college-1', 'resp-43'))
    assert.notEqual(intakeDocumentId('college-1', 'resp-42'), intakeDocumentId('college-2', 'resp-42'))
  })

  it('stays within Firestore document id limits', () => {
    const id = intakeDocumentId('college-1', 'resp-42')
    assert.equal(id.length, 40)
    assert.equal(/^[0-9a-f]+$/.test(id), true)
  })
})

describe('Apps Script snippet', () => {
  const script = buildAppsScriptSnippet(
    'https://asia-south1-vriddhi-engineering.cloudfunctions.net/api/admissions/ingest',
    'tok_123'
  )

  it('emits an on-form-submit handler that posts to the endpoint', () => {
    assert.ok(script.includes('function onFormSubmit('), 'missing onFormSubmit')
    assert.ok(script.includes('UrlFetchApp.fetch'), 'missing UrlFetchApp.fetch')
    assert.ok(
      script.includes('https://asia-south1-vriddhi-engineering.cloudfunctions.net/api/admissions/ingest'),
      'missing endpoint'
    )
    assert.ok(script.includes('tok_123'), 'missing token')
  })

  it('escapes single quotes so the script stays valid JS', () => {
    const escaped = buildAppsScriptSnippet("https://x/api/o'reilly/ingest", "to'ken")
    assert.equal(escaped.includes("o'reilly"), false)
    assert.equal(escaped.includes("to'ken"), false)
  })
})
