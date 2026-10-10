// src/modules/office/api/libraryApi.ts
//
// Library management — catalogue, copies (accession register), circulation,
// reservations, fines, gate register and stock verification.
//
// Collections (all under colleges/{collegeId}/, see firestore.rules):
//   libraryTitles        one row per bibliographic title (+ running copy counts)
//   libraryCopies        one row per physical volume, keyed by accession number
//   libraryLoans         issue / return ledger (borrowers read their own)
//   libraryReservations  hold queue per title
//   libraryFines         overdue / lost / damaged charges — shared with Accounts
//   libraryVisits        gate register (footfall for NAAC 4.2.4)
//   libraryStockChecks   annual stock verification sessions
//   config/library       the college's own rules (libraryEngine.LibrarySettings)

import {
  addDoc,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type QueryConstraint,
} from 'firebase/firestore'
import { db } from '@/Firebase/config'
import {
  actor,
  clean,
  formatDocNo,
  nextCounter,
  nowIso,
  num,
  officeCol,
  officeCollegeId,
  officeDoc,
  str,
  todayIso,
} from './officeDb'
import {
  addDays,
  computeDueDate,
  computeOverdueFine,
  formatAccession,
  normalizeIsbn,
  normalizeLibrarySettings,
  renewedDueDate,
  type LibrarySettings,
  type MemberType,
} from '../utils/libraryEngine'
import { fetchCollegeFaculty } from '@/modules/admin/api/facultyDirectoryApi'
import { waiveFee } from '@/modules/admin/api/feeApi'
import { cappedLimit, warnIfTruncated } from '@/shared/utils/firestoreLimits';

// ─── Types ────────────────────────────────────────────────
export type TitleType = 'book' | 'journal' | 'magazine' | 'ebook' | 'ejournal' | 'database' | 'thesis' | 'media'
export const TITLE_TYPES: { id: TitleType; label: string; physical: boolean }[] = [
  { id: 'book', label: 'Book', physical: true },
  { id: 'journal', label: 'Print journal', physical: true },
  { id: 'magazine', label: 'Magazine', physical: true },
  { id: 'thesis', label: 'Thesis / project', physical: true },
  { id: 'media', label: 'CD / DVD', physical: true },
  { id: 'ebook', label: 'E-book', physical: false },
  { id: 'ejournal', label: 'E-journal', physical: false },
  { id: 'database', label: 'E-database (e.g. N-LIST, DELNET)', physical: false },
]

export interface LibraryTitle {
  id: string
  type: TitleType
  title: string
  subtitle: string
  authors: string
  isbn: string
  publisher: string
  edition: string
  year: string
  pages: number
  language: string
  category: string
  subjects: string
  callNumber: string
  location: string
  department: string
  coverUrl: string
  eUrl: string
  price: number
  totalCopies: number
  availableCopies: number
  createdAt: string
  updatedAt: string
}

export type CopyStatus = 'available' | 'issued' | 'on_hold' | 'lost' | 'damaged' | 'withdrawn' | 'missing' | 'binding'
export const COPY_STATUS_LABEL: Record<CopyStatus, string> = {
  available: 'Available',
  issued: 'Issued',
  on_hold: 'On hold',
  lost: 'Lost',
  damaged: 'Damaged',
  withdrawn: 'Withdrawn',
  missing: 'Missing',
  binding: 'At binding',
}

export interface LibraryCopy {
  id: string
  titleId: string
  titleName: string
  callNumber: string
  accessionNo: string
  status: CopyStatus
  price: number
  acquiredOn: string
  source: 'purchase' | 'donation' | 'exchange'
  vendor: string
  invoiceNo: string
  location: string
  notes: string
  currentLoanId: string
  holdForUid: string
  holdReservationId: string
  createdAt: string
}

export interface LibraryMember {
  type: MemberType
  /** students/{id} or faculty/{id} */
  id: string
  uid: string
  /** Student record id (fee account); '' for staff. */
  studentId: string
  name: string
  code: string
  department: string
  course: string
  batch: string
  email: string
}

export interface LibraryLoan {
  id: string
  copyId: string
  titleId: string
  accessionNo: string
  titleName: string
  memberType: MemberType
  memberId: string
  studentId: string
  memberUid: string
  memberName: string
  memberCode: string
  department: string
  course: string
  batch: string
  issueDate: string
  dueDate: string
  returnDate: string
  status: 'issued' | 'returned' | 'lost'
  renewals: number
  renewRequestedAt: string
  returnCondition: string
  fineAmount: number
  issuedBy: string
}

export type ReservationStatus = 'waiting' | 'ready' | 'fulfilled' | 'cancelled' | 'expired'
export interface LibraryReservation {
  id: string
  titleId: string
  titleName: string
  memberUid: string
  memberType: MemberType
  memberId: string
  studentId: string
  memberName: string
  memberCode: string
  status: ReservationStatus
  createdAt: string
  readyAt: string
  expiresAt: string
  copyId: string
  accessionNo: string
}

export type FineStatus = 'pending' | 'collected' | 'posted' | 'paid' | 'waived'
export type FineReason = 'overdue' | 'lost' | 'damaged' | 'other'
export interface LibraryFine {
  id: string
  loanId: string
  copyId: string
  titleName: string
  accessionNo: string
  memberType: MemberType
  memberId: string
  studentId: string
  memberUid: string
  memberName: string
  memberCode: string
  course: string
  batch: string
  department: string
  reason: FineReason
  days: number
  amount: number
  status: FineStatus
  paymentMode: string
  receiptNo: string
  collectedAt: string
  collectedBy: string
  feePaymentId: string
  postedAt: string
  waivedReason: string
  waivedBy: string
  note: string
  createdAt: string
}

export interface LibraryVisit {
  id: string
  memberType: MemberType
  memberId: string
  memberName: string
  memberCode: string
  department: string
  date: string
  inAt: string
  outAt: string
  purpose: string
}

export interface StockCheck {
  id: string
  name: string
  location: string
  status: 'open' | 'closed'
  scanned: string[]
  startedAt: string
  startedBy: string
  closedAt: string
  summary: { expected: number; found: number; missing: string[]; unexpected: string[]; markedMissing: boolean } | null
}

// ─── Mappers ──────────────────────────────────────────────
const mapTitle = (id: string, r: DocumentData): LibraryTitle => ({
  id,
  type: (str(r.type) || 'book') as TitleType,
  title: str(r.title, 'Untitled'),
  subtitle: str(r.subtitle),
  authors: str(r.authors),
  isbn: str(r.isbn),
  publisher: str(r.publisher),
  edition: str(r.edition),
  year: str(r.year),
  pages: num(r.pages),
  language: str(r.language),
  category: str(r.category),
  subjects: str(r.subjects),
  callNumber: str(r.callNumber),
  location: str(r.location),
  department: str(r.department),
  coverUrl: str(r.coverUrl),
  eUrl: str(r.eUrl),
  price: num(r.price),
  totalCopies: num(r.totalCopies),
  availableCopies: num(r.availableCopies),
  createdAt: str(r.createdAt),
  updatedAt: str(r.updatedAt),
})

const mapCopy = (id: string, r: DocumentData): LibraryCopy => ({
  id,
  titleId: str(r.titleId),
  titleName: str(r.titleName),
  callNumber: str(r.callNumber),
  accessionNo: str(r.accessionNo),
  status: (str(r.status) || 'available') as CopyStatus,
  price: num(r.price),
  acquiredOn: str(r.acquiredOn),
  source: (str(r.source) || 'purchase') as LibraryCopy['source'],
  vendor: str(r.vendor),
  invoiceNo: str(r.invoiceNo),
  location: str(r.location),
  notes: str(r.notes),
  currentLoanId: str(r.currentLoanId),
  holdForUid: str(r.holdForUid),
  holdReservationId: str(r.holdReservationId),
  createdAt: str(r.createdAt),
})

const memberFields = (r: DocumentData) => ({
  memberType: (str(r.memberType) || 'student') as MemberType,
  memberId: str(r.memberId),
  studentId: str(r.studentId),
  memberUid: str(r.memberUid),
  memberName: str(r.memberName),
  memberCode: str(r.memberCode),
})

const mapLoan = (id: string, r: DocumentData): LibraryLoan => ({
  id,
  copyId: str(r.copyId),
  titleId: str(r.titleId),
  accessionNo: str(r.accessionNo),
  titleName: str(r.titleName),
  ...memberFields(r),
  department: str(r.department),
  course: str(r.course),
  batch: str(r.batch),
  issueDate: str(r.issueDate),
  dueDate: str(r.dueDate),
  returnDate: str(r.returnDate),
  status: (str(r.status) || 'issued') as LibraryLoan['status'],
  renewals: num(r.renewals),
  renewRequestedAt: str(r.renewRequestedAt),
  returnCondition: str(r.returnCondition),
  fineAmount: num(r.fineAmount),
  issuedBy: str(r.issuedBy),
})

const mapReservation = (id: string, r: DocumentData): LibraryReservation => ({
  id,
  titleId: str(r.titleId),
  titleName: str(r.titleName),
  ...memberFields(r),
  status: (str(r.status) || 'waiting') as ReservationStatus,
  createdAt: str(r.createdAt),
  readyAt: str(r.readyAt),
  expiresAt: str(r.expiresAt),
  copyId: str(r.copyId),
  accessionNo: str(r.accessionNo),
})

const mapFine = (id: string, r: DocumentData): LibraryFine => ({
  id,
  loanId: str(r.loanId),
  copyId: str(r.copyId),
  titleName: str(r.titleName),
  accessionNo: str(r.accessionNo),
  ...memberFields(r),
  course: str(r.course),
  batch: str(r.batch),
  department: str(r.department),
  reason: (str(r.reason) || 'overdue') as FineReason,
  days: num(r.days),
  amount: num(r.amount),
  status: (str(r.status) || 'pending') as FineStatus,
  paymentMode: str(r.paymentMode),
  receiptNo: str(r.receiptNo),
  collectedAt: str(r.collectedAt),
  collectedBy: str(r.collectedBy),
  feePaymentId: str(r.feePaymentId),
  postedAt: str(r.postedAt),
  waivedReason: str(r.waivedReason),
  waivedBy: str(r.waivedBy),
  note: str(r.note),
  createdAt: str(r.createdAt),
})

const mapVisit = (id: string, r: DocumentData): LibraryVisit => ({
  id,
  memberType: (str(r.memberType) || 'student') as MemberType,
  memberId: str(r.memberId),
  memberName: str(r.memberName),
  memberCode: str(r.memberCode),
  department: str(r.department),
  date: str(r.date),
  inAt: str(r.inAt),
  outAt: str(r.outAt),
  purpose: str(r.purpose),
})

const mapStockCheck = (id: string, r: DocumentData): StockCheck => ({
  id,
  name: str(r.name),
  location: str(r.location),
  status: (str(r.status) || 'open') as StockCheck['status'],
  scanned: Array.isArray(r.scanned) ? r.scanned.map(String) : [],
  startedAt: str(r.startedAt),
  startedBy: str(r.startedBy),
  closedAt: str(r.closedAt),
  summary: (r.summary as StockCheck['summary']) || null,
})

export const titleSearchText = (t: Pick<LibraryTitle, 'title' | 'subtitle' | 'authors' | 'isbn' | 'publisher' | 'subjects' | 'callNumber' | 'category'>) =>
  `${t.title} ${t.subtitle} ${t.authors} ${t.isbn} ${t.publisher} ${t.subjects} ${t.callNumber} ${t.category}`.toLowerCase()

const memberSnapshot = (m: LibraryMember) => ({
  memberType: m.type,
  memberId: m.id,
  studentId: m.type === 'student' ? m.studentId || m.id : '',
  memberUid: m.uid,
  memberName: m.name,
  memberCode: m.code,
  department: m.department,
  course: m.course,
  batch: m.batch,
})

// ─── Settings ─────────────────────────────────────────────
export async function fetchLibrarySettings(cid?: string): Promise<LibrarySettings> {
  const snap = await getDoc(officeDoc('config', 'library', cid))
  return normalizeLibrarySettings(snap.exists() ? (snap.data() as Record<string, unknown>) : null)
}

export async function saveLibrarySettings(settings: LibrarySettings): Promise<void> {
  const clean_ = normalizeLibrarySettings(settings as unknown as Record<string, unknown>)
  // Full overwrite: a merge would deep-merge the policies map and keep stale keys.
  await setDoc(officeDoc('config', 'library'), clean({ ...clean_, updatedAt: nowIso(), updatedBy: actor().name }))
}

// ─── Members ──────────────────────────────────────────────
/** Everyone who can borrow: students (top-level, tenant-scoped) + faculty/staff. */
export async function fetchLibraryMembers(): Promise<LibraryMember[]> {
  const cid = officeCollegeId()
  const [studentSnap, faculty] = await Promise.all([
    getDocs(query(collection(db, 'students'), where('collegeId', '==', cid), limit(5000))),
    fetchCollegeFaculty(cid).catch(() => []),
  ])
  const students: LibraryMember[] = studentSnap.docs
    .filter(d => str(d.data().status).toLowerCase() !== 'inactive')
    .map(d => {
      const r = d.data()
      return {
        type: 'student' as const,
        id: d.id,
        uid: str(r.userId) || str(r.uid),
        studentId: d.id,
        name: str(r.name) || `${str(r.firstName)} ${str(r.lastName)}`.trim() || 'Student',
        code: str(r.regNo) || str(r.registrationNumber) || str(r.usn) || str(r.rollNo),
        department: str(r.department),
        course: str(r.course) || str(r.department) || str(r.branch),
        batch: str(r.batch) || str(r.academicYear),
        email: str(r.email),
      }
    })
  const staff: LibraryMember[] = faculty.map(f => ({
    type: /NON[_ -]?TEACHING|STAFF/i.test(f.employmentType) ? ('staff' as const) : ('faculty' as const),
    id: f.profileId,
    uid: f.uid,
    studentId: '',
    name: f.name,
    code: f.staffCode || f.email,
    department: f.department,
    course: '',
    batch: '',
    email: f.email,
  }))
  return [...students, ...staff].sort((a, b) => a.name.localeCompare(b.name))
}

/** Exact match on ID-card code / email first, then name contains. */
export function findMembers(members: LibraryMember[], raw: string, max = 8): LibraryMember[] {
  const q = raw.trim().toLowerCase()
  if (!q) return []
  const exact = members.filter(m => m.code.toLowerCase() === q || m.email.toLowerCase() === q)
  if (exact.length) return exact
  return members
    .filter(m => `${m.name} ${m.code} ${m.email}`.toLowerCase().includes(q))
    .slice(0, max)
}

// ─── Catalogue ────────────────────────────────────────────
export async function fetchTitles(cid?: string): Promise<LibraryTitle[]> {
  const snap = await getDocs(query(officeCol('libraryTitles', cid), limit(cappedLimit(20000))))
  warnIfTruncated(snap.size, 'libraryTitles');
  return snap.docs.map(d => mapTitle(d.id, d.data())).sort((a, b) => a.title.localeCompare(b.title))
}

export type TitleInput = Omit<LibraryTitle, 'id' | 'totalCopies' | 'availableCopies' | 'createdAt' | 'updatedAt'>

export async function saveTitle(input: TitleInput, id?: string): Promise<string> {
  if (!input.title.trim()) throw new Error('Title is required.')
  const data = {
    ...input,
    title: input.title.trim(),
    isbn: normalizeIsbn(input.isbn),
    price: num(input.price),
    pages: num(input.pages),
    searchText: titleSearchText(input),
    updatedAt: nowIso(),
  }
  if (id) {
    await updateDoc(officeDoc('libraryTitles', id), clean(data))
    // keep denormalised names on the copies in sync
    const copies = await getDocs(query(officeCol('libraryCopies'), where('titleId', '==', id)))
    if (!copies.empty) {
      const batch = writeBatch(db)
      copies.docs.forEach(c => batch.update(c.ref, { titleName: data.title, callNumber: data.callNumber }))
      await batch.commit()
    }
    return id
  }
  const ref = await addDoc(officeCol('libraryTitles'), clean({ ...data, totalCopies: 0, availableCopies: 0, createdAt: nowIso(), createdBy: actor().name }))
  return ref.id
}

export async function deleteTitle(id: string): Promise<void> {
  const copies = await getDocs(query(officeCol('libraryCopies'), where('titleId', '==', id), limit(1)))
  if (!copies.empty) throw new Error('Withdraw or delete its copies first — the accession register must stay complete.')
  await deleteDoc(officeDoc('libraryTitles', id))
}

// ─── Copies / accession register ─────────────────────────
export async function fetchCopies(titleId?: string): Promise<LibraryCopy[]> {
  const constraints: QueryConstraint[] = titleId ? [where('titleId', '==', titleId)] : [limit(cappedLimit(50000))]
  const snap = await getDocs(query(officeCol('libraryCopies'), ...constraints))
  return snap.docs.map(d => mapCopy(d.id, d.data())).sort((a, b) => a.accessionNo.localeCompare(b.accessionNo, undefined, { numeric: true }))
}

export async function findCopyByAccession(accessionNo: string): Promise<LibraryCopy | null> {
  const acc = accessionNo.trim().toUpperCase()
  if (!acc) return null
  const snap = await getDocs(query(officeCol('libraryCopies'), where('accessionNo', '==', acc), limit(1)))
  return snap.empty ? null : mapCopy(snap.docs[0].id, snap.docs[0].data())
}

export interface AddCopiesInput {
  count: number
  price: number
  acquiredOn: string
  source: LibraryCopy['source']
  vendor: string
  invoiceNo: string
  location: string
  /** Manual accession numbers (migration); otherwise auto-numbered. */
  manualAccessions?: string[]
}

export async function addCopies(title: LibraryTitle, input: AddCopiesInput, settings: LibrarySettings): Promise<string[]> {
  const manual = (input.manualAccessions || []).map(a => a.trim().toUpperCase()).filter(Boolean)
  const count = manual.length || Math.max(1, Math.min(500, Math.floor(input.count)))
  let accessions = manual
  if (!manual.length) {
    const first = await nextCounter('libraryAccession', count)
    accessions = Array.from({ length: count }, (_, i) => formatAccession(settings.accessionPrefix, first + i, settings.accessionPadding))
  } else {
    // refuse duplicates of existing accession numbers
    for (const acc of manual) {
      if (await findCopyByAccession(acc)) throw new Error(`Accession ${acc} already exists.`)
    }
  }
  const batch = writeBatch(db)
  const createdAt = nowIso()
  for (const acc of accessions) {
    batch.set(doc(officeCol('libraryCopies')), clean({
      titleId: title.id,
      titleName: title.title,
      callNumber: title.callNumber,
      accessionNo: acc,
      status: 'available',
      price: num(input.price) || title.price,
      acquiredOn: input.acquiredOn || todayIso(),
      source: input.source,
      vendor: input.vendor,
      invoiceNo: input.invoiceNo,
      location: input.location || title.location,
      notes: '',
      currentLoanId: '',
      holdForUid: '',
      holdReservationId: '',
      createdAt,
      createdBy: actor().name,
    }))
  }
  batch.update(officeDoc('libraryTitles', title.id), { totalCopies: increment(accessions.length), availableCopies: increment(accessions.length), updatedAt: createdAt })
  await batch.commit()
  return accessions
}

const COUNTS_AS_AVAILABLE: CopyStatus[] = ['available']
const COUNTS_IN_STOCK: CopyStatus[] = ['available', 'issued', 'on_hold', 'binding', 'damaged', 'missing']

/** Change a copy's status by hand (binding, withdrawn, damaged…) — not for issue/return. */
export async function setCopyStatus(copy: LibraryCopy, status: CopyStatus, notes?: string): Promise<void> {
  if (copy.status === 'issued') throw new Error('Return the book before changing its status.')
  const wasAvail = COUNTS_AS_AVAILABLE.includes(copy.status)
  const isAvail = COUNTS_AS_AVAILABLE.includes(status)
  const wasStock = COUNTS_IN_STOCK.includes(copy.status)
  const isStock = COUNTS_IN_STOCK.includes(status)
  const batch = writeBatch(db)
  batch.update(officeDoc('libraryCopies', copy.id), clean({ status, notes: notes ?? copy.notes, holdForUid: '', holdReservationId: '', updatedAt: nowIso() }))
  const avail = (isAvail ? 1 : 0) - (wasAvail ? 1 : 0)
  const total = (isStock ? 1 : 0) - (wasStock ? 1 : 0)
  if (avail || total) batch.update(officeDoc('libraryTitles', copy.titleId), { availableCopies: increment(avail), totalCopies: increment(total) })
  await batch.commit()
}

export async function updateCopyDetails(id: string, patch: Partial<Pick<LibraryCopy, 'price' | 'location' | 'notes' | 'vendor' | 'invoiceNo' | 'acquiredOn'>>): Promise<void> {
  await updateDoc(officeDoc('libraryCopies', id), clean({ ...patch, updatedAt: nowIso() }))
}

// ─── Circulation ──────────────────────────────────────────
export async function fetchActiveLoans(): Promise<LibraryLoan[]> {
  const snap = await getDocs(query(officeCol('libraryLoans'), where('status', '==', 'issued'), limit(cappedLimit(20000))))
  warnIfTruncated(snap.size, 'libraryLoans(status==issued)');
  return snap.docs.map(d => mapLoan(d.id, d.data())).sort((a, b) => a.dueDate.localeCompare(b.dueDate))
}

export async function fetchLoansForMember(memberId: string): Promise<LibraryLoan[]> {
  const snap = await getDocs(query(officeCol('libraryLoans'), where('memberId', '==', memberId), limit(500)))
  return snap.docs.map(d => mapLoan(d.id, d.data())).sort((a, b) => b.issueDate.localeCompare(a.issueDate))
}

export async function fetchLoansBetween(from: string, to: string): Promise<LibraryLoan[]> {
  const snap = await getDocs(query(officeCol('libraryLoans'), where('issueDate', '>=', from), where('issueDate', '<=', to), limit(cappedLimit(50000))))
  return snap.docs.map(d => mapLoan(d.id, d.data()))
}

/**
 * Issue a copy. Limits/fines are checked by the caller with canIssue();
 * this transaction guarantees the copy is really free (or held for this
 * member) so two desks can never lend the same volume.
 */
export async function issueCopy(args: {
  copyId: string
  member: LibraryMember
  settings: LibrarySettings
  issueDate?: string
  dueDateOverride?: string
}): Promise<LibraryLoan> {
  const { member, settings } = args
  const policy = settings.policies[member.type]
  const issueDate = args.issueDate || todayIso()
  const dueDate = args.dueDateOverride || computeDueDate(issueDate, policy.loanDays, settings)
  const loanRef = doc(officeCol('libraryLoans'))
  const copyRef = officeDoc('libraryCopies', args.copyId)
  const by = actor()

  const loan = await runTransaction(db, async tx => {
    const copySnap = await tx.get(copyRef)
    if (!copySnap.exists()) throw new Error('Copy not found.')
    const copy = mapCopy(copySnap.id, copySnap.data())
    let reservationId = ''
    if (copy.status === 'on_hold') {
      if (copy.holdForUid && copy.holdForUid !== member.uid && copy.holdForUid !== member.id) {
        throw new Error('This copy is on hold for another member’s reservation.')
      }
      reservationId = copy.holdReservationId
    } else if (copy.status !== 'available') {
      throw new Error(`Copy ${copy.accessionNo} is ${COPY_STATUS_LABEL[copy.status].toLowerCase()}.`)
    }
    const data = {
      copyId: copy.id,
      titleId: copy.titleId,
      accessionNo: copy.accessionNo,
      titleName: copy.titleName,
      ...memberSnapshot(member),
      issueDate,
      dueDate,
      returnDate: '',
      status: 'issued',
      renewals: 0,
      renewRequestedAt: '',
      returnCondition: '',
      fineAmount: 0,
      issuedBy: by.name,
      issuedByUid: by.uid,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }
    tx.set(loanRef, clean(data))
    tx.update(copyRef, { status: 'issued', currentLoanId: loanRef.id, holdForUid: '', holdReservationId: '', updatedAt: nowIso() })
    // an on-hold copy was already taken out of availableCopies when held
    if (copy.status === 'available') tx.update(officeDoc('libraryTitles', copy.titleId), { availableCopies: increment(-1) })
    if (reservationId) tx.update(officeDoc('libraryReservations', reservationId), { status: 'fulfilled', updatedAt: nowIso() })
    return mapLoan(loanRef.id, data)
  })
  return loan
}

export type ReturnCondition = 'ok' | 'damaged' | 'lost'

export interface ReturnResult {
  fines: LibraryFine[]
  heldFor: LibraryReservation | null
}

/**
 * Return (or declare lost) a loan. Assesses the overdue fine from the
 * college's policy, a damage/lost charge when applicable, and puts the copy
 * on hold for the next person in the reservation queue.
 */
export async function returnLoan(args: {
  loan: LibraryLoan
  settings: LibrarySettings
  condition: ReturnCondition
  /** ₹ for damaged / lost (pre-filled by the UI from policy + price). */
  extraCharge?: number
  returnDate?: string
  waiveOverdue?: boolean
  note?: string
}): Promise<ReturnResult> {
  const { loan, settings, condition } = args
  const returnDate = args.returnDate || todayIso()
  const policy = settings.policies[loan.memberType] || settings.policies.student
  const overdue = args.waiveOverdue ? { days: 0, amount: 0 } : computeOverdueFine(loan.dueDate, returnDate, policy, settings)

  // Next reservation (queries can't run inside a web transaction).
  let next: LibraryReservation | null = null
  if (condition !== 'lost') {
    const q = await getDocs(query(officeCol('libraryReservations'), where('titleId', '==', loan.titleId), where('status', '==', 'waiting'), limit(50)))
    const queue = q.docs.map(d => mapReservation(d.id, d.data())).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    next = queue[0] || null
  }

  const by = actor()
  const loanRef = officeDoc('libraryLoans', loan.id)
  const copyRef = officeDoc('libraryCopies', loan.copyId)
  const fineRows: Array<Omit<LibraryFine, 'id'>> = []
  const base = {
    loanId: loan.id,
    copyId: loan.copyId,
    titleName: loan.titleName,
    accessionNo: loan.accessionNo,
    memberType: loan.memberType,
    memberId: loan.memberId,
    studentId: loan.studentId,
    memberUid: loan.memberUid,
    memberName: loan.memberName,
    memberCode: loan.memberCode,
    course: loan.course,
    batch: loan.batch,
    department: loan.department,
    status: 'pending' as FineStatus,
    paymentMode: '',
    receiptNo: '',
    collectedAt: '',
    collectedBy: '',
    feePaymentId: '',
    postedAt: '',
    waivedReason: '',
    waivedBy: '',
    note: args.note || '',
    createdAt: nowIso(),
  }
  if (overdue.amount > 0) fineRows.push({ ...base, reason: 'overdue', days: overdue.days, amount: overdue.amount })
  const extra = Math.max(0, num(args.extraCharge))
  if (condition !== 'ok' && extra > 0) fineRows.push({ ...base, reason: condition, days: 0, amount: extra })

  const fineRefs = fineRows.map(() => doc(officeCol('libraryFines')))
  const holdUntil = addDays(returnDate, settings.reservationHoldDays)

  await runTransaction(db, async tx => {
    const loanSnap = await tx.get(loanRef)
    if (!loanSnap.exists() || loanSnap.data().status !== 'issued') throw new Error('This loan is already closed.')
    const total = fineRows.reduce((s, f) => s + f.amount, 0)
    tx.update(loanRef, clean({
      status: condition === 'lost' ? 'lost' : 'returned',
      returnDate,
      returnCondition: condition,
      fineAmount: total,
      returnedBy: by.name,
      renewRequestedAt: '',
      updatedAt: nowIso(),
    }))
    fineRows.forEach((f, i) => tx.set(fineRefs[i], clean(f)))
    const titleRef = officeDoc('libraryTitles', loan.titleId)
    if (condition === 'lost') {
      tx.update(copyRef, { status: 'lost', currentLoanId: '', updatedAt: nowIso() })
      tx.update(titleRef, { totalCopies: increment(-1) })
    } else if (next) {
      tx.update(copyRef, { status: 'on_hold', currentLoanId: '', holdForUid: next.memberUid || next.memberId, holdReservationId: next.id, updatedAt: nowIso() })
      tx.update(officeDoc('libraryReservations', next.id), { status: 'ready', readyAt: nowIso(), expiresAt: holdUntil, copyId: loan.copyId, accessionNo: loan.accessionNo, updatedAt: nowIso() })
    } else {
      tx.update(copyRef, { status: condition === 'damaged' ? 'damaged' : 'available', currentLoanId: '', updatedAt: nowIso() })
      if (condition !== 'damaged') tx.update(titleRef, { availableCopies: increment(1) })
    }
  })

  return {
    fines: fineRows.map((f, i) => ({ ...f, id: fineRefs[i].id })),
    heldFor: next ? { ...next, status: 'ready', expiresAt: holdUntil, copyId: loan.copyId, accessionNo: loan.accessionNo } : null,
  }
}

export async function renewLoan(loan: LibraryLoan, settings: LibrarySettings): Promise<string> {
  const policy = settings.policies[loan.memberType] || settings.policies.student
  const newDue = renewedDueDate(loan.dueDate, todayIso(), policy, settings)
  await updateDoc(officeDoc('libraryLoans', loan.id), { dueDate: newDue, renewals: increment(1), renewRequestedAt: '', lastRenewedAt: nowIso(), updatedAt: nowIso() })
  return newDue
}

export async function countWaitingReservations(titleId: string): Promise<number> {
  const q = await getDocs(query(officeCol('libraryReservations'), where('titleId', '==', titleId), where('status', '==', 'waiting'), limit(50)))
  return q.size
}

export async function declineRenewal(loanId: string): Promise<void> {
  await updateDoc(officeDoc('libraryLoans', loanId), { renewRequestedAt: '', updatedAt: nowIso() })
}

// ─── Borrower self-service (student / faculty) ───────────
/** A borrower's own loans — matched by auth uid and (students) record id. */
export async function fetchMyLoans(uid: string, studentId?: string): Promise<LibraryLoan[]> {
  const queries = [getDocs(query(officeCol('libraryLoans'), where('memberUid', '==', uid), limit(300)))]
  if (studentId) queries.push(getDocs(query(officeCol('libraryLoans'), where('studentId', '==', studentId), limit(300))))
  const results = await Promise.allSettled(queries)
  const byId = new Map<string, LibraryLoan>()
  let anyOk = false
  for (const r of results) {
    if (r.status !== 'fulfilled') continue
    anyOk = true
    r.value.docs.forEach(d => byId.set(d.id, mapLoan(d.id, d.data())))
  }
  if (!anyOk && results[0].status === 'rejected') throw results[0].reason
  return [...byId.values()].sort((a, b) => b.issueDate.localeCompare(a.issueDate))
}

export async function fetchMyFines(uid: string, studentId?: string): Promise<LibraryFine[]> {
  const queries = [getDocs(query(officeCol('libraryFines'), where('memberUid', '==', uid), limit(300)))]
  if (studentId) queries.push(getDocs(query(officeCol('libraryFines'), where('studentId', '==', studentId), limit(300))))
  const results = await Promise.allSettled(queries)
  const byId = new Map<string, LibraryFine>()
  results.forEach(r => r.status === 'fulfilled' && r.value.docs.forEach(d => byId.set(d.id, mapFine(d.id, d.data()))))
  return [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function fetchMyReservations(uid: string, studentId?: string): Promise<LibraryReservation[]> {
  const queries = [getDocs(query(officeCol('libraryReservations'), where('memberUid', '==', uid), limit(100)))]
  if (studentId) queries.push(getDocs(query(officeCol('libraryReservations'), where('studentId', '==', studentId), limit(100))))
  const results = await Promise.allSettled(queries)
  const byId = new Map<string, LibraryReservation>()
  results.forEach(r => r.status === 'fulfilled' && r.value.docs.forEach(d => byId.set(d.id, mapReservation(d.id, d.data()))))
  return [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function requestRenewal(loanId: string): Promise<void> {
  await updateDoc(officeDoc('libraryLoans', loanId), { renewRequestedAt: nowIso(), updatedAt: nowIso() })
}

export async function placeReservation(title: Pick<LibraryTitle, 'id' | 'title'>, member: Omit<LibraryMember, 'email'> & { email?: string }): Promise<void> {
  if (!member.uid) throw new Error('Your account is not linked yet — ask the library desk to reserve for you.')
  await addDoc(officeCol('libraryReservations'), clean({
    titleId: title.id,
    titleName: title.title,
    memberUid: member.uid,
    memberType: member.type,
    memberId: member.id,
    studentId: member.type === 'student' ? member.studentId || member.id : '',
    memberName: member.name,
    memberCode: member.code,
    status: 'waiting',
    createdAt: nowIso(),
    readyAt: '',
    expiresAt: '',
    copyId: '',
    accessionNo: '',
    updatedAt: nowIso(),
  }))
}

export async function cancelMyReservation(id: string): Promise<void> {
  await updateDoc(officeDoc('libraryReservations', id), { status: 'cancelled', updatedAt: nowIso() })
}

// ─── Reservations (desk) ─────────────────────────────────
export async function fetchOpenReservations(): Promise<LibraryReservation[]> {
  const snap = await getDocs(query(officeCol('libraryReservations'), where('status', 'in', ['waiting', 'ready']), limit(5000)))
  return snap.docs.map(d => mapReservation(d.id, d.data())).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export async function cancelReservation(r: LibraryReservation, status: 'cancelled' | 'expired' = 'cancelled'): Promise<void> {
  const batch = writeBatch(db)
  batch.update(officeDoc('libraryReservations', r.id), { status, updatedAt: nowIso() })
  if (r.status === 'ready' && r.copyId) {
    // release the held copy back to the shelf
    batch.update(officeDoc('libraryCopies', r.copyId), { status: 'available', holdForUid: '', holdReservationId: '', updatedAt: nowIso() })
    batch.update(officeDoc('libraryTitles', r.titleId), { availableCopies: increment(1) })
  }
  await batch.commit()
}

/** Expire holds whose pickup window has passed. Returns how many were released. */
export async function expireStaleHolds(reservations: LibraryReservation[]): Promise<number> {
  const today = todayIso()
  const stale = reservations.filter(r => r.status === 'ready' && r.expiresAt && r.expiresAt < today)
  for (const r of stale) await cancelReservation(r, 'expired')
  return stale.length
}

/** Desk places a hold for a member (works for accounts that are not linked yet). */
export async function reserveForMember(title: LibraryTitle, member: LibraryMember): Promise<void> {
  await addDoc(officeCol('libraryReservations'), clean({
    titleId: title.id,
    titleName: title.title,
    ...memberSnapshot(member),
    status: 'waiting',
    createdAt: nowIso(),
    readyAt: '',
    expiresAt: '',
    copyId: '',
    accessionNo: '',
    updatedAt: nowIso(),
  }))
}

// ─── Fines (shared by Operations and Accounts) ───────────
export async function fetchFines(status?: FineStatus | 'open'): Promise<LibraryFine[]> {
  const constraints: QueryConstraint[] =
    status === 'open' ? [where('status', 'in', ['pending', 'posted'])] : status ? [where('status', '==', status)] : []
  const snap = await getDocs(query(officeCol('libraryFines'), ...constraints, limit(cappedLimit(20000))))
  warnIfTruncated(snap.size, 'libraryFines');
  return snap.docs.map(d => mapFine(d.id, d.data())).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function fetchUnpaidFineTotal(memberId: string): Promise<number> {
  const snap = await getDocs(query(officeCol('libraryFines'), where('memberId', '==', memberId), limit(300)))
  return snap.docs.map(d => mapFine(d.id, d.data())).filter(f => f.status === 'pending' || f.status === 'posted').reduce((s, f) => s + f.amount, 0)
}

export async function addManualFine(member: LibraryMember, input: { reason: FineReason; amount: number; note: string; titleName?: string; accessionNo?: string }): Promise<void> {
  if (!(num(input.amount) > 0)) throw new Error('Enter an amount.')
  await addDoc(officeCol('libraryFines'), clean({
    loanId: '',
    copyId: '',
    titleName: input.titleName || '',
    accessionNo: input.accessionNo || '',
    ...memberSnapshot(member),
    reason: input.reason,
    days: 0,
    amount: num(input.amount),
    status: 'pending',
    note: input.note,
    createdAt: nowIso(),
    createdBy: actor().name,
  }))
}

/** Collect at the library counter; issues a library receipt number. */
export async function collectFineAtDesk(fine: LibraryFine, paymentMode: string, settings: LibrarySettings): Promise<string> {
  if (fine.status !== 'pending') throw new Error('Only pending fines can be collected at the desk.')
  const seq = await nextCounter('libraryReceipt')
  const receiptNo = formatDocNo(settings.receiptPrefix || 'LIB', seq)
  const by = actor()
  await updateDoc(officeDoc('libraryFines', fine.id), {
    status: 'collected',
    paymentMode,
    receiptNo,
    collectedAt: nowIso(),
    collectedBy: by.name,
    collectedByUid: by.uid,
    updatedAt: nowIso(),
  })
  return receiptNo
}

/**
 * Post a student's fine to their fee account (category "library") so the
 * accounts team collects it with other dues and the student sees it in the
 * Fee Portal. Staff/faculty fines stay on the library desk.
 */
export async function postFineToFeeAccount(fine: LibraryFine, dueInDays = 15): Promise<string> {
  if (fine.status !== 'pending') throw new Error('Only pending fines can be posted.')
  if (fine.memberType !== 'student' || !fine.studentId) throw new Error('Only student fines can go to the fee account.')
  const reason = fine.reason === 'overdue' ? `Overdue ${fine.days} day(s)` : fine.reason === 'lost' ? 'Lost book' : fine.reason === 'damaged' ? 'Damaged book' : 'Library charge'
  const ref = await addDoc(collection(db, 'colleges', officeCollegeId(), 'feePayments'), {
    studentId: fine.studentId,
    studentName: fine.memberName,
    regNo: fine.memberCode,
    course: fine.course,
    batch: fine.batch,
    category: 'library',
    remarks: `Library fine — ${reason}${fine.titleName ? `: ${fine.titleName}` : ''}${fine.accessionNo ? ` (${fine.accessionNo})` : ''}`,
    amount: fine.amount,
    dueDate: addDays(todayIso(), dueInDays),
    structureId: '',
    paidAmount: 0,
    status: 'pending',
    libraryFineId: fine.id,
    collegeId: officeCollegeId(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  await updateDoc(officeDoc('libraryFines', fine.id), { status: 'posted', feePaymentId: ref.id, postedAt: nowIso(), postedBy: actor().name, updatedAt: nowIso() })
  return ref.id
}

/** Finance only (rules): write off a fine with a reason. */
export async function waiveFine(fine: LibraryFine, reason: string): Promise<void> {
  if (!reason.trim()) throw new Error('A reason is required to waive a fine.')
  if (fine.status === 'collected' || fine.status === 'paid') throw new Error('This fine is already paid.')
  const by = actor()
  await updateDoc(officeDoc('libraryFines', fine.id), { status: 'waived', waivedReason: reason.trim(), waivedBy: by.name, waivedAt: nowIso(), updatedAt: nowIso() })
  if (fine.feePaymentId) {
    // cancel the fee-account due as well (finance may write feePayments)
    await waiveFee(fine.feePaymentId, `Library fine waived: ${reason.trim()}`).catch(() => undefined)
  }
}

/**
 * Accounts: mark posted fines paid once their fee-account due is fully
 * settled. Returns the number of fines updated.
 */
export async function syncPostedFines(fines: LibraryFine[]): Promise<number> {
  let n = 0
  for (const f of fines.filter(x => x.status === 'posted' && x.feePaymentId)) {
    try {
      const snap = await getDoc(doc(db, 'colleges', officeCollegeId(), 'feePayments', f.feePaymentId))
      if (!snap.exists()) continue
      const d = snap.data()
      if (d.status === 'waived') {
        await updateDoc(officeDoc('libraryFines', f.id), { status: 'waived', waivedReason: str(d.remarks) || 'Waived on fee account', waivedBy: 'Accounts', updatedAt: nowIso() })
        n++
      } else if (d.status === 'paid' || num(d.paidAmount) >= num(d.amount)) {
        await updateDoc(officeDoc('libraryFines', f.id), { status: 'paid', receiptNo: str(d.receiptNo), collectedAt: nowIso(), updatedAt: nowIso() })
        n++
      }
    } catch {
      // operations cannot read the fee ledger — skipped silently
    }
  }
  return n
}

// ─── Gate register ────────────────────────────────────────
export async function fetchVisits(from: string, to: string): Promise<LibraryVisit[]> {
  const snap = await getDocs(query(officeCol('libraryVisits'), where('date', '>=', from), where('date', '<=', to), limit(cappedLimit(50000))))
  return snap.docs.map(d => mapVisit(d.id, d.data())).sort((a, b) => b.inAt.localeCompare(a.inAt))
}

/** Scan toggles: first scan of the day checks in, the next checks out. */
export async function toggleVisit(member: LibraryMember, openVisits: LibraryVisit[], purpose = 'Reading'): Promise<'in' | 'out'> {
  const open = openVisits.find(v => v.memberId === member.id && !v.outAt)
  if (open) {
    await updateDoc(officeDoc('libraryVisits', open.id), { outAt: nowIso() })
    return 'out'
  }
  await addDoc(officeCol('libraryVisits'), clean({
    memberType: member.type,
    memberId: member.id,
    memberName: member.name,
    memberCode: member.code,
    department: member.department || member.course,
    date: todayIso(),
    inAt: nowIso(),
    outAt: '',
    purpose,
  }))
  return 'in'
}

// ─── Stock verification ──────────────────────────────────
export async function fetchStockChecks(): Promise<StockCheck[]> {
  const snap = await getDocs(query(officeCol('libraryStockChecks'), orderBy('startedAt', 'desc'), limit(50)))
  return snap.docs.map(d => mapStockCheck(d.id, d.data()))
}

export async function startStockCheck(name: string, location: string): Promise<string> {
  const ref = await addDoc(officeCol('libraryStockChecks'), clean({ name: name.trim() || `Stock verification ${todayIso()}`, location, status: 'open', scanned: [], startedAt: nowIso(), startedBy: actor().name, closedAt: '', summary: null }))
  return ref.id
}

export async function recordStockScan(checkId: string, accessionNos: string[]): Promise<void> {
  const list = accessionNos.map(a => a.trim().toUpperCase()).filter(Boolean)
  if (!list.length) return
  await updateDoc(officeDoc('libraryStockChecks', checkId), { scanned: arrayUnion(...list) })
}

/** Items expected on the shelf: not issued/lost/withdrawn and (optionally) in the location. */
export function stockExpectation(copies: LibraryCopy[], location: string): LibraryCopy[] {
  return copies.filter(c => ['available', 'on_hold', 'missing', 'damaged'].includes(c.status) && (!location || c.location === location))
}

export async function closeStockCheck(check: StockCheck, copies: LibraryCopy[], markMissing: boolean): Promise<StockCheck['summary']> {
  const expected = stockExpectation(copies, check.location)
  const scanned = new Set(check.scanned)
  const knownAcc = new Set(copies.map(c => c.accessionNo))
  const missing = expected.filter(c => !scanned.has(c.accessionNo))
  const summary = {
    expected: expected.length,
    found: expected.length - missing.length,
    missing: missing.map(c => c.accessionNo),
    unexpected: check.scanned.filter(a => !knownAcc.has(a)),
    markedMissing: markMissing,
  }
  if (markMissing) {
    for (const c of missing) if (c.status !== 'missing') await setCopyStatus(c, 'missing', `Not found in ${check.name}`)
    // found items previously flagged missing come back to the shelf
    for (const c of expected) if (c.status === 'missing' && scanned.has(c.accessionNo)) await setCopyStatus(c, 'available', `Found in ${check.name}`)
  }
  await updateDoc(officeDoc('libraryStockChecks', check.id), clean({ status: 'closed', closedAt: nowIso(), summary }))
  return summary
}

// ─── ISBN lookup (Open Library, Google Books fallback) ───
export interface IsbnLookupResult {
  title: string
  subtitle: string
  authors: string
  publisher: string
  year: string
  pages: number
  subjects: string
  coverUrl: string
}

export async function lookupIsbn(raw: string): Promise<IsbnLookupResult | null> {
  const isbn = normalizeIsbn(raw)
  if (isbn.length !== 10 && isbn.length !== 13) return null
  try {
    const res = await fetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`)
    if (res.ok) {
      const json = (await res.json()) as Record<string, any>
      const b = json[`ISBN:${isbn}`]
      if (b) {
        return {
          title: str(b.title),
          subtitle: str(b.subtitle),
          authors: (b.authors || []).map((a: any) => a.name).join(', '),
          publisher: (b.publishers || []).map((p: any) => p.name).join(', '),
          year: (str(b.publish_date).match(/\d{4}/) || [''])[0],
          pages: num(b.number_of_pages),
          subjects: (b.subjects || []).slice(0, 6).map((s: any) => s.name).join(', '),
          coverUrl: str(b.cover?.medium),
        }
      }
    }
  } catch {
    /* fall through to Google Books */
  }
  try {
    const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`)
    if (!res.ok) return null
    const json = (await res.json()) as Record<string, any>
    const v = json.items?.[0]?.volumeInfo
    if (!v) return null
    return {
      title: str(v.title),
      subtitle: str(v.subtitle),
      authors: (v.authors || []).join(', '),
      publisher: str(v.publisher),
      year: (str(v.publishedDate).match(/\d{4}/) || [''])[0],
      pages: num(v.pageCount),
      subjects: (v.categories || []).join(', '),
      coverUrl: str(v.imageLinks?.thumbnail).replace('http://', 'https://'),
    }
  } catch {
    return null
  }
}

// ─── Bulk catalogue import (migration from other software) ─
export interface CatalogueImportRow {
  title: string
  authors?: string
  isbn?: string
  publisher?: string
  edition?: string
  year?: string
  category?: string
  callNumber?: string
  location?: string
  price?: string | number
  accessionNo?: string
  type?: string
  department?: string
  subjects?: string
  acquiredOn?: string
}

/**
 * Rows with the same ISBN (or same title+author when ISBN is missing) become
 * one title; every row with an accession number becomes a copy. Rows without
 * accession numbers get one auto-numbered copy each.
 */
export async function importCatalogue(rows: CatalogueImportRow[], settings: LibrarySettings, onProgress?: (done: number, total: number) => void): Promise<{ titles: number; copies: number; skipped: number }> {
  const existingTitles = await fetchTitles()
  const existingCopies = await fetchCopies()
  const accSeen = new Set(existingCopies.map(c => c.accessionNo))
  const keyOf = (isbn: string, title: string, authors: string) => (isbn ? `i:${isbn}` : `t:${title.trim().toLowerCase()}|${authors.trim().toLowerCase()}`)
  const titleByKey = new Map(existingTitles.map(t => [keyOf(t.isbn, t.title, t.authors), t]))

  let titlesCreated = 0
  let copiesCreated = 0
  let skipped = 0
  const valid = rows.filter(r => str(r.title).trim())
  skipped += rows.length - valid.length

  for (let i = 0; i < valid.length; i++) {
    const r = valid[i]
    const isbn = normalizeIsbn(str(r.isbn))
    const key = keyOf(isbn, str(r.title), str(r.authors))
    let title = titleByKey.get(key)
    if (!title) {
      const type = (TITLE_TYPES.find(t => t.id === str(r.type).toLowerCase())?.id || 'book') as TitleType
      const input: TitleInput = {
        type, title: str(r.title).trim(), subtitle: '', authors: str(r.authors), isbn, publisher: str(r.publisher),
        edition: str(r.edition), year: str(r.year), pages: 0, language: '', category: str(r.category), subjects: str(r.subjects),
        callNumber: str(r.callNumber), location: str(r.location), department: str(r.department), coverUrl: '', eUrl: '', price: num(r.price),
      }
      const id = await saveTitle(input)
      title = { ...input, id, totalCopies: 0, availableCopies: 0, createdAt: nowIso(), updatedAt: nowIso() }
      titleByKey.set(key, title)
      titlesCreated++
    }
    const physical = TITLE_TYPES.find(t => t.id === title!.type)?.physical !== false
    if (physical) {
      const acc = str(r.accessionNo).trim().toUpperCase()
      if (acc && accSeen.has(acc)) {
        skipped++
      } else {
        await addCopies(title, {
          count: 1, price: num(r.price), acquiredOn: str(r.acquiredOn), source: 'purchase', vendor: '', invoiceNo: '', location: str(r.location),
          manualAccessions: acc ? [acc] : undefined,
        }, settings)
        if (acc) accSeen.add(acc)
        copiesCreated++
      }
    }
    onProgress?.(i + 1, valid.length)
  }
  return { titles: titlesCreated, copies: copiesCreated, skipped }
}
