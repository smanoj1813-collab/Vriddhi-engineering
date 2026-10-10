// Attainment runs for one mapping: run history, SAR tables for the selected
// run, and the "New run" dialog (paste-from-Excel scores + surveys → trusted
// server compute). Runs are immutable — a recompute always writes a new run.

import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, FlaskConical, Info, Loader2, Play } from 'lucide-react';
import type { ObeMappingDoc, ObeRunDoc } from '@/shared/types/obe';
import {
  foldScoresToStudents,
  parseObeScoresCsv,
  parseObeSurveysCsv,
} from '@/shared/utils/obeCsv';
import { computeObeAttainment, fetchObeRuns } from '../../api/obeApi';
import { ObeSarTables } from './ObeSarTables';

const SAMPLE_SCORES = [
  'studentId,co,obtained,max',
  'S1,CO1,8,10',
  'S1,CO2,6,10',
  'S2,CO1,4,10',
  'S2,CO2,7,10',
].join('\n');

const SAMPLE_SURVEYS = ['co,score,maxScore', 'CO1,4,5', 'CO1,5,5', 'CO2,3,5'].join('\n');

function formatRunDate(value: unknown): string {
  try {
    const date =
      value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate: unknown }).toDate === 'function'
        ? (value as { toDate: () => Date }).toDate()
        : new Date(String(value));
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
  } catch {
    return '—';
  }
}

function NewRunDialog({
  mapping,
  onClose,
  onComputed,
}: {
  mapping: ObeMappingDoc;
  onClose: () => void;
  onComputed: (runId: string) => void;
}) {
  const coCodes = useMemo(() => mapping.cos.map((c) => c.code), [mapping]);
  const [label, setLabel] = useState('');
  const [tools, setTools] = useState('CIE-1, CIE-2, Assignment, SEE');
  const [scoresText, setScoresText] = useState('');
  const [surveysText, setSurveysText] = useState('');
  const [computing, setComputing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scores = useMemo(() => parseObeScoresCsv(scoresText, coCodes), [scoresText, coCodes]);
  const surveys = useMemo(() => parseObeSurveysCsv(surveysText, coCodes), [surveysText, coCodes]);
  const blocked = scores.rows.length === 0 || scores.errors.length > 0 || surveys.errors.length > 0;
  const students = useMemo(() => new Set(scores.rows.map((r) => r.studentId)).size, [scores]);

  async function handleCompute() {
    if (blocked || computing) return;
    setComputing(true);
    setError(null);
    try {
      const result = await computeObeAttainment({
        mappingId: mapping.id,
        ...(label.trim() ? { label: label.trim() } : {}),
        tools: tools.split(',').map((t) => t.trim()).filter(Boolean),
        studentScores: foldScoresToStudents(scores.rows),
        ...(surveys.surveys.length ? { surveys: surveys.surveys } : {}),
      });
      onComputed(result.runId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Compute failed. Check the scores and try again.');
    } finally {
      setComputing(false);
    }
  }

  const allErrors = [...scores.errors, ...surveys.errors];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">New attainment run</h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Paste <strong>{mapping.courseCode}</strong> marks as long rows — one line per student per CO. The 80/20
          computation runs on the server and the run is frozen as evidence.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Run label (optional)</span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. 2025-26 Odd final"
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
            />
          </label>
          <label className="block">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Assessment tools</span>
            <input
              value={tools}
              onChange={(e) => setTools(e.target.value)}
              placeholder="CIE-1, CIE-2, Assignment, SEE"
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
            />
          </label>
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-500">
              CO scores <span className="font-normal normal-case">(studentId, co, obtained, max)</span>
            </span>
            <button
              type="button"
              onClick={() => setScoresText(SAMPLE_SCORES)}
              className="text-xs font-semibold text-teal-700 underline dark:text-teal-300"
            >
              Insert sample
            </button>
          </div>
          <textarea
            value={scoresText}
            onChange={(e) => setScoresText(e.target.value)}
            rows={7}
            spellCheck={false}
            placeholder="studentId,co,obtained,max&#10;S1,CO1,8,10"
            className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-800"
          />
          <p className="mt-1 text-xs text-slate-500">
            {scores.rows.length} valid rows · {students} students
            {scores.errors.length > 0 && (
              <span className="font-bold text-rose-600"> · {scores.errors.length} errors — fix to enable compute</span>
            )}
          </p>
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Indirect surveys <span className="font-normal normal-case">(optional — course/program exit, alumni)</span>
            </span>
            <button
              type="button"
              onClick={() => setSurveysText(SAMPLE_SURVEYS)}
              className="text-xs font-semibold text-teal-700 underline dark:text-teal-300"
            >
              Insert sample
            </button>
          </div>
          <textarea
            value={surveysText}
            onChange={(e) => setSurveysText(e.target.value)}
            rows={4}
            spellCheck={false}
            placeholder="co,score,maxScore&#10;CO1,4,5"
            className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-800"
          />
          {surveys.surveys.length > 0 && (
            <p className="mt-1 text-xs text-slate-500">{surveys.surveys.length} survey responses</p>
          )}
        </div>

        {allErrors.length > 0 && (
          <div className="mt-4 max-h-32 overflow-y-auto rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
            <p className="flex items-center gap-1 font-bold">
              <AlertTriangle size={14} /> Fix these rows to compute
            </p>
            <ul className="mt-1 list-disc pl-5">
              {allErrors.slice(0, 20).map((message) => (
                <li key={message}>{message}</li>
              ))}
              {allErrors.length > 20 && <li>…and {allErrors.length - 20} more</li>}
            </ul>
          </div>
        )}
        {error && <p className="mt-3 text-sm font-semibold text-rose-600">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleCompute()}
            disabled={blocked || computing}
            className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-bold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {computing ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
            Compute attainment
          </button>
        </div>
      </div>
    </div>
  );
}

export function ObeRunsPanel({ mapping, canCompute }: { mapping: ObeMappingDoc; canCompute: boolean }) {
  const queryClient = useQueryClient();
  const runsQuery = useQuery({
    queryKey: ['obeRuns', mapping.id],
    queryFn: () => fetchObeRuns(mapping.id),
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const runs: ObeRunDoc[] = runsQuery.data ?? [];
  const selected = runs.find((r) => r.id === selectedId) ?? runs[0] ?? null;
  const published = mapping.status === 'published';

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-base font-bold text-slate-800 dark:text-slate-100">
          <FlaskConical size={18} /> Attainment runs
        </h2>
        {canCompute && published && (
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-bold text-white hover:bg-teal-700"
          >
            <Play size={16} /> New run
          </button>
        )}
      </div>

      {!published && (
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          <Info size={16} className="mt-0.5 shrink-0" />
          Publish this mapping to compute attainment runs. Runs freeze the mapping, rules and marks together as SAR
          evidence.
        </p>
      )}

      {runsQuery.isLoading && <p className="mt-4 text-sm text-slate-500">Loading runs…</p>}
      {runsQuery.isError && (
        <p className="mt-4 text-sm font-semibold text-rose-600">Could not load runs. Check your connection and retry.</p>
      )}
      {runsQuery.isSuccess && runs.length === 0 && published && (
        <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
          No runs yet — {canCompute ? 'start the first one with “New run”.' : 'runs will appear here once computed.'}
        </p>
      )}

      {runs.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {runs.map((run) => (
            <button
              key={run.id}
              type="button"
              onClick={() => setSelectedId(run.id)}
              className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                selected?.id === run.id
                  ? 'border-teal-500 bg-teal-50 dark:bg-teal-950/40'
                  : 'border-slate-200 hover:border-slate-300 dark:border-slate-700'
              }`}
            >
              <span className="block font-bold text-slate-800 dark:text-slate-100">
                {run.label || formatRunDate(run.createdAt)}
              </span>
              <span className="text-slate-500">
                {run.studentCount} students{run.label ? ` · ${formatRunDate(run.createdAt)}` : ''}
              </span>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div className="mt-5">
          <p className="mb-3 text-xs text-slate-500">
            Run {selected.label ? `“${selected.label}” · ` : ''}computed {formatRunDate(selected.createdAt)}
            {selected.tools.length > 0 && ` · tools: ${selected.tools.join(', ')}`} · {selected.studentCount} students ·
            rules {selected.mappingSnapshot.rules.coThresholdPercentage}% threshold,{' '}
            {Math.round(selected.mappingSnapshot.rules.directWeight * 100)}/
            {Math.round(selected.mappingSnapshot.rules.indirectWeight * 100)} blend
          </p>
          <ObeSarTables run={selected} />
        </div>
      )}

      {dialogOpen && (
        <NewRunDialog
          mapping={mapping}
          onClose={() => setDialogOpen(false)}
          onComputed={(runId) => {
            setDialogOpen(false);
            setSelectedId(runId);
            void queryClient.invalidateQueries({ queryKey: ['obeRuns', mapping.id] });
          }}
        />
      )}
    </section>
  );
}
