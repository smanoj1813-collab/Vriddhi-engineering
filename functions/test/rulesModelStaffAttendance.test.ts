import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

// Mechanical second pass over firestore.rules for the EXACT
// production request that is denied:
//   uid      WcScoYaMndh5yXHlFbUIrJTPtqx2
//   claims   { role: 'faculty', collegeId: 'PZIg0HN9vG2kMo4Sb0YM' }
//   op       create staffAttendance/PZIg0HN9vG2kMo4Sb0YM__WcScoYaMndh5yXHlFbUIrJTPtqx2__2026-09-17
//   payload  { collegeId: 'PZIg0HN9vG2kMo4Sb0YM', facultyId: '<uid>', ... }
//
// Every function below is a verbatim transcription of the rules file
// (lines 10-140 and 658-697 of firestore.rules), evaluated with
// that request's values. If this model says ALLOW, the rules file is not
// the problem and the denial must come from a different request/token
// than the one the audit shows.

const UID = 'WcScoYaMndh5yXHlFbUIrJTPtqx2'
const COLLEGE = 'PZIg0HN9vG2kMo4Sb0YM'

// ── rules: claim accessors ─────────────────────────────────────────────────
const token = { role: 'faculty', collegeId: COLLEGE }
const auth = { uid: UID, token }

function isSignedIn() {
  return auth !== null
}
function claimRole() {
  return isSignedIn() && 'role' in auth.token ? auth.token.role : null
}
function claimCollege() {
  return isSignedIn() && 'collegeId' in auth.token ? auth.token.collegeId : null
}

// ── rules: normalisation (verbatim) ────────────────────────────────────────
function cleanRoleValue(raw) {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : ''
}
function canonicalRole(value) {
  if (
    value === 'teacher' || value === 'teaching staff' || value === 'teaching-staff' ||
    value === 'teaching_staff' || value === 'lecturer' || value === 'professor' ||
    value === 'assistant professor' || value === 'associate professor' ||
    value === 'instructor' || value === 'faculty member' || value === 'faculty-member'
  ) return 'faculty'
  if (
    value === 'head of department' || value === 'head-of-department' ||
    value === 'head_of_department' || value === 'dept head' || value === 'department head'
  ) return 'hod'
  if (value === 'administrator' || value === 'admin staff' || value === 'college admin') return 'admin'
  if (
    value === 'super admin' || value === 'super-admin' || value === 'super_admin' ||
    value === 'superuser' || value === 'owner'
  ) return 'superadmin'
  if (value === 'vice principal' || value === 'vice-principal' || value === 'vice_principal') return 'principal'
  if (value === 'learner' || value === 'pupil') return 'student'
  if (value === 'guardian') return 'parent'
  return value
}
function role() {
  const claimedRole = canonicalRole(cleanRoleValue(claimRole()))
  return claimedRole !== '' ? claimedRole : null
}
function collegeId() {
  const claimedCollege = claimCollege()
  return claimedCollege !== null ? claimedCollege : null
}
function claimedRole() {
  return canonicalRole(cleanRoleValue(claimRole()))
}
// superadmins/{uid} document does not exist (audit: superadmins: null)
function superadminDocExists() {
  return false
}
function isSuperadmin() {
  return isSignedIn() && (claimedRole() === 'superadmin' || superadminDocExists())
}
function isStaff() {
  return (
    isSignedIn() &&
    ['superadmin', 'admin', 'principal', 'hod', 'faculty', 'mentor'].includes(role())
  )
}
function isCollegeStaff() {
  return isStaff() && (isSuperadmin() || collegeId() !== null)
}
function sameCollege(data) {
  return isSuperadmin() || (collegeId() !== null && 'collegeId' in data && data.collegeId === collegeId())
}
function tenantWrite(data) {
  return isSuperadmin() || (isCollegeStaff() && sameCollege(data))
}

// ── rules: staffAttendance block (verbatim, lines 658-697) ─────────────────
const PAYLOAD = {
  collegeId: COLLEGE,
  facultyId: UID,
  facultyName: 'AISHWARYA V',
  department: 'BBA',
  designation: '',
  date: '2026-09-17',
  month: '2026-09',
  status: 'present',
  checkIn: '09:00',
  checkOut: '17:00',
  hoursWorked: 8,
  note: '',
  source: 'self',
  markedBy: UID,
  markedAt: '2026-09-17T10:00:00.000Z',
  createdAt: '2026-09-17T10:00:00.000Z',
  updatedAt: '2026-09-17T10:00:00.000Z',
}

function isOwnRecord(data) {
  return isSignedIn() && 'facultyId' in data && data.facultyId === auth.uid
}
function isAttendanceManager(data) {
  return isSignedIn() && ['admin', 'principal', 'hod'].includes(role()) && sameCollege(data)
}
function allowCreate(data) {
  return (
    isSuperadmin() ||
    (tenantWrite(data) &&
      (isOwnRecord(data) || ['admin', 'principal', 'hod'].includes(claimedRole())))
  )
}

describe('rules model — the exact denied production request', () => {
  it('component values', () => {
    assert.equal(claimRole(), 'faculty')
    assert.equal(cleanRoleValue(claimRole()), 'faculty')
    assert.equal(canonicalRole(cleanRoleValue(claimRole())), 'faculty')
    assert.equal(role(), 'faculty')
    assert.equal(collegeId(), COLLEGE)
    assert.equal(isStaff(), true)
    assert.equal(isCollegeStaff(), true)
    assert.equal(sameCollege(PAYLOAD), true)
    assert.equal(tenantWrite(PAYLOAD), true)
    assert.equal(isOwnRecord(PAYLOAD), true)
  })

  it('allow create evaluates TRUE for the faculty self-mark', () => {
    assert.equal(allowCreate(PAYLOAD), true)
  })
})
