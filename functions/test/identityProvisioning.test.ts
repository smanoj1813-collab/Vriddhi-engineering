import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import {
  IDENTITY_API_VERSION,
  SECRET_PROFILE_FIELDS,
  decideProfileAccount,
  generateRandomPassword,
  groupBy,
  isAdvisoryForDuplicate,
  shouldDeferRoleOverwrite,
  isAuthQuotaThrottle,
  isValidEmail,
  shouldReclaimUnsupportedClaims,
  normalizeEmail,
  mapWithConcurrency,
  normalizeRole,
  toPhoneE164,
  withApiVersion,
  withAuthQuotaRetry,
} from '../src/identityShared.ts'
import {
  buildMentorDirectory,
  normalizeMentorReference,
  resolveMentorAssignment,
} from '../src/mentorAssignment.ts'

const here = dirname(fileURLToPath(import.meta.url))

describe('mentor assignment normalization', () => {
  const profiles = [
    {
      docId: 'FAC001',
      data: {
        facultyId: 'FAC001', uid: 'auth-faculty-1', name: 'Asha Rao',
        email: 'asha@example.edu', collegeId: 'college-a',
      },
    },
    {
      docId: 'FAC002',
      data: {
        facultyId: 'FAC002', uid: 'auth-faculty-2', firstName: 'Vikram', lastName: 'Shah',
        email: 'vikram@example.edu', collegeId: 'college-a',
      },
    },
  ]

  it('resolves faculty code, uid, email, and name to the Auth uid', () => {
    const directory = buildMentorDirectory(profiles)
    for (const alias of ['FAC001', 'auth-faculty-1', 'ASHA@EXAMPLE.EDU', '  Asha   Rao ']) {
      assert.deepEqual(resolveMentorAssignment(directory, alias), {
        mentorId: 'auth-faculty-1',
        mentorFacultyId: 'FAC001',
        mentor: 'Asha Rao',
      })
    }
    assert.equal(normalizeMentorReference('  Asha   Rao '), 'asha rao')
  })

  it('does not guess when two faculty profiles share an alias', () => {
    const directory = buildMentorDirectory([
      ...profiles,
      {
        docId: 'FAC003',
        data: { facultyId: 'FAC003', uid: 'auth-faculty-3', name: 'Asha Rao' },
      },
    ])
    assert.equal(resolveMentorAssignment(directory, 'Asha Rao'), null)
    assert.equal(resolveMentorAssignment(directory, 'FAC001')?.mentorId, 'auth-faculty-1')
  })
})

describe('identity API version handshake', () => {
  it('matches the constant the web client expects', () => {
    // The whole point of the handshake is defeated if the two files drift, and
    // the failure it protects against (stale functions + fresh frontend) is
    // silent at runtime. Asserting it in CI makes it loud.
    const client = readFileSync(resolve(here, '../../src/shared/services/identityBackend.ts'), 'utf8')
    const match = client.match(/EXPECTED_IDENTITY_API_VERSION = '([^']+)'/)
    assert.ok(match, 'client must declare EXPECTED_IDENTITY_API_VERSION')
    assert.equal(
      match[1],
      IDENTITY_API_VERSION,
      'functions/src/identityShared.ts and src/shared/services/identityBackend.ts must be bumped and deployed together'
    )
  })

  it('wraps every provisioning response with the version', () => {
    assert.deepEqual(withApiVersion({ created: 1 }), { created: 1, apiVersion: IDENTITY_API_VERSION })
  })

  it('is exported by every identity callable the client calls', () => {
    // A callable the client version-checks must actually report a version,
    // otherwise the client rejects a perfectly good deployment.
    const files = ['studentAuth.ts', 'staffAuth.ts', 'roleManagement.ts', 'accountManagement.ts', 'identityRepair.ts', 'selfIdentity.ts']
    for (const file of files) {
      const source = readFileSync(resolve(here, `../src/${file}`), 'utf8')
      const reportsVersion = /apiVersion|withApiVersion/.test(source)
      assert.ok(reportsVersion, `${file} must return apiVersion (directly or via withApiVersion)`)
    }
  })
})

describe('normalizeRole', () => {
  it('canonicalises the spellings this database actually contains', () => {
    for (const [input, expected] of [
      ['Faculty', 'faculty'],
      ['teacher', 'faculty'],
      ['Assistant Professor', 'faculty'],
      ['Head of Department', 'hod'],
      ['vice-principal', 'principal'],
      ['super admin', 'superadmin'],
      ['Administrator', 'admin'],
      ['Learner', 'student'],
      ['guardian', 'parent'],
    ] as const) {
      assert.equal(normalizeRole(input), expected, `normalizeRole(${input})`)
    }
  })

  it('falls back instead of inventing a privileged role', () => {
    // An unrecognised string must never be rounded up to something with more
    // access than was asked for: it becomes the caller's fallback (or '', which
    // the importers reject as "invalid role") rather than a guess.
    assert.equal(normalizeRole('Super User Extraordinaire', ''), '')
    assert.equal(normalizeRole('Super Admin Wannabe', ''), '')
    assert.equal(normalizeRole('Assistant Professor Emeritus', 'mentor'), 'mentor')
    assert.equal(normalizeRole(undefined, 'student'), 'student')
    assert.equal(normalizeRole(null, 'faculty'), 'faculty')
  })

  it('agrees with the role canonicalisation in firestore.rules', () => {
    // A role the rules understand but the importer does not (or the reverse)
    // produces an account that can be created but not authorised.
    const rules = readFileSync(resolve(here, '../../firestore.rules'), 'utf8')
    const block = rules.slice(rules.indexOf('function canonicalRole('), rules.indexOf('function role()'))
    const spellings = [
      'teacher', 'teaching staff', 'teaching-staff', 'lecturer', 'professor',
      'assistant professor', 'associate professor', 'instructor', 'faculty member',
      'head of department', 'head-of-department', 'head_of_department', 'dept head',
      'department head', 'administrator', 'admin staff', 'college admin',
      'super admin', 'super-admin', 'super_admin', 'superuser', 'owner',
      'vice principal', 'vice-principal', 'vice_principal', 'learner', 'pupil', 'guardian',
    ]
    for (const spelling of spellings) {
      assert.ok(block.includes(`'${spelling}'`), `rules do not canonicalise "${spelling}" — update both files together`)
      assert.ok(normalizeRole(spelling) !== '', `the importer does not canonicalise "${spelling}"`)
    }
  })

  it('never trusts whitespace or case to hide a role', () => {
    assert.equal(normalizeRole('  SUPERADMIN \n'), 'superadmin')
  })
})

describe('decideProfileAccount', () => {
  const facts = (over: Partial<Parameters<typeof decideProfileAccount>[0]>) => ({
    profileEmail: 'supreeth@vriddhi.com',
    linkedUid: 'uid-doc',
    linkedUidExists: true,
    emailUid: 'uid-doc',
    ...over,
  })

  it('agreement between email and uid is an ordinary account to repair', () => {
    assert.deepEqual(decideProfileAccount(facts({})), {
      kind: 'use-account', uid: 'uid-doc', source: 'email', staleLinkedUid: null,
    })
  })

  it('re-points a stale uid instead of following it', () => {
    const d = decideProfileAccount(facts({ emailUid: 'uid-real' }))
    assert.equal(d.kind, 'use-account')
    assert.equal((d as any).uid, 'uid-real')
    assert.equal((d as any).staleLinkedUid, 'uid-doc')
  })

  it('refuses when the stored uid belongs to somebody else', () => {
    assert.deepEqual(
      decideProfileAccount(facts({ emailUid: null })),
      { kind: 'mismatch', uidOfDocument: 'uid-doc', documentEmail: 'supreeth@vriddhi.com' },
      'setting claims on that account would hand a stranger this college, and resetting its password would lock a real person out of their own'
    )
  })

  it('offers to create a login when the email has no account and the uid is dead', () => {
    assert.deepEqual(
      decideProfileAccount(facts({ emailUid: null, linkedUidExists: false })),
      { kind: 'no-account', linkedUidDead: true }
    )
  })

  it('falls back to the uid only when the profile has no email at all', () => {
    assert.deepEqual(
      decideProfileAccount(facts({ profileEmail: null, emailUid: null, linkedUidExists: true })),
      { kind: 'use-account', uid: 'uid-doc', source: 'uid', staleLinkedUid: null }
    )
  })
})

describe('shouldReclaimUnsupportedClaims', () => {
  const base = {
    claimRole: 'faculty',
    roleHasProfileCollection: true,
    referencedByProfile: false,
    isCallerAccount: false,
    fullTenantScan: true,
  }
  const yes = (over: Partial<typeof base> = {}) => shouldReclaimUnsupportedClaims({ ...base, ...over })

  it('reclaims an unbacked college role', () => {
    assert.equal(yes(), true)
  })
  it('never reclaims the operator, a backed account, or an account with no claims', () => {
    assert.equal(yes({ isCallerAccount: true }), false)
    assert.equal(yes({ referencedByProfile: true }), false)
    assert.equal(yes({ claimRole: null }), false)
  })
  it('leaves roles with no profile collection alone (parents are not a repair target)', () => {
    assert.equal(yes({ claimRole: 'parent', roleHasProfileCollection: false }), false)
  })
  it('refuses to reclaim unless the scan covered the whole tenant', () => {
    assert.equal(yes({ fullTenantScan: false }), false,
      'a scoped or truncated pass would strip legitimate staff whose documents it simply never read')
  })
})

describe('groupBy', () => {
  const items = [
    { email: 'b@x.com', id: 1 },
    { email: 'a@x.com', id: 2 },
    { email: 'b@x.com', id: 3 },
    { email: 'a@x.com', id: 4 },
  ]

  it('keeps buckets and members in first-seen order', () => {
    assert.deepEqual(
      groupBy(items, (i) => i.email).map((g) => g.map((i) => i.id)),
      [[1, 3], [2, 4]],
      'a repair pass must be reproducible: the same two documents for one email have to land in the same order every run, because only the first may decide the role claims'
    )
  })

  it('treats a missing key as its own bucket instead of merging the strays', () => {
    const loose = [{ email: '', id: 5 }, { email: '', id: 6 }]
    assert.deepEqual(
      groupBy(loose, (i) => i.email || `row-${i.id}`).map((g) => g[0].id),
      [5, 6],
      'documents with no email must not be collapsed into one identity'
    )
  })

  it('returns nothing for nothing', () => {
    assert.deepEqual(groupBy([], () => 'x'), [])
  })
})

describe('mapWithConcurrency', () => {
  it('preserves input order, which keeps a dry-run report diffable', async () => {
    const out = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      // deliberately inverse delays: the slowest job must still land in place
      await new Promise((r) => setTimeout(r, (10 - n) * 2))
      return n * 2
    })
    assert.deepEqual(out, [2, 4, 6, 8, 10, 12, 14])
  })

  it('actually bounds the number of in-flight calls', async () => {
    let live = 0
    let peak = 0
    await mapWithConcurrency(Array.from({ length: 40 }, (_, i) => i), 6, async () => {
      live++
      peak = Math.max(peak, live)
      await new Promise((r) => setTimeout(r, 1))
      live--
    })
    assert.ok(peak > 1, 'a repair pass that never overlaps calls cannot beat the function deadline')
    assert.ok(peak <= 6, `concurrency exceeded its bound (${peak})`)
  })

  it('lets a failure reject the whole pass instead of returning holes', async () => {
    await assert.rejects(
      () => mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('auth lookup failed')
        return n
      }),
      /auth lookup failed/
    )
  })

  it('handles an empty sweep (a college with no rows yet)', async () => {
    assert.deepEqual(await mapWithConcurrency([], 8, async () => 1), [])
  })
})

describe('temporary passwords', () => {
  it('satisfy the Firebase Auth complexity minimum and are not ambiguous', () => {
    for (let i = 0; i < 50; i++) {
      const password = generateRandomPassword()
      assert.equal(password.length, 14)
      assert.match(password, /[A-Z]/)
      assert.match(password, /[a-z]/)
      assert.match(password, /[0-9]/)
      assert.match(password, /[!@#$%^&*]/)
      // 0/O, 1/l/I are excluded: these are read aloud over the phone.
      assert.doesNotMatch(password, /[0O1lI]/)
    }
  })

  it('does not repeat itself across an import batch', () => {
    const batch = new Set(Array.from({ length: 500 }, () => generateRandomPassword()))
    assert.equal(batch.size, 500, 'a collision would hand two students the same credential')
  })

  it('honours an explicit default password length', () => {
    assert.equal(generateRandomPassword(20).length, 20)
  })
})

describe('plaintext credentials cannot survive on a profile document', () => {
  it('strips every field the rules also refuse to write', () => {
    // Drift guard for the two halves of the same rule: the callables delete
    // these keys, firestore.rules refuses to create them.
    const rules = readFileSync(resolve(here, '../../firestore.rules'), 'utf8')
    const body = rules.slice(rules.indexOf('function noPasswordField()'), rules.indexOf('function noPrivilegedRole'))
    for (const field of SECRET_PROFILE_FIELDS) {
      assert.ok(body.includes(`'${field}'`), `noPasswordField() must also reject "${field}"`)
    }
    assert.ok(/noPasswordField\(\)/.test(rules), 'the rules must call noPasswordField() somewhere')
    for (const collection of ['students', 'faculty', 'admins', 'hods', 'mentors', 'superadmins']) {
      const block = rules.slice(rules.indexOf(`match /${collection}/{id} {`))
      const uptoNext = block.slice(0, block.indexOf('\n    match /'))
      assert.ok(/noPasswordField\(\)/.test(uptoNext), `${collection} writes must be guarded by noPasswordField()`)
    }
  })
})

describe('input normalisation', () => {
  it('lowercases and trims emails, because Auth does too', () => {
    assert.equal(normalizeEmail('  Aarav@College.EDU '), 'aarav@college.edu')
    assert.equal(normalizeEmail(undefined), '')
  })

  it('rejects the malformed addresses the CSV importer used to accept', () => {
    assert.equal(isValidEmail('aarav@college'), false)
    assert.equal(isValidEmail('aarav college.edu'), false)
    assert.equal(isValidEmail('aarav@college.edu'), true)
  })

  it('normalises Indian phone numbers to E.164', () => {
    assert.equal(toPhoneE164('098765 43210'), '+919876543210')
    assert.equal(toPhoneE164(''), undefined)
    assert.equal(toPhoneE164('123'), undefined, 'too short to be a real number')
  })
})

describe('Auth API throttling', () => {
  // A bulk identity pass at 24-way concurrency cleared ~230 rows and then the
  // Auth API started answering "Exceeded quota for updating account
  // information" — reported by the Admin SDK as auth/unknown, i.e. indistinguishable
  // from a real failure unless you look at the message. Those rows stayed broken.
  // Errors, not plain objects: the Admin SDK throws an Error subclass that
  // carries `code` and `errorInfo`, and matching its real shape keeps a
  // `String(err)` comparison in the assertions honest.
  const shape = (code: string, message: string) =>
    Object.assign(new Error(message), { code, errorInfo: { code, message } })

  it('recognises the quota message the Admin SDK actually returns', () => {
    assert.equal(isAuthQuotaThrottle(shape('auth/unknown', 'Exceeded quota for updating account information.')), true)
    assert.equal(isAuthQuotaThrottle(shape('auth/quota-exceeded', 'too far')), true)
    assert.equal(isAuthQuotaThrottle(shape('auth/too-many-requests', 'slow down')), true)
    assert.equal(isAuthQuotaThrottle({ message: 'Quota per minute rate limit exceeded' }), true)
  })

  it('does not treat a genuine rejection as a throttle', () => {
    assert.equal(isAuthQuotaThrottle(shape('auth/email-already-exists', 'Email already exists')), false)
    assert.equal(isAuthQuotaThrottle(shape('auth/user-not-found', 'No user record')), false)
    assert.equal(isAuthQuotaThrottle(null), false)
    assert.equal(isAuthQuotaThrottle('permission-denied'), false)
  })

  it('retries a throttled write and returns its result', async () => {
    let calls = 0
    const value = await withAuthQuotaRetry(
      'test',
      async () => {
        calls++
        if (calls < 3) throw shape('auth/unknown', 'Exceeded quota for updating account information.')
        return 'ok'
      },
      { attempts: 4, baseDelayMs: 1 }
    )
    assert.equal(value, 'ok')
    assert.equal(calls, 3)
  })

  it('gives up without retrying a non-quota error, and never loops forever', async () => {
    let calls = 0
    await assert.rejects(
      withAuthQuotaRetry('test', async () => {
        calls++
        throw shape('auth/email-already-exists', 'Email already exists')
      }, { baseDelayMs: 1 }),
      /already exists/
    )
    assert.equal(calls, 1)

    let throttled = 0
    await assert.rejects(
      withAuthQuotaRetry('test', async () => {
        throttled++
        throw shape('auth/unknown', 'Exceeded quota for updating account information.')
      }, { attempts: 3, baseDelayMs: 1 }),
      /Exceeded quota/
    )
    assert.equal(throttled, 3)
  })
})

describe('duplicate findings the pass cannot settle', () => {
  it('treats claims findings on a non-primary profile as advice', () => {
    assert.equal(isAdvisoryForDuplicate(['DUPLICATE_PROFILE', 'WRONG_CLAIMS']), true)
    assert.equal(isAdvisoryForDuplicate(['DUPLICATE_PROFILE']), true)
  })

  it('still counts anything Apply can actually change', () => {
    // A stale uid or a missing pointer is written even on a duplicate, so those rows
    // must keep counting as work owed.
    assert.equal(isAdvisoryForDuplicate(['DUPLICATE_PROFILE', 'STALE_UID_LINK']), false)
    assert.equal(isAdvisoryForDuplicate(['DUPLICATE_PROFILE', 'MISSING_PROFILE_LINK']), false)
    assert.equal(isAdvisoryForDuplicate(['DUPLICATE_PROFILE', 'PLAINTEXT_SECRET']), false)
  })

  it('does not call an empty finding list advisory', () => {
    // `every` is true for an empty array, which would silently hide a clean row.
    assert.equal(isAdvisoryForDuplicate([]), false)
  })
})

describe('role claims are never traded from a partial view', () => {
  it('fills a missing claim from any scope', () => {
    assert.equal(
      shouldDeferRoleOverwrite({
        existingClaimRole: null,
        documentRole: 'faculty',
        scansAllProfileCollections: false,
        forceClaims: false,
      }),
      false
    )
  })

  it('refuses to replace one role with another when another collection may own it', () => {
    // `hods/{id}` says hod, the account says faculty, and `faculty` was not scanned:
    // the answer belongs to a document this pass cannot see.
    assert.equal(
      shouldDeferRoleOverwrite({
        existingClaimRole: 'faculty',
        documentRole: 'hod',
        scansAllProfileCollections: false,
        forceClaims: false,
      }),
      true
    )
  })

  it('allows the overwrite on a full scan and on an explicit force', () => {
    assert.equal(
      shouldDeferRoleOverwrite({
        existingClaimRole: 'faculty',
        documentRole: 'hod',
        scansAllProfileCollections: true,
        forceClaims: false,
      }),
      false
    )
    assert.equal(
      shouldDeferRoleOverwrite({
        existingClaimRole: 'faculty',
        documentRole: 'hod',
        scansAllProfileCollections: false,
        forceClaims: true,
      }),
      false
    )
  })

  it('does not defer when the roles agree and only the college was wrong', () => {
    assert.equal(
      shouldDeferRoleOverwrite({
        existingClaimRole: 'faculty',
        documentRole: 'faculty',
        scansAllProfileCollections: false,
        forceClaims: false,
      }),
      false
    )
  })
})

