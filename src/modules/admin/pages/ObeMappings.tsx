// OBE attainment — mapping list. One row per course offering per term; the
// editor (ObeMappingEditor) authors the COs + correlation matrix, and runs
// freeze computed attainment as SAR evidence.

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Loader2, Plus, Target } from 'lucide-react';
import { useAuth } from '@/modules/auth/context/AuthContext';
import { roleHasPermission } from '@/modules/auth/permissions';
import type { ObeMappingStatus } from '@/shared/types/obe';
import { fetchObeMappings } from '../api/obeApi';

const STATUS_STYLES: Record<ObeMappingStatus, string> = {
  draft: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  published: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
  archived: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
};

export default function ObeMappings() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canManage = roleHasPermission(user?.role, 'obe.manage');
  const mappingsQuery = useQuery({ queryKey: ['obeMappings'], queryFn: () => fetchObeMappings() });
  const mappings = mappingsQuery.data ?? [];

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-800 dark:text-slate-100">
            <Target size={22} /> OBE attainment
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Course outcomes → PO/PSO mappings and computed attainment (NBA GAPC v4.0, 80/20 direct + indirect).
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => navigate('/admin/obe/program')}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Program roll-up →
          </button>
          {canManage && (
            <button
              type="button"
              onClick={() => navigate('/admin/obe/new')}
              className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-bold text-white hover:bg-teal-700"
            >
              <Plus size={16} /> New mapping
            </button>
          )}
        </div>
      </div>

      {mappingsQuery.isLoading && (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 size={16} className="animate-spin" /> Loading mappings…
        </p>
      )}
      {mappingsQuery.isError && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
          Could not load mappings. Check your connection, then{' '}
          <button type="button" onClick={() => void mappingsQuery.refetch()} className="font-bold underline">
            try again
          </button>
          .
        </div>
      )}

      {mappingsQuery.isSuccess && mappings.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
          <Target size={32} className="mx-auto text-slate-300 dark:text-slate-600" />
          <p className="mt-3 font-bold text-slate-700 dark:text-slate-200">No mappings yet</p>
          <p className="mt-1 text-sm text-slate-500">
            {canManage
              ? 'Create the first course mapping — COs, the CO→PO/PSO matrix and targets — then compute attainment.'
              : 'Mappings will appear here once the department publishes them.'}
          </p>
          {canManage && (
            <button
              type="button"
              onClick={() => navigate('/admin/obe/new')}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-bold text-white hover:bg-teal-700"
            >
              <Plus size={16} /> New mapping
            </button>
          )}
        </div>
      )}

      {mappings.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/60">
                <th className="px-4 py-2.5 text-left font-semibold text-slate-600 dark:text-slate-300">Course</th>
                <th className="px-4 py-2.5 text-left font-semibold text-slate-600 dark:text-slate-300">Year · Term</th>
                <th className="px-4 py-2.5 text-left font-semibold text-slate-600 dark:text-slate-300">COs</th>
                <th className="px-4 py-2.5 text-left font-semibold text-slate-600 dark:text-slate-300">Status</th>
                <th className="px-4 py-2.5 text-right font-semibold text-slate-600 dark:text-slate-300">Open</th>
              </tr>
            </thead>
            <tbody>
              {mappings.map((mapping) => (
                <tr
                  key={mapping.id}
                  onClick={() => navigate(`/admin/obe/${mapping.id}`)}
                  className="cursor-pointer border-t border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/50"
                >
                  <td className="px-4 py-3">
                    <span className="font-bold text-slate-800 dark:text-slate-100">{mapping.courseCode}</span>
                    {mapping.courseTitle && (
                      <span className="ml-2 text-slate-500">{mapping.courseTitle}</span>
                    )}
                    {mapping.branch && <span className="ml-2 text-xs text-slate-400">· {mapping.branch}</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                    {mapping.academicYear}
                    {mapping.term ? ` · ${mapping.term}` : ''}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-slate-600 dark:text-slate-300">{mapping.cos.length}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-bold capitalize ${STATUS_STYLES[mapping.status]}`}
                    >
                      {mapping.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-teal-700 dark:text-teal-300">→</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
