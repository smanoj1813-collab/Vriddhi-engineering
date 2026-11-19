// src/modules/superadmin/pages/BranchRegistry.tsx
// Super admin creates each branch once. The ID is issued by the server and is
// what colleges, students and faculty use from then on.

import React, { useCallback, useEffect, useState } from 'react';
import { GitBranch, Loader2, Plus } from 'lucide-react';
import { createBranchRegistryEntry, listBranchRegistry } from '../api/branchRegistryApi';
import type { BranchRegistryEntry } from '@/shared/utils/branchRegistry';
import { useNotification } from '../../../shared/providers/NotificationProvider';

const BranchRegistry: React.FC = () => {
  const { showSuccess, showError } = useNotification();
  const [entries, setEntries] = useState<BranchRegistryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setEntries(await listBranchRegistry());
    } catch (err: any) {
      setLoadError(err?.message || 'Could not load branches');
    } finally {
      setLoading(false);
    }
  }, []);

  // One read on mount and one after each successful add. No polling.
  useEffect(() => {
    void load();
  }, [load]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      const created = await createBranchRegistryEntry(trimmed);
      showSuccess(`Added "${created.name}" as ID ${created.branchId}`);
      setName('');
      await load();
    } catch (err: any) {
      showError(err?.message || 'Could not add the branch');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center gap-2 mb-1">
        <GitBranch className="w-5 h-5 text-teal-600" />
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Branches</h1>
      </div>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
        Create each branch once. Its ID is used when you assign branches to a college and when you onboard students and faculty.
        One ID covers a discipline: CSE is one branch whether the degree is B.E or B.Tech.
      </p>

      <form onSubmit={handleAdd} className="flex gap-2 mb-6">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., CSE"
          maxLength={120}
          className="flex-1 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm"
        />
        <button
          type="submit"
          disabled={saving || !name.trim()}
          className="inline-flex items-center gap-1 px-4 py-2 rounded-lg bg-teal-600 text-white text-sm disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Add branch
        </button>
      </form>

      {loading ? (
        <p className="text-sm text-slate-500">Loading branches…</p>
      ) : loadError ? (
        <p className="text-sm text-red-600">{loadError}</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-slate-500">No branches yet. Add the first one above.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500 border-b border-slate-200 dark:border-slate-700">
              <th className="py-2 w-20">ID</th>
              <th className="py-2">Branch</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.branchId} className="border-b border-slate-100 dark:border-slate-800">
                <td className="py-2 font-mono">{entry.branchId}</td>
                <td className="py-2 text-slate-900 dark:text-slate-100">{entry.name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default BranchRegistry;
