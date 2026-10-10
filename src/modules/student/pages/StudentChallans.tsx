import { useEffect, useState } from 'react'
import {
  Receipt, Download, Building2, CheckCircle, Clock, AlertTriangle, XCircle,
  Landmark, FileText, Loader2, Printer, X, Copy, RefreshCw, Inbox,
  ShieldAlert, Banknote,
} from 'lucide-react'
import type { Challan, ChallanStatus } from '@/modules/admin/api/feeApi'
import { useMyChallans } from '../hooks/useMyChallans'
import { useNotification } from '@/shared/providers/NotificationProvider'

const STATUS_CONFIG: Record<ChallanStatus, { label: string; short: string; color: string; bg: string; icon: any }> = {
  generated: { label: 'Generated — pay at bank', short: 'To pay', color: 'text-amber-700 dark:text-amber-300', bg: 'bg-amber-50 border-amber-200 dark:bg-amber-950/40 dark:border-amber-800/70', icon: Clock },
  paid_at_bank: { label: 'Paid at bank — verification pending', short: 'Verifying', color: 'text-blue-700 dark:text-blue-300', bg: 'bg-blue-50 border-blue-200 dark:bg-blue-950/40 dark:border-blue-800/70', icon: Building2 },
  verified: { label: 'Verified — payment confirmed', short: 'Verified', color: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/40 dark:border-emerald-800/70', icon: CheckCircle },
  rejected: { label: 'Rejected — check with the office', short: 'Rejected', color: 'text-rose-700 dark:text-rose-300', bg: 'bg-rose-50 border-rose-200 dark:bg-rose-950/40 dark:border-rose-800/70', icon: XCircle },
  expired: { label: 'Expired', short: 'Expired', color: 'text-slate-600 dark:text-slate-300', bg: 'bg-slate-50 border-slate-200 dark:bg-slate-800/60 dark:border-slate-700', icon: AlertTriangle },
}

const FILTERS: Array<{ id: ChallanStatus | 'all' | 'overdue'; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'generated', label: 'To pay' },
  { id: 'paid_at_bank', label: 'Verifying' },
  { id: 'verified', label: 'Verified' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'overdue', label: 'Overdue' },
]

function numberToWords(num: number): string {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine']
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
  const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
  if (num === 0) return 'Zero'
  if (num < 10) return ones[num]
  if (num < 20) return teens[num - 10]
  if (num < 100) return tens[Math.floor(num / 10)] + (num % 10 ? ' ' + ones[num % 10] : '')
  if (num < 1000) return ones[Math.floor(num / 100)] + ' Hundred' + (num % 100 ? ' ' + numberToWords(num % 100) : '')
  if (num < 100000) return numberToWords(Math.floor(num / 1000)) + ' Thousand' + (num % 1000 ? ' ' + numberToWords(num % 1000) : '')
  return String(num)
}

const inr = (value: number) => `₹${value.toLocaleString('en-IN')}`

function formatDate(value?: string): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

/**
 * The challan itself, rendered as a bottom sheet on a phone and a centred
 * document on a desktop. `print-sheet` (see src/index.css) is what lets a
 * student tap Print on the phone and hand the bank a clean A4 slip instead of
 * a screenshot with the app chrome around it.
 */
function ChallanPrintSheet({ challan, onClose }: { challan: Challan; onClose: () => void }) {
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={`Challan ${challan.challanNo}`}>
      <button type="button" aria-label="Close challan" onClick={onClose} className="absolute inset-0 print-hide" />
      <div className="print-sheet relative w-full max-w-3xl max-h-[92vh] overflow-y-auto overscroll-contain rounded-t-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-[#131b2e] sm:rounded-2xl">
        <div className="print-hide sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-slate-100 bg-white/95 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-[#131b2e]/95">
          <div className="min-w-0">
            <p className="truncate font-mono text-xs font-bold text-slate-500 dark:text-slate-400">{challan.challanNo}</p>
            <h2 className="truncate text-sm font-bold text-slate-900 dark:text-white">Exam fee challan — {inr(challan.amount)}</h2>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 rounded-xl bg-teal-600 px-3 py-2 text-xs font-bold text-white transition-colors active:bg-teal-700"
            >
              <Printer className="h-4 w-4" /> Print / PDF
            </button>
            <button onClick={onClose} aria-label="Close" className="rounded-xl p-2 text-slate-500 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="space-y-5 p-4 sm:p-6 print:p-0">
          {/* 3 copies */}
          <div className="grid grid-cols-1 gap-2 text-center sm:grid-cols-3">
            <div className="p-2 border-2 border-dashed border-slate-300 rounded-xl">
              <p className="font-black text-xs">BANK COPY</p>
              <p className="text-[10px] text-slate-500">To be retained by Bank</p>
            </div>
            <div className="p-2 border-2 border-dashed border-blue-300 rounded-xl bg-blue-50/50">
              <p className="font-black text-xs text-blue-700">UNIVERSITY COPY</p>
              <p className="text-[10px] text-slate-500">To be sent to University</p>
            </div>
            <div className="p-2 border-2 border-dashed border-emerald-300 rounded-xl bg-emerald-50/50">
              <p className="font-black text-xs text-emerald-700">STUDENT COPY</p>
              <p className="text-[10px] text-slate-500">To be retained by Student</p>
            </div>
          </div>

          <div className="text-center border-b-2 border-slate-900 dark:border-slate-200 pb-4">
            <h1 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white">
              {challan.university} — {challan.collegeName || 'Affiliated College'}
            </h1>
            <p className="text-sm font-bold mt-1 text-slate-900 dark:text-white">University Examination Fee Challan</p>
            <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
              {challan.examTitle || 'Examination fee'} • {challan.examType?.toUpperCase() || 'REGULAR'} • Academic Year {challan.batch}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 rounded-xl border bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/60 sm:gap-4 sm:p-4">
            <div>
              <p className="text-[10px] uppercase font-bold text-slate-500">Challan Number</p>
              <p className="font-mono font-black text-base sm:text-lg text-slate-900 dark:text-white">{challan.challanNo}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase font-bold text-slate-500">Date</p>
              <p className="font-bold text-slate-900 dark:text-white">{formatDate(challan.generatedAt)}</p>
              <p className="text-xs text-slate-500">Due: {formatDate(challan.dueDate)}</p>
            </div>
          </div>

          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Student Details</p>
            <div className="grid grid-cols-1 gap-x-4 text-sm sm:grid-cols-2">
              {[
                ['Name', challan.studentName],
                ['Reg No / USN', `${challan.regNo}${challan.usn ? ` / ${challan.usn}` : ''}`],
                ['Course', challan.course],
                ['Semester', challan.semester],
                ['Batch', challan.batch],
                ['College Code', challan.collegeCode],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3 border-b border-slate-100 py-2 dark:border-slate-800">
                  <span className="text-slate-500">{label}</span>
                  <span className="text-right font-bold text-slate-900 dark:text-white">{value || '—'}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Fee Breakdown</p>
            <div className="overflow-hidden rounded-xl border-2 border-slate-900 dark:border-slate-200">
              {challan.breakdown.map((b, i) => (
                <div key={i} className="flex justify-between gap-3 border-b border-slate-200 p-3 text-sm last:border-0 dark:border-slate-700">
                  <span className="text-slate-700 dark:text-slate-200">{b.label}</span>
                  <span className="font-bold text-slate-900 dark:text-white">{inr(b.amount)}</span>
                </div>
              ))}
              <div className="flex justify-between gap-3 bg-white dark:bg-slate-900 p-3 font-black text-slate-900 dark:text-white">
                <span>Total Amount</span>
                <span>{inr(challan.amount)}</span>
              </div>
              <div className="bg-amber-50 p-3 text-xs dark:bg-amber-950/40">
                <p className="font-bold text-amber-800 dark:text-amber-200">Amount in Words: {numberToWords(challan.amount)} Rupees Only</p>
              </div>
            </div>
          </div>

          <div>
            <p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
              <Landmark size={12} /> Pay to University Bank Account
            </p>
            <div className="space-y-2 rounded-xl border-2 border-blue-600 bg-blue-50/30 p-4 text-sm dark:bg-blue-950/20">
              {[
                ['Bank Name', challan.bankDetails.bankName, false],
                ['Account Name', challan.bankDetails.accountName, false],
                ['Account Number', challan.bankDetails.accountNo, true],
                ['IFSC Code', challan.bankDetails.ifsc, true],
                ['Branch', challan.bankDetails.branch, false],
              ].map(([label, value, mono]) => (
                <div key={String(label)} className="flex justify-between gap-3">
                  <span className="text-slate-600 dark:text-slate-300">{label}</span>
                  <span className={`text-right font-bold text-slate-900 dark:text-white ${mono ? 'font-mono tracking-tight' : ''}`}>{value || '—'}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs space-y-1 dark:border-amber-800/70 dark:bg-amber-950/30">
            <p className="font-bold text-amber-900 dark:text-amber-200">Instructions</p>
            <ol className="list-decimal space-y-1 pl-4 text-amber-900/90 dark:text-amber-100/90">
              <li>Print this challan — it carries three copies (Bank, University, Student).</li>
              <li>Pay {inr(challan.amount)} at {challan.bankDetails.bankName}, {challan.bankDetails.branch}.</li>
              <li>The bank stamps all three copies and keeps the Bank Copy.</li>
              <li>Submit the University Copy at the college office.</li>
              <li>Keep the Student Copy, then tell the office the bank reference number so it can be verified here.</li>
              <li>Last date to pay: {formatDate(challan.dueDate)}. A late fee applies after that date.</li>
            </ol>
          </div>

          <div className="grid grid-cols-1 gap-6 pt-6 text-center text-xs sm:grid-cols-3 sm:gap-8 sm:pt-8">
            <div><div className="mt-10 border-t border-slate-400 pt-2">Student Signature</div></div>
            <div>
              <div className="mt-10 border-t border-slate-400 pt-2">
                Bank Seal &amp; Signature<br /><span className="text-[10px] text-slate-500">With Bank Reference No</span>
              </div>
            </div>
            <div><div className="mt-10 border-t border-slate-400 pt-2">College Seal &amp; Signature</div></div>
          </div>

          <div className="border-t pt-4 text-center text-[10px] text-slate-500">
            Computer-generated challan — no signature required for generation. Bank stamp is mandatory for validity.
            Challan No: {challan.challanNo} • Generated: {challan.generatedAt ? new Date(challan.generatedAt).toLocaleString('en-IN') : '—'}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * "I paid at the bank" — the student files the reference the teller wrote on
 * the stamped receipt. No photo, no upload: the paper copy is handed to the
 * office, and the only thing the portal needs is the number the desk can match
 * against the bank statement. `validateChallanDeclaration` in feeApi and the
 * student `allow update` rule in firestore.rules describe the same
 * shape — a field added here has to be admitted there.
 */
function DeclarePaymentSheet({
  challan,
  submitting,
  error,
  onClose,
  onSubmit,
}: {
  challan: Challan
  submitting: boolean
  error: string | null
  onClose: () => void
  onSubmit: (input: { bankReferenceNo: string; remarks?: string }) => void
}) {
  const [reference, setReference] = useState('')
  const [remarks, setRemarks] = useState('')

  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label="Declare bank payment">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0" />
      <form
        onSubmit={(event) => { event.preventDefault(); onSubmit({ bankReferenceNo: reference, remarks }) }}
        className="relative w-full max-w-md rounded-t-3xl border-t border-slate-200 bg-white p-5 pb-[calc(20px+env(safe-area-inset-bottom))] shadow-2xl dark:border-slate-800 dark:bg-[#131b2e] sm:rounded-3xl sm:border sm:p-6"
      >
        <div className="mx-auto -mt-2 mb-4 h-1 w-10 rounded-full bg-slate-300 sm:hidden dark:bg-slate-600" />
        <h2 className="text-base font-bold text-slate-900 dark:text-white">I paid this challan at the bank</h2>
        <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          {challan.challanNo} • {inr(challan.amount)} • due {formatDate(challan.dueDate)}
        </p>

        <label htmlFor="bank-ref" className="mt-5 block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Bank reference / UTR number
        </label>
        <input
          id="bank-ref"
          value={reference}
          onChange={(event) => setReference(event.target.value)}
          placeholder="SBIN1234567890"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          inputMode="text"
          maxLength={48}
          className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 font-mono text-base font-bold tracking-tight text-slate-900 outline-none transition-colors focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
        />
        <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
          It is printed on the stamped receipt next to “Ref” / “UTR / RRN”. 6–40 characters.
        </p>

        <label htmlFor="bank-note" className="mt-4 block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Note for the office (optional)
        </label>
        <textarea
          id="bank-note"
          value={remarks}
          onChange={(event) => setRemarks(event.target.value)}
          rows={2}
          maxLength={500}
          placeholder="Paid at SBI BCU Campus Branch counter 4 on 22 Sep, University Copy with the office."
          className="mt-1.5 w-full resize-none rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition-colors focus:border-teal-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
        />

        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-600 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300">
          Filing this does <span className="font-bold">not</span> mark the fee paid. The finance office
          matches your reference with the bank and the stamp on your University Copy — then the challan
          turns green and your hall ticket unlocks.
        </div>

        {error && (
          <p role="alert" className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700 dark:border-rose-800/70 dark:bg-rose-950/40 dark:text-rose-200">
            {error}
          </p>
        )}

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 transition-colors active:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            Not now
          </button>
          <button
            type="submit"
            disabled={submitting || !reference.trim()}
            className="flex flex-[1.4] items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-3 text-sm font-bold text-white transition-colors active:bg-teal-700 disabled:opacity-50"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
            {submitting ? 'Filing…' : 'File declaration'}
          </button>
        </div>
      </form>
    </div>
  )
}

export default function StudentChallans() {
  const {
    challans, allChallans, loading, error, summary, refresh,
    statusFilter, setStatusFilter, isOverdue, declare, declaringId,
  } = useMyChallans()
  const { showSuccess, showError } = useNotification()
  const [selected, setSelected] = useState<Challan | null>(null)
  const [declaring, setDeclaring] = useState<Challan | null>(null)
  const [declarationError, setDeclarationError] = useState<string | null>(null)

  const submitDeclaration = async (challan: Challan, input: { bankReferenceNo: string; remarks?: string }) => {
    const result = await declare(challan, input)
    if (result.ok) {
      setDeclaring(null)
      setDeclarationError(null)
      showSuccess(result.message)
    } else {
      setDeclarationError(result.message)
    }
  }

  const canDeclare = (challan: Challan) =>
    challan.status === 'generated' || challan.status === 'rejected' || challan.status === 'expired'

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      showSuccess(`${label} copied`)
    } catch {
      showError('Copy was blocked by the browser')
    }
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-bold sm:text-2xl">
            <Receipt className="h-5 w-5 shrink-0 text-teal-600" /> My Challans
          </h1>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 sm:text-sm">
            University exam fee challans — print, pay at the bank, then get the stamp verified here.
          </p>
        </div>
        <button
          onClick={() => void refresh()}
          aria-label="Refresh challans"
          className="flex shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition-colors active:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 dark:border-rose-900/60 dark:bg-rose-950/30">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-rose-600 dark:text-rose-400" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-rose-800 dark:text-rose-200">Challans could not be loaded</p>
            <p className="mt-1 text-xs leading-relaxed text-rose-700/90 dark:text-rose-300/90">{error}</p>
            <button onClick={() => void refresh()} className="mt-2 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold text-white active:bg-rose-700">
              Try again
            </button>
          </div>
        </div>
      )}

      {/* Money-first summary: what is owed right now is the number that matters. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#131b2e]">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 sm:text-xs">Total challans</p>
          <p className="mt-1 text-2xl font-black text-slate-900 dark:text-white">{summary.total}</p>
          <p className="mt-1 text-xs text-slate-500">{inr(summary.totalAmount)} issued</p>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800/70 dark:bg-amber-950/30">
          <p className="text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300 sm:text-xs">Payable now</p>
          <p className="mt-1 text-2xl font-black text-amber-800 dark:text-amber-200">{inr(summary.amountDue)}</p>
          <p className="mt-1 text-xs text-amber-700/90 dark:text-amber-300/90">
            {summary.toPay} to pay{summary.overdue > 0 ? ` • ${summary.overdue} overdue` : ''}
          </p>
        </div>
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-800/70 dark:bg-blue-950/30">
          <p className="text-[10px] font-bold uppercase tracking-wider text-blue-700 dark:text-blue-300 sm:text-xs">At bank / verifying</p>
          <p className="mt-1 text-2xl font-black text-blue-800 dark:text-blue-200">{summary.verifying}</p>
          <p className="mt-1 text-xs text-blue-700/90 dark:text-blue-300/90">Office is matching the stamp</p>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800/70 dark:bg-emerald-950/30">
          <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300 sm:text-xs">Verified</p>
          <p className="mt-1 text-2xl font-black text-emerald-800 dark:text-emerald-200">{summary.verified}</p>
          <p className="mt-1 text-xs text-emerald-700/90 dark:text-emerald-300/90">Fee marked paid • hall ticket eligible</p>
        </div>
      </div>

      <div className="-mx-3 overflow-x-auto px-3 no-scrollbar sm:mx-0 sm:px-0">
        <div className="flex w-max gap-2 px-1 sm:w-full sm:flex-wrap sm:px-0">
          {FILTERS.map((filter) => {
            const active = statusFilter === filter.id
            // Counts always come from the full list, so a chip never reports
            // "Verified 0" simply because another chip is selected.
            const count = filter.id === 'all'
              ? allChallans.length
              : filter.id === 'overdue'
                ? summary.overdue
                : allChallans.filter((c) => c.status === filter.id).length
            return (
              <button
                key={filter.id}
                onClick={() => setStatusFilter(filter.id)}
                aria-pressed={active}
                className={`whitespace-nowrap rounded-full border px-3.5 py-2 text-xs font-bold transition-colors ${
                  active
                    ? 'border-teal-600 bg-teal-600 text-white'
                    : 'border-slate-200 bg-white text-slate-600 active:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                }`}
              >
                {filter.label}
                <span className={`ml-1.5 ${active ? 'text-teal-100' : 'text-slate-500 dark:text-slate-400'}`}>{count}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* How it works — a vertical stepper on a phone, three columns on desktop. */}
      <div className="rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 p-4 text-white sm:p-6">
        <h3 className="flex items-center gap-2 font-bold"><Landmark size={18} /> How paying a university exam fee works</h3>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {[
            { title: '1. Download the challan', body: 'Tap View & print. The slip carries three copies, the amount, the university bank account and your details.' },
            { title: '2. Pay at the bank', body: 'Pay at the counter, the bank stamps all three copies and gives you the student copy plus a bank reference number.' },
            { title: '3. File the reference', body: 'Tap “I paid” and enter the bank reference — no photo needed. Hand the University Copy to the office; once verified, your fee shows paid and the hall ticket unlocks.' },
          ].map((step) => (
            <div key={step.title} className="rounded-xl bg-white/15 p-3.5 md:p-4">
              <p className="text-sm font-bold">{step.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-blue-100">{step.body}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#131b2e]">
        {loading ? (
          <div className="space-y-3 p-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800/70" />
            ))}
            <p className="flex items-center justify-center gap-2 py-2 text-xs font-medium text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading your challans…
            </p>
          </div>
        ) : challans.length === 0 ? (
          <div className="p-8 text-center sm:p-12">
            <Inbox className="mx-auto mb-3 h-10 w-10 text-slate-300 dark:text-slate-400" />
            <p className="font-bold text-slate-800 dark:text-slate-100">
              {statusFilter === 'all' ? 'No challans yet' : 'Nothing in this filter'}
            </p>
            <p className="mx-auto mt-1 max-w-md text-sm text-slate-500 dark:text-slate-400">
              {statusFilter === 'all'
                ? 'A challan appears here as soon as the college generates the university exam fee for your semester and batch. Nothing to pay means your exam fee is already cleared.'
                : 'Switch to “All” to see the rest of your challans.'}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {challans.map((challan) => {
              const status = STATUS_CONFIG[challan.status]
              const StatusIcon = status.icon
              const overdue = isOverdue(challan)
              return (
                <li key={challan.id} className="p-4 transition-colors active:bg-slate-50 dark:active:bg-slate-800/40">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-xs font-bold text-slate-500 dark:text-slate-400">{challan.challanNo}</p>
                      <p className="mt-1 truncate font-bold text-slate-900 dark:text-white">
                        {challan.examTitle || 'University exam fee'}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        {challan.course} • Sem {challan.semester} • {challan.university}
                      </p>
                    </div>
                    <span className={`flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-bold ${status.bg} ${status.color}`}>
                      <StatusIcon className="h-3 w-3" /> {status.short}
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <p className="text-xl font-black text-slate-900 dark:text-white">{inr(challan.amount)}</p>
                      <p className={`text-xs font-semibold ${overdue ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500 dark:text-slate-400'}`}>
                        {overdue ? `Overdue — due ${formatDate(challan.dueDate)}` : `Due ${formatDate(challan.dueDate)}`}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => copy('Challan number', challan.challanNo)}
                        aria-label="Copy challan number"
                        className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition-colors active:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setSelected(challan)}
                        className="flex h-10 items-center gap-1.5 rounded-xl bg-teal-600 px-3.5 text-xs font-bold text-white transition-colors active:bg-teal-700"
                      >
                        <Download className="h-4 w-4" /> View &amp; print
                      </button>
                      {canDeclare(challan) && (
                        <button
                          onClick={() => { setDeclarationError(null); setDeclaring(challan) }}
                          className="flex h-10 items-center gap-1.5 rounded-xl border border-emerald-300 bg-emerald-50 px-3.5 text-xs font-bold text-emerald-800 transition-colors active:bg-emerald-100 dark:border-emerald-800/70 dark:bg-emerald-950/40 dark:text-emerald-200"
                        >
                          <CheckCircle className="h-4 w-4" /> I paid
                        </button>
                      )}
                    </div>
                  </div>

                  {challan.status === 'verified' && challan.bankReferenceNo && (
                    <p className="mt-3 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-2.5 text-xs text-emerald-800 dark:border-emerald-800/70 dark:bg-emerald-950/30 dark:text-emerald-200">
                      <CheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>
                        Verified • Bank ref <span className="font-mono font-bold">{challan.bankReferenceNo}</span>
                        {challan.verifiedAt ? ` • ${formatDate(challan.verifiedAt)}` : ''} • fee marked paid
                      </span>
                    </p>
                  )}
                  {challan.status === 'paid_at_bank' && (
                    <p className="mt-3 flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 p-2.5 text-xs text-blue-800 dark:border-blue-800/70 dark:bg-blue-950/30 dark:text-blue-200">
                      <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>
                        Filed from your side • Ref <span className="font-mono font-bold">{challan.bankReferenceNo || 'pending'}</span>
                        {challan.paidAt ? ` • ${formatDate(challan.paidAt)}` : ''} — waiting for the office to match it with the bank.
                      </span>
                    </p>
                  )}
                  {challan.status === 'generated' && (
                    <p className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-200">
                      <Banknote className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>Print this challan and pay at {challan.bankDetails.bankName}, {challan.bankDetails.branch}. After paying, tap “I paid” and enter the bank reference printed on your stamped copy.</span>
                    </p>
                  )}
                  {challan.status === 'rejected' && (
                    <p className="mt-3 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-800 dark:border-rose-800/70 dark:bg-rose-950/30 dark:text-rose-200">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>{challan.remarks || 'The bank stamp or reference could not be matched. Visit the finance office with your stamped copy.'}</span>
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <p className="flex items-start gap-2 px-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
        <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Challans are issued by your college, not by Vriddhi. If your exam fee is due and nothing appears here, contact the finance office.
      </p>

      {selected && <ChallanPrintSheet challan={selected} onClose={() => setSelected(null)} />}
      {declaring && (
        <DeclarePaymentSheet
          challan={declaring}
          submitting={declaringId === declaring.id}
          error={declarationError}
          onClose={() => { setDeclaring(null); setDeclarationError(null) }}
          onSubmit={(input) => void submitDeclaration(declaring, input)}
        />
      )}
    </div>
  )
}
