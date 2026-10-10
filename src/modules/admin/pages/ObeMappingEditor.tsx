// OBE mapping editor: course identity, CO authoring, the CO→PO/PSO
// correlation matrix, targets, validation, publish — and the attainment runs
// panel underneath. Drafts are editable; published mappings lock into
// read-only evidence (the principal always sees the read-only view).

import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  ChevronLeft,
  Info,
  Loader2,
  Lock,
  Plus,
  Save,
  Trash2,
  Upload,
} from 'lucide-react';
import { useAuth } from '@/modules/auth/context/AuthContext';
import { roleHasPermission } from '@/modules/auth/permissions';
import type { ObeCourseOutcome, ObeMappingDoc, ObeMappingMatrix } from '@/shared/types/obe';
import { BLOOM_LEVELS, GAPC_V4_PROGRAM_OUTCOMES } from '@/shared/types/obe';
import { validateMapping } from '@/shared/utils/obeAttainment';
import {
  archiveObeMapping,
  fetchObeMapping,
  publishObeMapping,
  saveObeMapping,
  type SaveObeMappingPayload,
} from '../api/obeApi';
import { ObeMatrixGrid } from '../components/obe/ObeMatrixGrid';
import { ObeRunsPanel } from '../components/obe/ObeRunsPanel';

const PO_CODES = GAPC_V4_PROGRAM_OUTCOMES.map((po) => po.code);
const PO_TITLES = new Map(GAPC_V4_PROGRAM_OUTCOMES.map((po) => [po.code, po.title]));
const DEFAULT_PSOS = 'PSO1, PSO2';

function currentAcademicYear(): string {
  const now = new Date();
  const year = now.getFullYear();
  const start = now.getMonth() >= 5 ? year : year - 1;
  return `${start}-${String(start + 1).slice(2)}`;
}

interface Draft {
  courseCode: string;
  courseTitle: string;
  academicYear: string;
  term: string;
  programId: string;
  branch: string;
  facultyId: string;
  credits: string;
  psos: string;
  cos: ObeCourseOutcome[];
  mapping: ObeMappingMatrix;
  targets: Record<string, string>;
  coTargets: Record<string, string>;
}

function blankDraft(): Draft {
  return {
    courseCode: '',
    courseTitle: '',
    academicYear: currentAcademicYear(),
    term: '',
    programId: '',
    branch: '',
    facultyId: '',
    credits: '',
    psos: DEFAULT_PSOS,
    cos: [],
    mapping: {},
    targets: {},
    coTargets: {},
  };
}

function fromDoc(doc: ObeMappingDoc): Draft {
  const storedPsos = [...new Set(Object.values(doc.mapping ?? {}).flatMap((row) => Object.keys(row ?? {})))]
    .filter((code) => code.startsWith('PSO'))
    .sort();
  const numRecord = (record?: Record<string, number>): Record<string, string> =>
    Object.fromEntries(Object.entries(record ?? {}).map(([key, value]) => [key, String(value)]));
  return {
    courseCode: doc.courseCode ?? '',
    courseTitle: doc.courseTitle ?? '',
    academicYear: doc.academicYear ?? currentAcademicYear(),
    term: doc.term ?? '',
    programId: doc.programId ?? '',
    branch: doc.branch ?? '',
    facultyId: doc.facultyId ?? '',
    credits: doc.credits != null ? String(doc.credits) : '',
    psos: storedPsos.length ? storedPsos.join(', ') : DEFAULT_PSOS,
    cos: (doc.cos ?? []).map((co) => ({ ...co })),
    mapping: JSON.parse(JSON.stringify(doc.mapping ?? {})) as ObeMappingMatrix,
    targets: numRecord(doc.targets),
    coTargets: numRecord(doc.coTargets),
  };
}

function toPayload(draft: Draft): SaveObeMappingPayload {
  const nums = (record: Record<string, string>): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const [key, raw] of Object.entries(record)) {
      if (!raw.trim()) continue;
      const value = Number(raw);
      if (Number.isFinite(value)) out[key] = value;
    }
    return out;
  };
  return {
    framework: 'NBA-GAPC-v4.0',
    courseCode: draft.courseCode.trim(),
    courseTitle: draft.courseTitle.trim(),
    academicYear: draft.academicYear.trim(),
    term: draft.term.trim(),
    programId: draft.programId.trim(),
    branch: draft.branch.trim(),
    facultyId: draft.facultyId.trim(),
    ...(draft.credits.trim() ? { credits: Number(draft.credits) } : {}),
    cos: draft.cos.map((co) => ({
      code: co.code.trim().toUpperCase(),
      statement: co.statement.trim(),
      ...(co.bloomLevel ? { bloomLevel: co.bloomLevel } : {}),
    })),
    mapping: draft.mapping,
    targets: nums(draft.targets),
    coTargets: nums(draft.coTargets),
  };
}

const FIELD =
  'mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 disabled:opacity-60';
const LABEL = 'text-xs font-bold uppercase tracking-wide text-slate-500';
const CARD = 'rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900';

export default function ObeMappingEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canManage = roleHasPermission(user?.role, 'obe.manage');
  const isNew = !id || id === 'new';

  const mappingQuery = useQuery({
    queryKey: ['obeMapping', id],
    queryFn: () => fetchObeMapping(id!),
    enabled: !isNew,
  });
  const stored: ObeMappingDoc | null = mappingQuery.data ?? null;
  const published = stored?.status === 'published';
  const archived = stored?.status === 'archived';
  const canEdit = canManage && (isNew || stored?.status === 'draft');

  const [draft, setDraft] = useState<Draft | null>(isNew ? blankDraft() : null);
  const [busy, setBusy] = useState<'save' | 'publish' | 'archive' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (stored && !draft) setDraft(fromDoc(stored));
    // Initialise the editable copy once — refetches must not clobber typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored]);

  const set = (patch: Partial<Draft>) => {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
    setNotice(null);
  };

  const columns = useMemo(() => {
    if (!draft) return [];
    const configured = draft.psos
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    const extras = [...new Set(Object.values(draft.mapping).flatMap((row) => Object.keys(row ?? {})))].filter(
      (code) => !PO_CODES.includes(code) && !configured.includes(code),
    );
    return [...PO_CODES, ...configured, ...extras.sort()];
  }, [draft]);

  const validation = useMemo(() => {
    if (!draft) return { valid: false, errors: [], warnings: [] };
    return validateMapping(draft.mapping, draft.cos.map((c) => c.code.trim().toUpperCase()).filter(Boolean), columns);
  }, [draft, columns]);

  async function handleSave() {
    if (!draft || busy) return;
    setBusy('save');
    setError(null);
    setNotice(null);
    try {
      const result = await saveObeMapping(toPayload(draft));
      await queryClient.invalidateQueries({ queryKey: ['obeMappings'] });
      if (isNew) {
        navigate(`/admin/obe/${result.id}`, { replace: true });
      } else {
        await queryClient.invalidateQueries({ queryKey: ['obeMapping', id] });
        setNotice('Draft saved.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed. Check the fields and try again.');
    } finally {
      setBusy(null);
    }
  }

  async function handlePublish() {
    if (!draft || busy || isNew) return;
    if (validation.errors.length > 0) {
      setError('Resolve the mapping errors below before publishing — published mappings become evidence.');
      return;
    }
    if (!window.confirm('Publish this mapping? It locks into read-only evidence and freezes the pack rules.')) return;
    setBusy('publish');
    setError(null);
    try {
      await publishObeMapping(id!);
      await queryClient.invalidateQueries({ queryKey: ['obeMapping', id] });
      await queryClient.invalidateQueries({ queryKey: ['obeMappings'] });
      setNotice('Published — the mapping is now locked evidence. Compute runs below.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Publish failed. The server enforces full completeness.');
    } finally {
      setBusy(null);
    }
  }

  async function handleArchive() {
    if (busy || isNew) return;
    if (!window.confirm('Archive this draft? It leaves the active list (published evidence is never archived).')) return;
    setBusy('archive');
    setError(null);
    try {
      await archiveObeMapping(id!);
      await queryClient.invalidateQueries({ queryKey: ['obeMappings'] });
      navigate('/admin/obe');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Archive failed.');
    } finally {
      setBusy(null);
    }
  }

  function addCo() {
    if (!draft) return;
    const taken = new Set(draft.cos.map((c) => c.code.trim().toUpperCase()));
    let n = draft.cos.length + 1;
    while (taken.has(`CO${n}`)) n += 1;
    set({ cos: [...draft.cos, { code: `CO${n}`, statement: '', bloomLevel: '' }] });
  }

  function updateCo(index: number, patch: Partial<ObeCourseOutcome>) {
    if (!draft) return;
    const cos = draft.cos.map((co, i) => (i === index ? { ...co, ...patch } : co));
    set({ cos });
  }

  function removeCo(index: number) {
    if (!draft) return;
    const code = draft.cos[index]?.code.trim().toUpperCase();
    const cos = draft.cos.filter((_, i) => i !== index);
    const mapping = { ...draft.mapping };
    if (code) delete mapping[code];
    const coTargets = { ...draft.coTargets };
    if (code) delete coTargets[code];
    set({ cos, mapping, coTargets });
  }

  function setCell(co: string, outcome: string, value: number) {
    if (!draft) return;
    const row = { ...(draft.mapping[co] ?? {}) };
    if (value === 0) delete row[outcome];
    else row[outcome] = value;
    set({ mapping: { ...draft.mapping, [co]: row } });
  }

  if (!isNew && mappingQuery.isLoading) {
    return (
      <div className="mx-auto max-w-6xl p-6">
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 size={16} className="animate-spin" /> Loading mapping…
        </p>
      </div>
    );
  }
  if (!isNew && (mappingQuery.isError || !stored)) {
    return (
      <div className="mx-auto max-w-6xl space-y-3 p-6">
        <Link to="/admin/obe" className="inline-flex items-center gap-1 text-sm font-semibold text-teal-700">
          <ChevronLeft size={16} /> OBE attainment
        </Link>
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          Mapping not found or unavailable.{' '}
          <button type="button" onClick={() => void mappingQuery.refetch()} className="font-bold underline">
            Try again
          </button>
          .
        </div>
      </div>
    );
  }
  if (!draft) return null;

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/admin/obe" className="inline-flex items-center gap-1 text-sm font-semibold text-teal-700 dark:text-teal-300">
            <ChevronLeft size={16} /> OBE attainment
          </Link>
          <h1 className="mt-1 text-xl font-bold text-slate-800 dark:text-slate-100">
            {isNew ? 'New course mapping' : `${stored!.courseCode} · ${stored!.academicYear}${stored!.term ? ` · ${stored!.term}` : ''}`}
          </h1>
          {!isNew && (
            <p className="mt-1 text-sm capitalize text-slate-500">
              Status: <strong>{stored!.status}</strong>
              {stored!.rulesSnapshot && (
                <span className="normal-case">
                  {' '}· {stored!.rulesSnapshot.coThresholdPercentage}% threshold,{' '}
                  {Math.round(stored!.rulesSnapshot.directWeight * 100)}/
                  {Math.round(stored!.rulesSnapshot.indirectWeight * 100)} blend
                </span>
              )}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit && !isNew && (
            <button
              type="button"
              onClick={() => void handleArchive()}
              disabled={busy !== null}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {busy === 'archive' ? <Loader2 size={16} className="animate-spin" /> : <Archive size={16} />} Archive
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={busy !== null}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-bold text-white hover:bg-slate-900 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
            >
              {busy === 'save' ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save draft
            </button>
          )}
          {canEdit && !isNew && !published && !archived && (
            <button
              type="button"
              onClick={() => void handlePublish()}
              disabled={busy !== null}
              className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-bold text-white hover:bg-teal-700 disabled:opacity-50"
            >
              {busy === 'publish' ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />} Publish
            </button>
          )}
        </div>
      </div>

      {published && (
        <p className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
          <Lock size={16} className="mt-0.5 shrink-0" />
          Published — this mapping is locked evidence. Runs below freeze it together with marks and rules for the SAR.
        </p>
      )}
      {archived && (
        <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <Archive size={16} className="mt-0.5 shrink-0" /> Archived — read-only. Create a new mapping for the next term.
        </p>
      )}
      {!canManage && !published && (
        <p className="flex items-start gap-2 rounded-xl bg-slate-100 p-3 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          <Info size={16} className="mt-0.5 shrink-0" /> You have read-only access — the department owns this draft.
        </p>
      )}
      {error && (
        <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
          {notice}
        </p>
      )}

      <section className={CARD}>
        <h2 className="text-base font-bold text-slate-800 dark:text-slate-100">Course</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block">
            <span className={LABEL}>Course code *</span>
            <input value={draft.courseCode} disabled={!canEdit} onChange={(e) => set({ courseCode: e.target.value })} placeholder="CS301" className={FIELD} />
          </label>
          <label className="block sm:col-span-2 lg:col-span-1">
            <span className={LABEL}>Course title</span>
            <input value={draft.courseTitle} disabled={!canEdit} onChange={(e) => set({ courseTitle: e.target.value })} placeholder="Data Structures" className={FIELD} />
          </label>
          <label className="block">
            <span className={LABEL}>Academic year *</span>
            <input value={draft.academicYear} disabled={!canEdit} onChange={(e) => set({ academicYear: e.target.value })} placeholder="2025-26" className={FIELD} />
          </label>
          <label className="block">
            <span className={LABEL}>Term</span>
            <input value={draft.term} disabled={!canEdit} onChange={(e) => set({ term: e.target.value })} placeholder="Odd / Even / 5th sem" className={FIELD} />
          </label>
          <label className="block">
            <span className={LABEL}>Program</span>
            <input value={draft.programId} disabled={!canEdit} onChange={(e) => set({ programId: e.target.value })} placeholder="B.E. CSE" className={FIELD} />
          </label>
          <label className="block">
            <span className={LABEL}>Branch / Dept</span>
            <input value={draft.branch} disabled={!canEdit} onChange={(e) => set({ branch: e.target.value })} placeholder="Computer Science" className={FIELD} />
          </label>
          <label className="block">
            <span className={LABEL}>Faculty</span>
            <input value={draft.facultyId} disabled={!canEdit} onChange={(e) => set({ facultyId: e.target.value })} placeholder="Course teacher" className={FIELD} />
          </label>
          <label className="block">
            <span className={LABEL}>Credits</span>
            <input type="number" min={0} max={10} step={0.5} value={draft.credits} disabled={!canEdit} onChange={(e) => set({ credits: e.target.value })} placeholder="e.g. 4" className={FIELD} />
          </label>
        </div>
      </section>

      <section className={CARD}>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-800 dark:text-slate-100">Course outcomes ({draft.cos.length})</h2>
          {canEdit && (
            <button type="button" onClick={addCo} className="inline-flex items-center gap-1 text-sm font-bold text-teal-700 dark:text-teal-300">
              <Plus size={16} /> Add CO
            </button>
          )}
        </div>
        {draft.cos.length === 0 && (
          <p className="mt-3 text-sm text-slate-500">No COs yet — most courses define 4–6 (NBA norm).</p>
        )}
        <div className="mt-3 space-y-3">
          {draft.cos.map((co, index) => (
            <div key={`${co.code}-${index}`} className="grid gap-2 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60 sm:grid-cols-[90px_1fr_130px_40px] sm:items-start">
              <input
                value={co.code}
                disabled={!canEdit}
                onChange={(e) => updateCo(index, { code: e.target.value })}
                placeholder="CO1"
                aria-label="CO code"
                className="rounded-lg border border-slate-200 bg-white px-2 py-2 font-mono text-sm font-bold dark:border-slate-700 dark:bg-slate-800"
              />
              <textarea
                value={co.statement}
                disabled={!canEdit}
                onChange={(e) => updateCo(index, { statement: e.target.value })}
                placeholder="e.g. Apply sorting and searching algorithms to solve computational problems."
                rows={2}
                aria-label="CO statement"
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              />
              <select
                value={co.bloomLevel ?? ''}
                disabled={!canEdit}
                onChange={(e) => updateCo(index, { bloomLevel: e.target.value })}
                aria-label="Bloom level"
                className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              >
                <option value="">Bloom…</option>
                {BLOOM_LEVELS.map((level) => (
                  <option key={level.code} value={level.code}>
                    {level.code} · {level.label}
                  </option>
                ))}
              </select>
              {canEdit ? (
                <button
                  type="button"
                  onClick={() => removeCo(index)}
                  title="Remove CO"
                  className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                >
                  <Trash2 size={16} />
                </button>
              ) : (
                <span />
              )}
            </div>
          ))}
        </div>
      </section>

      <section className={CARD}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-bold text-slate-800 dark:text-slate-100">CO → PO/PSO matrix</h2>
          <label className="flex items-center gap-2 text-xs text-slate-500">
            PSOs (comma-separated)
            <input
              value={draft.psos}
              disabled={!canEdit}
              onChange={(e) => set({ psos: e.target.value })}
              placeholder="PSO1, PSO2"
              className="w-44 rounded-lg border border-slate-200 bg-white px-2 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-800"
            />
          </label>
        </div>
        <div className="mt-3">
          <ObeMatrixGrid
            cos={draft.cos}
            outcomes={columns.map((code) => ({ code, title: PO_TITLES.get(code) ?? (code.startsWith('PSO') ? 'Programme-specific outcome' : code) }))}
            mapping={draft.mapping}
            onChange={setCell}
            readOnly={!canEdit}
          />
        </div>
      </section>

      <section className={CARD}>
        <h2 className="text-base font-bold text-slate-800 dark:text-slate-100">Targets (0–3, optional)</h2>
        <p className="mt-1 text-xs text-slate-500">Attainment at or above target counts as “attained” in SAR tables.</p>
        <h3 className="mt-3 text-xs font-bold uppercase tracking-wide text-slate-500">PO / PSO targets</h3>
        <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {columns.map((code) => (
            <label key={code} className="block rounded-lg bg-slate-50 p-2 dark:bg-slate-800/60">
              <span className="font-mono text-xs font-bold text-slate-600 dark:text-slate-300" title={PO_TITLES.get(code)}>
                {code}
              </span>
              <input
                type="number"
                min={0}
                max={3}
                step={0.1}
                value={draft.targets[code] ?? ''}
                disabled={!canEdit}
                onChange={(e) => set({ targets: { ...draft.targets, [code]: e.target.value } })}
                placeholder="–"
                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-sm tabular-nums dark:border-slate-700 dark:bg-slate-800"
              />
            </label>
          ))}
        </div>
        {draft.cos.length > 0 && (
          <>
            <h3 className="mt-4 text-xs font-bold uppercase tracking-wide text-slate-500">CO targets</h3>
            <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-7">
              {draft.cos.map((co) => {
                const code = co.code.trim().toUpperCase() || 'CO?';
                return (
                  <label key={code} className="block rounded-lg bg-slate-50 p-2 dark:bg-slate-800/60">
                    <span className="font-mono text-xs font-bold text-slate-600 dark:text-slate-300">{code}</span>
                    <input
                      type="number"
                      min={0}
                      max={3}
                      step={0.1}
                      value={draft.coTargets[code] ?? ''}
                      disabled={!canEdit}
                      onChange={(e) => set({ coTargets: { ...draft.coTargets, [code]: e.target.value } })}
                      placeholder="–"
                      className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-sm tabular-nums dark:border-slate-700 dark:bg-slate-800"
                    />
                  </label>
                );
              })}
            </div>
          </>
        )}
      </section>

      <section className={CARD}>
        <h2 className="text-base font-bold text-slate-800 dark:text-slate-100">Checks</h2>
        {validation.errors.length === 0 && validation.warnings.length === 0 ? (
          <p className="mt-2 flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 size={16} /> Mapping is complete — every CO is mapped with valid 1–3 correlations.
          </p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {validation.errors.map((message) => (
              <li key={message} className="flex items-start gap-2 font-semibold text-rose-700 dark:text-rose-400">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {message}
              </li>
            ))}
            {validation.warnings.map((message) => (
              <li key={message} className="flex items-start gap-2 text-amber-700 dark:text-amber-400">
                <Info size={16} className="mt-0.5 shrink-0" /> {message}
              </li>
            ))}
          </ul>
        )}
        {validation.errors.length > 0 && (
          <p className="mt-2 text-xs text-slate-500">
            Drafts save with gaps — publishing requires zero errors (the server enforces it too).
          </p>
        )}
      </section>

      {!isNew && stored && <ObeRunsPanel mapping={stored} canCompute={canManage && published} />}
    </div>
  );
}
