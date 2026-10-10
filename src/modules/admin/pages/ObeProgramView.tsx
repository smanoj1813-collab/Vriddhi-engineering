// Program-level PO/PSO roll-up (Slice 4).
//
// Each published course contributes its LATEST run's outcomes, weighted by
// course credits (credit-weighted mean per outcome — a 4-credit core counts
// more than a 1-credit lab). Courses without credits fall back to weight 1 and
// are named in a banner, so the program table never silently drops a course
// that has evidence. Courses with no runs yet are listed as pending.
//
// Reads only (mappings + latest run per mapping); no writes, no new indexes.

import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueries, useQuery } from '@tanstack/react-query';
import { ChevronLeft, Info, Loader2, Printer } from 'lucide-react';
import type { ObeMappingDoc } from '@/shared/types/obe';
import { GAPC_V4_PROGRAM_OUTCOMES } from '@/shared/types/obe';
import { fetchObeMappings, fetchObeRuns } from '../api/obeApi';
import {
  buildSarOutcomeTable,
  calculateProgramOutcomeAttainment,
} from '@/shared/utils/obeAttainment';

const PO_TITLES = new Map(GAPC_V4_PROGRAM_OUTCOMES.map((po) => [po.code, po.title]));

function formatRunDate(value: unknown): string {
  try {
    const date =
      value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate: unknown }).toDate === 'function'
        ? (value as { toDate: () => Date }).toDate()
        : new Date(String(value));
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
  } catch {
    return '—';
  }
}

export default function ObeProgramView() {
  const mappingsQuery = useQuery({ queryKey: ['obeMappings'], queryFn: () => fetchObeMappings() });
  const published = useMemo(
    () => (mappingsQuery.data ?? []).filter((m) => m.status === 'published'),
    [mappingsQuery.data],
  );

  const years = useMemo(
    () => [...new Set(published.map((m) => m.academicYear))].sort().reverse(),
    [published],
  );
  const programs = useMemo(
    () => [...new Set(published.map((m) => m.programId ?? '').filter(Boolean))].sort(),
    [published],
  );
  const [year, setYear] = useState('');
  const [program, setProgram] = useState('');

  const filtered = useMemo(
    () =>
      published.filter(
        (m) => (!year || m.academicYear === year) && (!program || (m.programId ?? '') === program),
      ),
    [published, year, program],
  );

  const runsQueries = useQueries({
    queries: filtered.map((mapping: ObeMappingDoc) => ({
      queryKey: ['obeRuns', mapping.id],
      queryFn: () => fetchObeRuns(mapping.id),
    })),
  });
  const runsLoading = runsQueries.some((q) => q.isLoading);
  const runsFailed = runsQueries.some((q) => q.isError);

  const { contributions, fallbackCourses, pendingCourses } = useMemo(() => {
    const contributions: { courseCode: string; credits: number; outcomeAttainment: Record<string, number> }[] = [];
    const fallbackCourses: string[] = [];
    const pendingCourses: string[] = [];
    filtered.forEach((mapping, index) => {
      const runs = runsQueries[index]?.data ?? [];
      const latest = runs[0];
      if (!latest) {
        pendingCourses.push(mapping.courseCode);
        return;
      }
      const credits = mapping.credits != null && mapping.credits > 0 ? mapping.credits : 1;
      if (!(mapping.credits != null && mapping.credits > 0)) fallbackCourses.push(mapping.courseCode);
      contributions.push({ courseCode: mapping.courseCode, credits, outcomeAttainment: latest.outcomes ?? {} });
    });
    return { contributions, fallbackCourses, pendingCourses };
  }, [filtered, runsQueries]);

  const attainment = useMemo(() => calculateProgramOutcomeAttainment(contributions), [contributions]);
  const outcomeRows = useMemo(
    () =>
      buildSarOutcomeTable({
        outcomes: Object.keys(attainment)
          .sort()
          .map((code) => ({ code, title: PO_TITLES.get(code) })),
        attainment,
      }),
    [attainment],
  );

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <div>
        <Link
          to="/admin/obe"
          className="inline-flex items-center gap-1 text-sm font-semibold text-teal-700 dark:text-teal-300"
        >
          <ChevronLeft size={16} /> OBE attainment
        </Link>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Program PO/PSO roll-up</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Credit-weighted mean of each course&apos;s latest run — the SAR programme attainment table.
            </p>
          </div>
          <button
            type="button"
            onClick={() => window.print()}
            className="print-hide inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Printer size={14} /> Print / PDF
          </button>
        </div>
      </div>

      {mappingsQuery.isLoading && (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 size={16} className="animate-spin" /> Loading mappings…
        </p>
      )}
      {mappingsQuery.isError && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          Could not load mappings.{' '}
          <button type="button" onClick={() => void mappingsQuery.refetch()} className="font-bold underline">
            Try again
          </button>
          .
        </div>
      )}

      {mappingsQuery.isSuccess && published.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
          <p className="font-bold text-slate-700 dark:text-slate-200">No published mappings</p>
          <p className="mt-1 text-sm text-slate-500">
            Publish course mappings and compute runs — the program table builds itself from the latest run of each
            course.
          </p>
        </div>
      )}

      {published.length > 0 && (
        <div className="print-hide flex flex-wrap gap-3">
          <label className="block">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Academic year</span>
            <select
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className="mt-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
            >
              <option value="">All years</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          {programs.length > 0 && (
            <label className="block">
              <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Program</span>
              <select
                value={program}
                onChange={(e) => setProgram(e.target.value)}
                className="mt-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              >
                <option value="">All programs</option>
                {programs.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      {runsLoading && (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 size={16} className="animate-spin" /> Loading latest runs…
        </p>
      )}
      {runsFailed && (
        <p className="text-sm font-semibold text-rose-600">Some runs could not load — the table below is partial.</p>
      )}

      {!runsLoading && filtered.length > 0 && (
        <div className="space-y-4">
          {(fallbackCourses.length > 0 || pendingCourses.length > 0) && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              <Info size={16} className="mt-0.5 shrink-0" />
              <div>
                {fallbackCourses.length > 0 && (
                  <p>
                    <strong>Equal weight (no credits set):</strong> {fallbackCourses.join(', ')}. Set credits on the
                    mapping for a true credit-weighted roll-up.
                  </p>
                )}
                {pendingCourses.length > 0 && (
                  <p className={fallbackCourses.length > 0 ? 'mt-1' : ''}>
                    <strong>No runs yet (excluded):</strong> {pendingCourses.join(', ')}.
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="print-sheet overflow-x-auto rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
            <table className="min-w-full border-collapse text-sm">
              <caption className="px-4 py-2.5 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                Program PO/PSO attainment{year ? ` · ${year}` : ''}{program ? ` · ${program}` : ''} ·{' '}
                {contributions.length} course{contributions.length === 1 ? '' : 's'}
              </caption>
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60">
                  <th className="whitespace-nowrap px-4 py-2.5 text-left font-semibold text-slate-600 dark:text-slate-300">
                    Outcome
                  </th>
                  <th className="whitespace-nowrap px-4 py-2.5 text-left font-semibold text-slate-600 dark:text-slate-300">
                    Attainment (0–3)
                  </th>
                </tr>
              </thead>
              <tbody>
                {outcomeRows.map((row) => (
                  <tr key={row.outcome} className="border-t border-slate-200 dark:border-slate-700">
                    <td className="px-4 py-2.5" title={row.title}>
                      <span className="font-bold text-slate-800 dark:text-slate-100">{row.outcome}</span>
                      {row.title && <span className="ml-2 hidden text-xs text-slate-500 xl:inline">{row.title}</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="flex items-center gap-2">
                        <span className="font-bold tabular-nums">{row.attainment.toFixed(2)}</span>
                        <span className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                          <span
                            className={`block h-full rounded-full ${
                              row.attainment >= 2 ? 'bg-emerald-500' : row.attainment >= 1 ? 'bg-amber-500' : 'bg-rose-500'
                            }`}
                            style={{ width: `${Math.max(0, Math.min(100, (row.attainment / 3) * 100))}%` }}
                          />
                        </span>
                      </span>
                    </td>
                  </tr>
                ))}
                {outcomeRows.length === 0 && (
                  <tr className="border-t border-slate-200 dark:border-slate-700">
                    <td colSpan={2} className="px-4 py-6 text-center text-sm text-slate-500">
                      No computed runs in this selection yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {contributions.length > 0 && (
            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
              <table className="min-w-full border-collapse text-sm">
                <caption className="px-4 py-2.5 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                  Course contributions (latest run each)
                </caption>
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/60">
                    <th className="px-4 py-2.5 text-left font-semibold text-slate-600 dark:text-slate-300">Course</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-slate-600 dark:text-slate-300">Credits</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-slate-600 dark:text-slate-300">Run</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-slate-600 dark:text-slate-300">Students</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((mapping, index) => {
                    const latest = runsQueries[index]?.data?.[0];
                    if (!latest) return null;
                    return (
                      <tr
                        key={mapping.id}
                        className="border-t border-slate-200 dark:border-slate-700"
                      >
                        <td className="px-4 py-2.5">
                          <Link
                            to={`/admin/obe/${mapping.id}`}
                            className="font-bold text-teal-700 hover:underline dark:text-teal-300"
                          >
                            {mapping.courseCode}
                          </Link>
                          {mapping.courseTitle && (
                            <span className="ml-2 text-slate-500">{mapping.courseTitle}</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 tabular-nums text-slate-600 dark:text-slate-300">
                          {mapping.credits != null && mapping.credits > 0 ? mapping.credits : '1 (equal weight)'}
                        </td>
                        <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">
                          {latest.label || 'Unlabelled run'} · {formatRunDate(latest.createdAt)}
                        </td>
                        <td className="px-4 py-2.5 tabular-nums text-slate-600 dark:text-slate-300">
                          {latest.studentCount}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
