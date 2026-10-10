// Correlation matrix editor: COs × PO/PSO outcomes, strengths 0–3.
// Click a cell to cycle unmapped → 1 → 2 → 3 → unmapped. Read-only mode
// renders the same grid as evidence (published mappings, principal view).

import React from 'react';
import type { ObeCourseOutcome, ObeMappingMatrix } from '@/shared/types/obe';

export interface ObeMatrixOutcome {
  code: string;
  title?: string;
}

const CELL_STYLES: Record<number, string> = {
  0: 'text-slate-300 dark:text-slate-600 hover:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800',
  1: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900/60',
  2: 'bg-orange-200 text-orange-900 dark:bg-orange-950/60 dark:text-orange-300 hover:bg-orange-300 dark:hover:bg-orange-900/70',
  3: 'bg-emerald-200 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300 hover:bg-emerald-300 dark:hover:bg-emerald-900/70',
};

export function ObeMatrixGrid({
  cos,
  outcomes,
  mapping,
  onChange,
  readOnly = false,
}: {
  cos: ObeCourseOutcome[];
  outcomes: ObeMatrixOutcome[];
  mapping: ObeMappingMatrix;
  onChange: (co: string, outcome: string, value: number) => void;
  readOnly?: boolean;
}) {
  if (cos.length === 0) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">
        Add course outcomes below to start mapping them to programme outcomes.
      </p>
    );
  }
  return (
    <div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
        <table className="min-w-full border-collapse text-sm">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-800/60">
              <th className="sticky left-0 z-10 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-left font-semibold text-slate-600 dark:text-slate-300">
                CO ↓ · PO/PSO →
              </th>
              {outcomes.map((outcome) => (
                <th
                  key={outcome.code}
                  title={outcome.title ?? outcome.code}
                  className="px-2 py-2 text-center font-semibold text-slate-600 dark:text-slate-300 whitespace-nowrap"
                >
                  {outcome.code}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cos.map((co) => (
              <tr key={co.code} className="border-t border-slate-200 dark:border-slate-700">
                <td
                  className="sticky left-0 z-10 bg-white dark:bg-slate-900 px-3 py-1.5 font-semibold text-slate-700 dark:text-slate-200 whitespace-nowrap"
                  title={co.statement}
                >
                  {co.code}
                </td>
                {outcomes.map((outcome) => {
                  const raw = mapping[co.code]?.[outcome.code] ?? 0;
                  const value = raw >= 1 && raw <= 3 ? raw : 0;
                  return (
                    <td key={outcome.code} className="px-1 py-1 text-center">
                      <button
                        type="button"
                        disabled={readOnly}
                        onClick={() => onChange(co.code, outcome.code, (value + 1) % 4)}
                        title={
                          readOnly
                            ? `${co.code} → ${outcome.code}: ${value === 0 ? 'not mapped' : `strength ${value}`}`
                            : `${co.code} → ${outcome.code}: click to set ${(value + 1) % 4 === 0 ? 'unmapped' : (value + 1) % 4}`
                        }
                        className={`h-9 w-9 rounded-lg font-bold transition-colors disabled:cursor-default ${CELL_STYLES[value]}`}
                      >
                        {value === 0 ? '–' : value}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
        <span className="font-semibold">Correlation:</span>
        <span>– unmapped</span>
        <span className="font-bold text-amber-700 dark:text-amber-400">1 slight</span>
        <span className="font-bold text-orange-700 dark:text-orange-400">2 moderate</span>
        <span className="font-bold text-emerald-700 dark:text-emerald-400">3 substantial</span>
        {!readOnly && <span className="italic">Click a cell to cycle 1 → 2 → 3 → unmapped.</span>}
      </div>
    </div>
  );
}
