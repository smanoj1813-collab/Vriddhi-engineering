// SAR-ready attainment tables rendered from an immutable obeRuns document.
// The numbers come from the server compute (Slice 2); this component only
// shapes them into the course-level CO table and the PO/PSO table that feed
// SAR criterion 3 and the programme attainment summaries.

import React from 'react';
import { CheckCircle2, MinusCircle, XCircle } from 'lucide-react';
import type { ObeRunDoc, ObeSarCoRow, ObeSarOutcomeRow } from '@/shared/types/obe';
import { GAPC_V4_PROGRAM_OUTCOMES } from '@/shared/types/obe';
import { buildSarCoTable, buildSarOutcomeTable } from '@/shared/utils/obeAttainment';

const PO_TITLES = new Map(GAPC_V4_PROGRAM_OUTCOMES.map((po) => [po.code, po.title]));

function StatusPill({ status }: { status: 'attained' | 'not-attained' | 'no-target' }) {
  if (status === 'attained') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
        <CheckCircle2 size={12} /> Attained
      </span>
    );
  }
  if (status === 'not-attained') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-bold text-rose-800 dark:bg-rose-950/60 dark:text-rose-300">
        <XCircle size={12} /> Gap
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
      <MinusCircle size={12} /> No target
    </span>
  );
}

/** 0–3 attainment bar: red below 1, amber below 2, emerald at/above 2. */
function AttainmentBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, (value / 3) * 100));
  const color = value >= 2 ? 'bg-emerald-500' : value >= 1 ? 'bg-amber-500' : 'bg-rose-500';
  return (
    <span className="flex items-center gap-2">
      <span className="font-bold tabular-nums">{value.toFixed(2)}</span>
      <span className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
        <span className={`block h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
}

const TABLE = 'min-w-full border-collapse text-sm';
const HEAD_ROW = 'bg-slate-50 dark:bg-slate-800/60';
const HEAD_CELL = 'px-3 py-2 text-left font-semibold text-slate-600 dark:text-slate-300 whitespace-nowrap';
const BODY_CELL = 'px-3 py-2 text-slate-700 dark:text-slate-200';
const ROW_BORDER = 'border-t border-slate-200 dark:border-slate-700';

/** Shapes one run into the two SAR tables (shared by the UI, CSV and print). */
export function buildRunSarRows(run: ObeRunDoc): { coRows: ObeSarCoRow[]; outcomeRows: ObeSarOutcomeRow[] } {
  const direct: Record<string, number> = {};
  const indirect: Record<string, number> = {};
  const combined: Record<string, number> = {};
  for (const row of run.coResults) {
    direct[row.co] = row.direct;
    if (row.indirect != null) indirect[row.co] = row.indirect;
    combined[row.co] = row.combined;
  }
  const coRows = buildSarCoTable({
    cos: run.mappingSnapshot.cos,
    direct,
    indirect,
    combined,
    targets: run.mappingSnapshot.coTargets,
  });
  const attainment: Record<string, number> = { ...run.outcomes };
  for (const gap of run.gaps) attainment[gap.outcome] = gap.attained;
  const outcomeRows = buildSarOutcomeTable({
    outcomes: Object.keys(attainment)
      .sort()
      .map((code) => ({ code, title: PO_TITLES.get(code) })),
    attainment,
    targets: run.mappingSnapshot.targets,
  });
  return { coRows, outcomeRows };
}

export function ObeSarTables({ run }: { run: ObeRunDoc }) {
  const { coRows, outcomeRows } = buildRunSarRows(run);

  return (
    <div className="space-y-6">
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
        <table className={TABLE}>
          <caption className="px-3 py-2 text-left text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Course CO attainment (direct + indirect → combined)
          </caption>
          <thead>
            <tr className={HEAD_ROW}>
              <th className={HEAD_CELL}>CO</th>
              <th className={HEAD_CELL}>Direct (0–3)</th>
              <th className={HEAD_CELL}>Indirect</th>
              <th className={HEAD_CELL}>Combined</th>
              <th className={HEAD_CELL}>Target</th>
              <th className={HEAD_CELL}>Status</th>
            </tr>
          </thead>
          <tbody>
            {coRows.map((row) => (
              <tr key={row.co} className={ROW_BORDER}>
                <td className={BODY_CELL} title={row.statement}>
                  <span className="font-bold">{row.co}</span>
                  {row.statement && (
                    <span className="ml-2 hidden text-xs text-slate-500 xl:inline">
                      {row.statement.length > 60 ? `${row.statement.slice(0, 60)}…` : row.statement}
                    </span>
                  )}
                </td>
                <td className={BODY_CELL}>
                  <span className="font-bold tabular-nums">{row.direct}</span>
                </td>
                <td className={BODY_CELL}>
                  <span className="tabular-nums">{row.indirect == null ? '–' : row.indirect.toFixed(2)}</span>
                </td>
                <td className={BODY_CELL}>
                  <AttainmentBar value={row.combined} />
                </td>
                <td className={BODY_CELL}>
                  <span className="tabular-nums">{row.target == null ? '–' : row.target.toFixed(2)}</span>
                </td>
                <td className={BODY_CELL}>
                  <StatusPill status={row.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
        <table className={TABLE}>
          <caption className="px-3 py-2 text-left text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            PO / PSO attainment (weighted CO roll-up)
          </caption>
          <thead>
            <tr className={HEAD_ROW}>
              <th className={HEAD_CELL}>Outcome</th>
              <th className={HEAD_CELL}>Attainment</th>
              <th className={HEAD_CELL}>Target</th>
              <th className={HEAD_CELL}>Gap</th>
              <th className={HEAD_CELL}>Status</th>
            </tr>
          </thead>
          <tbody>
            {outcomeRows.map((row) => (
              <tr key={row.outcome} className={ROW_BORDER}>
                <td className={BODY_CELL} title={row.title}>
                  <span className="font-bold">{row.outcome}</span>
                  {row.title && <span className="ml-2 hidden text-xs text-slate-500 xl:inline">{row.title}</span>}
                </td>
                <td className={BODY_CELL}>
                  <AttainmentBar value={row.attainment} />
                </td>
                <td className={BODY_CELL}>
                  <span className="tabular-nums">{row.target == null ? '–' : row.target.toFixed(2)}</span>
                </td>
                <td className={BODY_CELL}>
                  <span
                    className={`font-bold tabular-nums ${
                      row.gap == null
                        ? ''
                        : row.gap >= 0
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-rose-700 dark:text-rose-400'
                    }`}
                  >
                    {row.gap == null ? '–' : row.gap >= 0 ? `+${row.gap.toFixed(2)}` : row.gap.toFixed(2)}
                  </span>
                </td>
                <td className={BODY_CELL}>
                  <StatusPill status={row.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
