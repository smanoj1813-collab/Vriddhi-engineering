import { getFirestore } from 'firebase-admin/firestore';
import { getApps, initializeApp } from 'firebase-admin/app';
if (!getApps().length) initializeApp();
import * as admin from 'firebase-admin'
import * as logger from 'firebase-functions/logger'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { defineSecret } from 'firebase-functions/params'
import { normalizeRole, pickCollegeId } from './identityShared'
import {
  CODE_RUNNER_DAILY_LIMIT,
  CODE_RUNNER_MAX_OUTPUT_CHARS,
  CODE_RUNNER_PER_MINUTE_LIMIT,
  decideCodeRunnerQuota,
  findJudge0LanguageId,
  isBcaProgram,
  limitRunnerOutput,
  parseCodeRunRequest,
  type Judge0Language,
} from './codeRunnerCore'

const JUDGE0_API_KEY = defineSecret('JUDGE0_API_KEY')
const LANGUAGE_CACHE_TTL_MS = 30 * 60 * 1000
const SUBMISSION_DEADLINE_MS = 12_000
const REQUEST_TIMEOUT_MS = 5_000
const POLL_INTERVAL_MS = 450

let languageCache: { baseUrl: string; expiresAt: number; languages: Judge0Language[] } | null = null

interface StudentRunnerIdentity {
  collegeId: string
}

interface Judge0Status {
  id?: number
  description?: string
}

interface Judge0Submission {
  token?: string
  stdout?: string | null
  stderr?: string | null
  compile_output?: string | null
  message?: string | null
  status?: Judge0Status
  status_id?: number
  time?: string | number | null
  memory?: number | null
}

function judge0BaseUrl(): string {
  const raw = String(process.env.JUDGE0_API_URL || '').trim()
  if (!raw) {
    throw new HttpsError(
      'failed-precondition',
      'The code compiler has not been connected yet. Ask the administrator to configure the Judge0 service.'
    )
  }
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new HttpsError('failed-precondition', 'The configured code compiler URL is invalid.')
  }
  const emulator = process.env.FUNCTIONS_EMULATOR === 'true'
  if (parsed.protocol !== 'https:' && !(emulator && parsed.protocol === 'http:')) {
    throw new HttpsError('failed-precondition', 'The code compiler must use HTTPS outside local development.')
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new HttpsError('failed-precondition', 'The code compiler URL must not contain credentials or query parameters.')
  }
  return parsed.toString().replace(/\/+$/, '')
}

function judge0Headers(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  let apiKey = ''
  try {
    apiKey = JUDGE0_API_KEY.value().trim()
  } catch {
    // The secret is configured at deploy time. An empty value is appropriate
    // only for a Judge0 instance where authentication is disabled.
  }
  const keyHeader = String(process.env.JUDGE0_API_KEY_HEADER || 'X-Auth-Token').trim()
  if (apiKey && /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(keyHeader)) headers[keyHeader] = apiKey
  const rapidApiHost = String(process.env.JUDGE0_API_HOST || '').trim()
  if (rapidApiHost) headers['X-RapidAPI-Host'] = rapidApiHost
  return headers
}

async function requestJson<T>(url: string, init: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      ...init,
      headers: { ...judge0Headers(), ...(init.headers || {}) },
      signal: controller.signal,
    })
    const body = await response.json().catch(() => null)
    if (!response.ok) {
      // Never include provider request/response bodies in logs: an upstream
      // error may echo source code or standard input.
      logger.warn('[CodeRunner] Judge0 request failed', { status: response.status })
      throw new HttpsError('unavailable', 'The compiler service could not complete this request. Try again shortly.')
    }
    if (!body || typeof body !== 'object') {
      throw new HttpsError('unavailable', 'The compiler service returned an invalid response.')
    }
    return body as T
  } catch (error) {
    if (error instanceof HttpsError) throw error
    const reason = error instanceof Error ? error.name : 'unknown'
    logger.warn('[CodeRunner] Judge0 request could not be reached', { reason })
    throw new HttpsError('unavailable', 'The compiler service is temporarily unreachable. Try again shortly.')
  } finally {
    clearTimeout(timer)
  }
}

async function listJudge0Languages(baseUrl: string): Promise<Judge0Language[]> {
  const now = Date.now()
  if (languageCache && languageCache.baseUrl === baseUrl && languageCache.expiresAt > now) {
    return languageCache.languages
  }
  const raw = await requestJson<unknown>(`${baseUrl}/languages`, { method: 'GET' })
  if (!Array.isArray(raw)) throw new HttpsError('unavailable', 'The compiler service returned an invalid language list.')
  const languages = raw
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
    .map((item) => ({ id: item.id as number | string | undefined, name: typeof item.name === 'string' ? item.name : undefined }))
  languageCache = { baseUrl, expiresAt: now + LANGUAGE_CACHE_TTL_MS, languages }
  return languages
}

async function resolveStudentIdentity(uid: string, token: Record<string, unknown>): Promise<StudentRunnerIdentity> {
  const db = getFirestore(admin.app(), 'default')
  const [userSnapshot, studentSnapshot] = await Promise.all([
    db.collection('users').doc(uid).get(),
    db.collection('students').where('userId', '==', uid).limit(2).get(),
  ])
  const user = userSnapshot.data()
  const role = normalizeRole(token.role || user?.role, String(user?.role || '').toLowerCase())
  if (!userSnapshot.exists || role !== 'student') {
    throw new HttpsError('permission-denied', 'The coding lab is available to authenticated student accounts.')
  }
  if (studentSnapshot.size !== 1) {
    throw new HttpsError(
      'failed-precondition',
      studentSnapshot.empty
        ? 'Your student account is not linked to a student profile. Contact your college administrator.'
        : 'Your account is linked to more than one student profile. Contact your college administrator.'
    )
  }
  const student = studentSnapshot.docs[0].data()
  const isBca = [
    student.course,
    student.branch,
    student.department,
    student.program,
    student.courseName,
    user?.course,
    user?.branch,
    user?.department,
  ].some(isBcaProgram)
  if (!isBca) {
    throw new HttpsError('permission-denied', 'The coding lab is available only to BCA students.')
  }
  const tokenCollegeId = typeof token.collegeId === 'string' ? token.collegeId.trim() : ''
  const userCollegeId = pickCollegeId(user)
  const collegeId = tokenCollegeId || userCollegeId || ''
  const studentCollegeId = String(student.collegeId || student.collegeID || student.college_id || '').trim()
  if (!collegeId || studentCollegeId !== collegeId) {
    throw new HttpsError('failed-precondition', 'Your student account does not have a valid college link.')
  }
  const codingLabAccess = await db.collection('colleges').doc(collegeId).collection('config').doc('codingLab').get()
  if (codingLabAccess.get('enabled') !== true) {
    throw new HttpsError('permission-denied', 'Your college has not been assigned Coding Lab access.')
  }
  return { collegeId }
}

async function consumeRunQuota(uid: string): Promise<{ remaining: number }> {
  const db = getFirestore(admin.app(), 'default')
  const ref = db.collection('codeRunnerUsage').doc(uid)
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    const decision = decideCodeRunnerQuota(snapshot.data(), Date.now())
    if (!decision.allowed) {
      if (decision.reason === 'minute') {
        throw new HttpsError('resource-exhausted', `Please wait a minute before running more code. The limit is ${CODE_RUNNER_PER_MINUTE_LIMIT} runs per minute.`)
      }
      throw new HttpsError('resource-exhausted', `You have reached the daily limit of ${CODE_RUNNER_DAILY_LIMIT} code runs. Try again tomorrow.`)
    }
    transaction.set(ref, {
      dayKey: decision.dayKey,
      dailyRuns: decision.dailyRuns,
      minuteKey: decision.minuteKey,
      minuteRuns: decision.minuteRuns,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    })
    return { remaining: decision.dailyRemaining }
  })
}

async function createAndPollSubmission(
  baseUrl: string,
  languageId: number,
  sourceCode: string,
  stdin: string,
): Promise<Judge0Submission> {
  const created = await requestJson<Judge0Submission>(
    `${baseUrl}/submissions?base64_encoded=false&wait=false`,
    {
      method: 'POST',
      body: JSON.stringify({
        source_code: sourceCode,
        language_id: languageId,
        stdin,
        cpu_time_limit: 2,
        cpu_extra_time: 0.5,
        wall_time_limit: 5,
        memory_limit: 128000,
        stack_limit: 64000,
        max_processes_and_or_threads: 20,
      }),
    },
  )
  const token = String(created.token || '').trim()
  if (!token) throw new HttpsError('unavailable', 'The compiler service did not create a run token.')

  const deadline = Date.now() + SUBMISSION_DEADLINE_MS
  let result: Judge0Submission = created
  while (Date.now() < deadline) {
    const statusId = Number(result.status?.id ?? result.status_id)
    if (Number.isInteger(statusId) && statusId > 2) return result
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    result = await requestJson<Judge0Submission>(
      `${baseUrl}/submissions/${encodeURIComponent(token)}?base64_encoded=false&fields=stdout,stderr,compile_output,message,status_id,status,time,memory`,
      { method: 'GET' },
    )
  }
  throw new HttpsError('deadline-exceeded', 'The compiler queue is taking too long. Wait a moment and run the program again.')
}

/**
 * Authenticated student code execution through Judge0. Source and stdin are
 * sent only to the configured sandbox; this callable never saves the code or
 * program output. Runtime limits and daily budgets are enforced server-side.
 */
export const runStudentCode = onCall(
  {
    region: 'asia-south1',
    memory: '256MiB',
    timeoutSeconds: 30,
    minInstances: 0,
    maxInstances: 10,
    secrets: [JUDGE0_API_KEY],
  },
  async (request) => {
    const uid = request.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in with your student account to run code.')

    let input
    try {
      input = parseCodeRunRequest(request.data)
    } catch (error) {
      if (error instanceof Error) throw new HttpsError('invalid-argument', error.message)
      throw new HttpsError('invalid-argument', 'The code-run request is invalid.')
    }

    await resolveStudentIdentity(uid, request.auth?.token || {})
    const baseUrl = judge0BaseUrl()
    const languages = await listJudge0Languages(baseUrl)
    const languageId = findJudge0LanguageId(input.language, languages)
    if (!languageId) {
      const label = input.language === 'cpp' ? 'C++' : input.language === 'python' ? 'Python 3' : input.language.toUpperCase()
      throw new HttpsError('failed-precondition', `${label} is not enabled on the connected compiler service.`)
    }

    const quota = await consumeRunQuota(uid)
    const result = await createAndPollSubmission(baseUrl, languageId, input.sourceCode, input.stdin)
    const statusId = Number(result.status?.id ?? result.status_id) || 0
    const status = String(result.status?.description || 'Compiler result').slice(0, 100)
    const stdout = limitRunnerOutput(result.stdout)
    const stderr = limitRunnerOutput(result.stderr)
    const compileOutput = limitRunnerOutput(result.compile_output)
    const message = limitRunnerOutput(result.message, 4000)
    const time = result.time === null || result.time === undefined ? null : String(result.time).slice(0, 40)
    const memory = result.memory === null || result.memory === undefined || !Number.isFinite(Number(result.memory))
      ? null
      : Number(result.memory)

    // Keep the callable response small even if an upstream runner ignores its
    // own output limits. No source code or stdin is written to logs or Firestore.
    if (stdout.length + stderr.length + compileOutput.length > CODE_RUNNER_MAX_OUTPUT_CHARS * 3) {
      throw new HttpsError('resource-exhausted', 'The compiler output was larger than the allowed response size.')
    }

    return {
      statusId,
      status,
      stdout,
      stderr,
      compileOutput,
      message,
      time,
      memory,
      dailyLimit: CODE_RUNNER_DAILY_LIMIT,
      dailyRemaining: quota.remaining,
    }
  },
)
