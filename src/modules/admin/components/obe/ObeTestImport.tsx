// One-click CO scores from graded tests (Slice 4 wire-in).
//
// Faculty pick the scheduled tests that assessed this course; the server folds
// the latest graded attempt per student into per-CO scores (CO tags resolve
// from bank `learningOutcomes` lines at import time). The preview shows exactly
// what will be computed — coverage, tagged/untagged questions, skipped items —
// and "Use these scores" drops the folded scores into the run dialog's score
// box, where the normal CSV validation re-verifies them before compute.

import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Info, Loader2 } from 'lucide-react';
import type { ObeMappingDoc } from '@/shared/types/obe';
import {
  fetchObeCandidateTests,
  previewObeScoresFromTests,
  type ObeCandidateTest,
  type ObeTestImportPreview,
} from '../../api/obeApi';

export interface ImportedObeScores {
  scores: ObeTestImportPreview['studentScores'];
  tools: string[];
}

const MAX_SELECT = 20;

const SKIP_REASONS: Record<string, string> = {
  untagged: 'no CO tag in bank',
  'unknown-co': 'CO not on this mapping',
  'no-max': 'no max marks',
  'no-graded-marks': 'no graded marks yet',
};

/** Heuristic course match on test subject/title text (faculty confirms by ticking). */
function courseMatch(test: ObeCandidateTest, mapping: ObeMappingDoc): boolean {
  const hay = `${test.title} ${test.subject} ${test.subjectName}`.toLowerCase();
  const code = mapping.courseCode.toLowerCase().replace(/\s+/g, '');
  if (code.length >= 3 && hay.replace(/\s+/g, '').includes(code)) return true;
  const title = (mapping.courseTitle ?? '').trim().toLowerCase();
  if (title.length > 6 && hay.includes(title)) return true;
  return false;
}

export function ObeTestImport({
  mapping,
  onUseScores,
}: {
  mapping: ObeMappingDoc;
  onUseScores: (imported: ImportedObeScores) => void;
}) {
  const testsQuery = useQuery({ queryKey: ['obeCandidateTests'], queryFn: () => fetchObeCandidateTests() });
  const [selected, setSelected] = useState<string[]>([]);
  const [touched, setTouched] = useState(false);
  const [preview, setPreview] = useState<ObeTestImportPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tests = useMemo(() => {
    const list = testsQuery.data ?? [];
    return [...list].sort(
      (a, b) => Number(courseMatch(b, mapping)) - Number(courseMatch(a, mapping)) || b.createdAtMs - a.createdAtMs,
    );
  }, [testsQuery.data, mapping]);

  useEffect(() => {
    if (touched || tests.length === 0) return;
    setSelected(tests.filter((t) => courseMatch(t, mapping)).slice(0, MAX_SELECT).map((t) => t.id));
  }, [tests, touched, mapping]);

  function toggle(id: string) {
    setTouched(true);
    setPreview(null);
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= MAX_SELECT ? prev : [...prev, id],
    );
  }

  async function handlePreview() {
    if (selected.length === 0 || loading) return;
    setLoading(true);
    setError(null);
    try {
      setPreview(await previewObeScoresFromTests(mapping.id, selected));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed. Check the tests and try again.');
    } finally {
      setLoading(false);
    }
  }

  if (testsQuery.isLoading) return <p className="text-sm text-slate-500">Loading scheduled tests…</p>;
  if (testsQuery.isError || !testsQuery.data) {
    return <p className="text-sm font-semibold text-rose-600">Could not load tests. Check your connection and retry.</p>;
  }
  if (tests.length === 0) {
    return (
      <p className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
        <Info size={16} className="mt-0.5 shrink-0" />
        No scheduled tests in this college yet. Grade a test first, or paste scores manually on the other tab.
      </p>
    );
  }

  return (
    <div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Tick the tests that assessed <strong>{mapping.courseCode}</strong> ({mapping.cos.map((c) => c.code).join(', ')});
        course matches are pre-ticked. Only <strong>graded attempts</strong> fold in — ungraded questions are skipped,
        never zero-filled.
      </p>
      <div className="mt-2 max-h-44 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2 dark:border-slate-700">
        {tests.map((test) => {
          const matched = courseMatch(test, mapping);
          const checked = selected.includes(test.id);
          return (
            <label
              key={test.id}
              className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 ${
                checked ? 'bg-teal-50 dark:bg-teal-950/40' : ''
              }`}
            >
              <input type="checkbox" checked={checked} onChange={() => toggle(test.id)} className="accent-teal-600" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-slate-800 dark:text-slate-100">
                  {test.title || '(untitled test)'}
                </span>
                {(test.subjectName || test.subject) && (
                  <span className="block truncate text-xs text-slate-500">{test.subjectName || test.subject}</span>
                )}
              </span>
              {matched && (
                <span className="shrink-0 rounded-full bg-teal-100 px-2 py-0.5 text-[11px] font-bold text-teal-800 dark:bg-teal-900 dark:text-teal-200">
                  course match
                </span>
              )}
            </label>
          );
        })}
      </div>

      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs text-slate-500">
          {selected.length} of {MAX_SELECT} selected
        </span>
        <button
          type="button"
          onClick={() => void handlePreview()}
          disabled={selected.length === 0 || loading}
          className="inline-flex items-center gap-2 rounded-lg border border-teal-600 px-3 py-1.5 text-sm font-bold text-teal-700 hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-teal-300 dark:hover:bg-teal-950/40"
        >
          {loading ? <Loader2 size={15} className="animate-spin" /> : null}
          Preview folded scores
        </button>
      </div>
      {error && <p className="mt-2 text-sm font-semibold text-rose-600">{error}</p>}

      {preview && (
        <div className="mt-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <p className="flex items-center gap-1.5 text-sm font-bold text-slate-800 dark:text-slate-100">
            <CheckCircle2 size={15} className="text-emerald-600" />
            {preview.students} students · {preview.studentScores.length} score rows ready
          </p>
          <table className="mt-2 min-w-full border-collapse text-xs">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="py-1 pr-3 font-semibold">Test</th>
                <th className="py-1 pr-3 font-semibold">Tagged Qs</th>
                <th className="py-1 font-semibold">Attempts used</th>
              </tr>
            </thead>
            <tbody>
              {preview.tests.map((t) => (
                <tr key={t.testId} className="border-t border-slate-100 dark:border-slate-800">
                  <td
                    className="truncate py-1 pr-3 font-semibold text-slate-700 dark:text-slate-200"
                    style={{ maxWidth: '14rem' }}
                  >
                    {t.title}
                  </td>
                  <td className="py-1 pr-3 tabular-nums">
                    {t.taggedQuestions}/{t.questions}
                  </td>
                  <td className="py-1 tabular-nums">
                    {t.attemptsUsed}/{t.attempts}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {preview.skipped.length > 0 && (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>
                {preview.skipped.length} question{preview.skipped.length === 1 ? '' : 's'} skipped
                {preview.skippedTruncated ? ' (showing first 100)' : ''}:{' '}
                {preview.skipped
                  .slice(0, 6)
                  .map((s) => `${s.questionId} (${SKIP_REASONS[s.reason] ?? s.reason})`)
                  .join('; ')}
                {preview.skipped.length > 6 ? '…' : ''}
              </span>
            </p>
          )}
          {preview.attemptsTruncated && (
            <p className="mt-1 text-xs font-semibold text-amber-700 dark:text-amber-300">
              Attempt list truncated at 2,000 per test — fold covers the first 2,000 only.
            </p>
          )}
          <button
            type="button"
            onClick={() => onUseScores({ scores: preview.studentScores, tools: preview.tools })}
            disabled={preview.studentScores.length === 0}
            className="mt-3 w-full rounded-lg bg-teal-600 px-4 py-2 text-sm font-bold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Use these scores ({preview.students} students)
          </button>
        </div>
      )}
    </div>
  );
}
