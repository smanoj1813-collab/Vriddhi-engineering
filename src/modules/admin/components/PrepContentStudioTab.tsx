// src/modules/admin/components/PrepContentStudioTab.tsx
//
// Superadmin Console: Prep Content Studio (BBA, B.Com, MBA PrepInsta-style Product)
// Centrally-authored academic preparation content:
//   - BBA Subjects (1st Year, 2nd Year, Final Year)
//   - Topics with 4 structured sections: Explanation, Formulas, Tricks, How To Solve
//   - AI Draft Generation (metered via platform AI pipeline)
//   - Curator Review & Publishing State Machine
//   - Practice Pool Inspection

import React, { useEffect, useRef, useState } from 'react';
import {
  BookOpen, Sparkles, Plus, Check, AlertTriangle, Loader2, RefreshCw,
  Eye, Save, Send, Database, Filter, Search, Award, FileText,
  ChevronRight, ExternalLink, HelpCircle, Layers, CheckCircle2, Circle, Trash2,
  ImagePlus
} from 'lucide-react';
import {
  fetchPrepSubjects,
  fetchPrepTopics,
  fetchPrepTopic,
  generatePrepDraft,
  publishPrepTopic,
  savePrepTopic,
  savePrepSubject,
  seedPrepCatalog,
  fetchPracticeQuestions,
  fetchPrepPapers,
  savePrepPaper,
  topicSubtopics,
  effectivePrepTrack,
  type PrepPaperSummary,
  type PrepTrack,
  type PrepSubject,
  type PrepSubtopic,
  type PrepTopic,
  type PrepFormula,
  type PrepTrick,
  type PrepHowToSolve,
  type UniversalQuestion
} from '@/shared/services/prepContentService';
import { uploadPrepImage } from '@/shared/services/prepMediaUpload';
import { insertMarkdownImage, markdownImageLine } from '@/shared/utils/prepMedia';
import { formatStreamLabel, formatDifficultyBadge } from '@/shared/utils/prepHelpers';
import CompanyPrepVisibilityPanel from '@/shared/components/prep/CompanyPrepVisibilityPanel';
import CourseAssignmentPanel from '@/shared/components/courses/CourseAssignmentPanel';
import { useColleges } from '@/modules/superadmin/hooks/useSuperAdmin';

/**
 * Every program the server ships seed data for (functions/src/routes/prep.ts
 * PREP_SEED_BUNDLES). The old UI only exposed BBA here, which is why the
 * "seeded B.Com and BA" request was impossible from the studio: BA/B.Sc/
 * M.Com/B.Com only existed behind /prep/seed-all with no button.
 */
const SEEDABLE_PROGRAMS: Array<{ code: string; label: string }> = [
  { code: 'bba', label: 'BBA' },
  { code: 'bcom', label: 'B.Com' },
  { code: 'ba', label: 'BA' },
  { code: 'bsc', label: 'B.Sc' },
  { code: 'mcom', label: 'M.Com' },
  { code: 'cse', label: 'CSE (candidate VTU core pack)' },
  { code: 'ece', label: 'ECE (candidate VTU core pack)' },
  { code: 'eee', label: 'EEE (candidate VTU core pack)' },
  { code: 'me', label: 'ME (candidate VTU core pack)' },
  { code: 'cv', label: 'Civil (candidate VTU core pack)' },
  // Supplementary, cross-university concept mastery for all programs.
  { code: 'universal', label: 'Universal Student Learning (all programs)' },
  // Shared placement-aptitude track (Quant / Reasoning / Verbal) — not a
  // program; one seed serves every UG & PG program.
  { code: 'aptitude', label: 'Aptitude (QA · LR · Verbal)' },
  // Company placement guides (TCS, Infosys, Wipro, Accenture, Capgemini,
  // Cognizant) — pattern + section→topic map over the aptitude catalogue.
  { code: 'companies', label: 'Company Prep' },
  // Previous-year university question papers (prep_papers) — structured
  // text transcribed from openly published Karnataka university papers.
  { code: 'papers', label: 'Previous Year Papers' },
  { code: 'pyq-files', label: 'Shared PYQ PDFs (English / Kannada languages)' },
];

const PAPER_SEED_TEMPLATE = `{
  "id": "bcu-bcom-3-corporate-accounting-2024-11",
  "program": "bcom",
  "university": "bcu",
  "scheme": "NEP 2021-22 onwards (F+R)",
  "semester": 3,
  "subject": "Corporate Accounting",
  "paperCode": "DCCM301",
  "examMonth": "November/December",
  "examYear": 2024,
  "durationMinutes": 150,
  "maxMarks": 60,
  "instructions": ["Answers should be written in English only."],
  "sections": [
    { "id": "A", "instruction": "Answer any FIVE of the following questions. Each question carries 2 marks.", "answer": 5, "marksEach": 2, "subLabels": true,
      "questions": ["Define share.", "What is goodwill?", "…"] },
    { "id": "B", "instruction": "Answer any FOUR of the following questions. Each question carries 5 marks.", "answer": 4, "marksEach": 5,
      "questions": ["Explain …", "…"] },
    { "id": "C", "instruction": "Answer any TWO of the following questions. Each question carries 12 marks.", "answer": 2, "marksEach": 12,
      "questions": ["…"] },
    { "id": "D", "instruction": "Answer any ONE of the following questions. Each question carries 6 marks.", "answer": 1, "marksEach": 6,
      "questions": ["…"] }
  ],
  "prepSubjectId": null,
  "source": { "title": "BCU III Sem B.Com Nov/Dec 2024 question paper", "url": "https://…pdf", "publisher": "College website", "retrievedOn": "2026-09-25" }
}`;

/**
 * Collapsible "Previous Year Papers" block: what is in prep_papers right now
 * (per program / university), a link to the public library, and a JSON box
 * to add or correct one paper without a redeploy. Bulk content still ships
 * through the seed bundle (functions/src/data/prepPapers) and the seed button.
 */
function PreviousYearPapersSection({ refreshKey }: { refreshKey: number }) {
  const [open, setOpen] = useState(false);
  const [papers, setPapers] = useState<PrepPaperSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [json, setJson] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [filter, setFilter] = useState('');

  const load = async () => {
    setError(null);
    try {
      const res = await fetchPrepPapers();
      setPapers(res.papers);
    } catch (err: any) {
      setError(err.message || 'Could not load papers');
      setPapers([]);
    }
  };

  useEffect(() => {
    if (open) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, refreshKey]);

  const byProgram = new Map<string, number>();
  const byUniversity = new Map<string, number>();
  for (const p of papers || []) {
    const label = p.legacyProgram ? `${p.programLabel}` : p.programLabel;
    byProgram.set(label, (byProgram.get(label) || 0) + 1);
    if (p.universityName) byUniversity.set(p.universityName, (byUniversity.get(p.universityName) || 0) + 1);
  }
  const q = filter.trim().toLowerCase();
  const visible = (papers || []).filter(
    (p) =>
      !q ||
      p.subjectName.toLowerCase().includes(q) ||
      p.programLabel.toLowerCase().includes(q) ||
      p.universityName.toLowerCase().includes(q) ||
      String(p.examYear).includes(q) ||
      String(p.paperCode || '').toLowerCase().includes(q),
  );

  const handleSave = async () => {
    setSaveMsg(null);
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(json);
    } catch {
      setSaveMsg({ kind: 'err', text: 'That is not valid JSON.' });
      return;
    }
    setSaving(true);
    try {
      const res = await savePrepPaper(payload);
      const warn = res.warnings.filter((w) => w.level === 'warning').map((w) => w.message).join(' ');
      setSaveMsg({ kind: 'ok', text: `Saved "${res.data.subjectName}" (${res.data.examLabel}).${warn ? ` Note: ${warn}` : ''}` });
      await load();
    } catch (err: any) {
      setSaveMsg({ kind: 'err', text: err.message || 'Save failed' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <FileText className="w-4 h-4 text-amber-600" />
          Previous year question papers
          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            — {papers ? `${papers.length} in prep_papers` : 'Structured papers and original PYQ PDFs'}
          </span>
        </span>
        <ChevronRight className={'w-4 h-4 text-slate-500 dark:text-slate-400 transition-transform ' + (open ? 'rotate-90' : '')} />
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-4 border-t border-slate-100 dark:border-slate-800 pt-4">
          {error ? <p className="text-xs text-rose-600">{error}</p> : null}
          {papers === null ? (
            <p className="text-xs text-slate-500 flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading papers…</p>
          ) : papers.length === 0 ? (
            <p className="text-xs text-slate-500">
              Nothing seeded yet. Tick <span className="font-semibold">Previous Year Papers</span> above and press Seed — the bundle ships
              with the transcribed papers and writes them to <code>prep_papers</code>.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5">
                {Array.from(byProgram.entries()).map(([label, n]) => (
                  <span key={label} className="px-2 py-1 rounded-md bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 text-[11px] font-bold">
                    {label} · {n}
                  </span>
                ))}
                {Array.from(byUniversity.entries()).map(([label, n]) => (
                  <span key={label} className="px-2 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[11px] font-semibold">
                    {label} · {n}
                  </span>
                ))}
                <a
                  href="/prep/papers"
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto inline-flex items-center gap-1 text-[11px] font-bold text-teal-700 dark:text-teal-300 hover:underline"
                >
                  Open public library <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <div className="flex items-center gap-2">
                <Search className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter by subject, program, university, year or code"
                  className="flex-1 max-w-md text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5"
                />
                <span className="text-[11px] text-slate-500 dark:text-slate-400">{visible.length} shown</span>
              </div>
              <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-100 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
                {visible.map((p) => (
                  <a
                    key={p.id}
                    href={`/prep/papers/${encodeURIComponent(p.id)}?program=${p.program}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between gap-3 px-3 py-2 text-xs hover:bg-slate-50 dark:hover:bg-slate-800/60"
                  >
                    <span className="min-w-0">
                      <span className="font-semibold text-slate-800 dark:text-slate-100">{p.subjectName}</span>
                      <span className="text-slate-500"> — {[p.programLabel, p.semester ? `Sem ${p.semester}` : '', p.universityName, p.examLabel, p.paperCode].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className="shrink-0 text-slate-500 dark:text-slate-400">
                      {p.contentType === 'source_pdf' ? 'PYQ · Original PDF' : `${p.questionCount} Q · ${p.maxMarks} marks`}{p.status !== 'published' ? ' · DRAFT' : ''}
                    </span>
                  </a>
                ))}
              </div>
            </>
          )}

          <details className="rounded-lg border border-dashed border-slate-200 dark:border-slate-700 p-3">
            <summary className="text-xs font-bold text-slate-700 dark:text-slate-200 cursor-pointer">Add or correct one paper (JSON)</summary>
            <p className="text-[11px] text-slate-500 mt-2">
              Paste a compact paper record. Sections list their rubric, how many to answer, marks each and the questions; totals
              must add up to <code>maxMarks</code>. Saving with an existing <code>id</code> updates that paper.
            </p>
            <div className="flex gap-2 mt-2">
              <button
                type="button"
                onClick={() => setJson(PAPER_SEED_TEMPLATE)}
                className="px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-[11px] font-bold text-slate-600 dark:text-slate-300"
              >
                Load template
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !json.trim()}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-teal-600 text-white text-[11px] font-bold disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                Save paper
              </button>
            </div>
            <textarea
              value={json}
              onChange={(e) => setJson(e.target.value)}
              rows={12}
              spellCheck={false}
              className="mt-2 w-full font-mono text-[11px] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 p-2"
              placeholder="{ … }"
            />
            {saveMsg ? (
              <p className={'text-[11px] mt-1 ' + (saveMsg.kind === 'ok' ? 'text-emerald-600' : 'text-rose-600')}>{saveMsg.text}</p>
            ) : null}
          </details>
        </div>
      )}
    </div>
  );
}

/**
 * Collapsible "who sees company prep" block for the Studio: superadmin picks
 * a college and flips the master / per-company switches. Kept collapsed by
 * default so the authoring workspace stays the focus.
 */
function CompanyPrepVisibilitySection() {
  const [open, setOpen] = useState(false);
  const [collegeId, setCollegeId] = useState('');
  const { data, isLoading } = useColleges({ limit: 100 }, { enabled: open });
  const colleges = (data?.items || []).slice().sort((a, b) => a.name.localeCompare(b.name));
  const selected = colleges.find((c) => c.id === collegeId);

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <Eye className="w-4 h-4 text-teal-600" />
          Company prep visibility per college
          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">— show / hide company guides for a specific college</span>
        </span>
        <ChevronRight className={'w-4 h-4 text-slate-500 dark:text-slate-400 transition-transform ' + (open ? 'rotate-90' : '')} />
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-4 border-t border-slate-100 dark:border-slate-800 pt-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 sm:w-28">College</label>
            <select
              value={collegeId}
              onChange={(e) => setCollegeId(e.target.value)}
              className="flex-1 max-w-md text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2"
            >
              <option value="">{isLoading ? 'Loading colleges…' : 'Select a college…'}</option>
              {colleges.map((c) => (
                <option key={c.id} value={c.id}>{c.name}{c.code ? ` (${c.code})` : ''}</option>
              ))}
            </select>
          </div>
          {collegeId ? (
            <CompanyPrepVisibilityPanel key={collegeId} collegeId={collegeId} collegeName={selected?.name} embedded />
          ) : (
            <p className="text-xs text-slate-500">
              Defaults: every college sees all published company guides. College admins can also change this themselves under
              <span className="font-semibold"> Settings → General → Company-specific placement prep</span>.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function CourseAssignmentsSection() {
  const [open, setOpen] = useState(false);
  const [collegeId, setCollegeId] = useState('');
  const { data, isLoading } = useColleges({ limit: 100 }, { enabled: open });
  const colleges = (data?.items || []).slice().sort((a, b) => a.name.localeCompare(b.name));
  const selected = colleges.find((c) => c.id === collegeId);

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <Award className="w-4 h-4 text-teal-600" />
          Course assignments per college
          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">— assign courses and copy student URLs</span>
        </span>
        <ChevronRight className={'w-4 h-4 text-slate-500 dark:text-slate-400 transition-transform ' + (open ? 'rotate-90' : '')} />
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-4 border-t border-slate-100 dark:border-slate-800 pt-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 sm:w-28">College</label>
            <select
              value={collegeId}
              onChange={(e) => setCollegeId(e.target.value)}
              className="flex-1 max-w-md text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2"
            >
              <option value="">{isLoading ? 'Loading colleges…' : 'Select a college…'}</option>
              {colleges.map((c) => (
                <option key={c.id} value={c.id}>{c.name}{c.code ? ` (${c.code})` : ''}</option>
              ))}
            </select>
          </div>
          {collegeId ? (
            <CourseAssignmentPanel key={collegeId} collegeId={collegeId} collegeName={selected?.name} embedded />
          ) : (
            <p className="text-xs text-slate-500">
              Course assignments default to hidden for every college. This is a platform control: pick a college above to
              assign course packs on its behalf — colleges see the result, but only the superadmin can change it.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function PrepContentStudioTab() {
  const [subjects, setSubjects] = useState<PrepSubject[]>([]);
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>('');
  const [topics, setTopics] = useState<PrepTopic[]>([]);
  const [selectedTopicId, setSelectedTopicId] = useState<string>('');
  const [activeTopic, setActiveTopic] = useState<PrepTopic | null>(null);

  const [loadingSubjects, setLoadingSubjects] = useState(false);
  const [loadingTopics, setLoadingTopics] = useState(false);
  const [loadingTopic, setLoadingTopic] = useState(false);
  const [seeding, setSeeding] = useState(false);
  // Bumped after every seed pass so the papers panel reloads its counts.
  const [seedPass, setSeedPass] = useState(0);
  // Which programs the operator has ticked for the next seed pass. Defaults
  // to existing bundles. Original-PDF PYQs are off until explicitly selected;
  // choosing a single bundle narrows the pass to that catalogue.
  const [seedSelection, setSeedSelection] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(SEEDABLE_PROGRAMS.map((p) => [p.code, p.code !== 'pyq-files']))
  );
  const [drafting, setDrafting] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Explanation "Upload image": the file picker is hidden; the textarea ref
  // gives the cursor position so the markdown line lands where the editor
  // was working (null cursor → appended at the end).
  const [uploadingImage, setUploadingImage] = useState(false);
  const explanationRef = useRef<HTMLTextAreaElement | null>(null);
  const imageFileRef = useRef<HTMLInputElement | null>(null);

  const handleUploadImage = async (file: File) => {
    if (!activeTopic) return;
    setUploadingImage(true);
    try {
      const url = await uploadPrepImage(file);
      const caption = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim() || 'Diagram';
      const line = markdownImageLine(caption, url);
      const cursor = explanationRef.current?.selectionStart ?? null;
      setActiveTopic({
        ...activeTopic,
        explanationMd: insertMarkdownImage(activeTopic.explanationMd || '', line, cursor),
      });
      showToast('ok', 'Image uploaded — the markdown line was added at your cursor. Remember to Save the topic.');
    } catch (err: any) {
      showToast('err', err?.message || 'Image upload failed.');
    } finally {
      setUploadingImage(false);
      if (imageFileRef.current) imageFileRef.current.value = '';
    }
  };

  const [filterYear, setFilterYear] = useState<string>('all');
  const [filterTrack, setFilterTrack] = useState<'all' | PrepTrack>('all');
  const [filterSemester, setFilterSemester] = useState<string>('all');
  const [filterStream, setFilterStream] = useState<string>('all');
  const [activeSection, setActiveSection] = useState<'explanation' | 'formulas' | 'tricks' | 'howToSolve' | 'practice'>('explanation');

  const [toast, setToast] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // New subject modal state
  const [showNewSubject, setShowNewSubject] = useState(false);
  const [newSubjName, setNewSubjName] = useState('');
  const [newSubjStream, setNewSubjStream] = useState('management');
  const [newSubjYear, setNewSubjYear] = useState<'1st-year' | '2nd-year' | '3rd-year' | '4th-year' | 'final-year' | 'pg-first-year' | 'pg-second-year'>('1st-year');

  // New topic modal state
  const [showNewTopic, setShowNewTopic] = useState(false);
  const [newTopicTitle, setNewTopicTitle] = useState('');
  const [newTopicDifficulty, setNewTopicDifficulty] = useState<'basic' | 'core' | 'advanced'>('core');

  // Practice test preview
  const [practicePool, setPracticePool] = useState<UniversalQuestion[]>([]);
  const [loadingPractice, setLoadingPractice] = useState(false);

  const showToast = (type: 'ok' | 'err', text: string) => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 5000);
  };

  const loadSubjects = async () => {
    setLoadingSubjects(true);
    try {
      const data = await fetchPrepSubjects();
      setSubjects(data);
      if (data.length > 0 && !selectedSubjectId) {
        setSelectedSubjectId(data[0].id);
      }
    } catch (err: any) {
      showToast('err', `Failed to load subjects: ${err.message}`);
    } finally {
      setLoadingSubjects(false);
    }
  };

  useEffect(() => {
    loadSubjects();
  }, []);

  const loadTopics = async (subjId: string) => {
    if (!subjId) return;
    setLoadingTopics(false);
    try {
      const data = await fetchPrepTopics(subjId);
      setTopics(data);
      if (data.length > 0) {
        setSelectedTopicId(data[0].id);
      } else {
        setSelectedTopicId('');
        setActiveTopic(null);
      }
    } catch (err: any) {
      showToast('err', `Failed to load topics: ${err.message}`);
    }
  };

  useEffect(() => {
    if (selectedSubjectId) {
      loadTopics(selectedSubjectId);
    }
  }, [selectedSubjectId]);

  const loadTopicDetail = async (subjId: string, topId: string) => {
    if (!subjId || !topId) return;
    setLoadingTopic(true);
    try {
      const data = await fetchPrepTopic(subjId, topId);
      setActiveTopic(data);
    } catch (err: any) {
      showToast('err', `Failed to load topic details: ${err.message}`);
    } finally {
      setLoadingTopic(false);
    }
  };

  useEffect(() => {
    if (selectedSubjectId && selectedTopicId) {
      loadTopicDetail(selectedSubjectId, selectedTopicId);
    }
  }, [selectedSubjectId, selectedTopicId]);

  const selectedSeedCodes = SEEDABLE_PROGRAMS
    .filter((p) => seedSelection[p.code])
    .map((p) => p.code);

  const toggleSeedProgram = (code: string) => {
    setSeedSelection((prev) => ({ ...prev, [code]: !prev[code] }));
  };

  const handleSeed = async () => {
    const codes = selectedSeedCodes;
    if (codes.length === 0) {
      showToast('err', 'Tick at least one program to seed.');
      return;
    }
    const labels = SEEDABLE_PROGRAMS.filter((p) => codes.includes(p.code)).map((p) => p.label).join(', ');
    if (codes.includes('pyq-files') && !confirm('Publish the prepared original-PDF PYQ links? Languages include only English and Kannada. No university is assigned; exam details and question text are not inferred. Existing records are preserved; only missing file links are added.')) return;
    if (!confirm(`Seed/refresh the ${codes.length === SEEDABLE_PROGRAMS.length ? 'complete' : 'selected'} catalogue (${labels})? Existing subjects and topics are updated in place.`)) return;
    setSeeding(true);
    try {
      const res = await seedPrepCatalog(codes);
      const integrity = res.perProgram
        .filter((p) => !p.valid)
        .map((p) => `${p.label} (${p.errorCount} integrity note${p.errorCount === 1 ? '' : 's'})`)
        .join('; ');
      showToast('ok', res.message + (integrity ? ` Review: ${integrity}.` : ''));
      await loadSubjects();
      setSeedPass((n) => n + 1);
    } catch (err: any) {
      showToast('err', `Seeding failed: ${err.message}`);
    } finally {
      setSeeding(false);
    }
  };

  const handleCreateSubject = async () => {
    if (!newSubjName.trim()) return;
    const slug = `bba-${newSubjName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    try {
      await savePrepSubject({
        id: slug,
        name: newSubjName.trim(),
        stream: newSubjStream as any,
        programs: ['bba'],
        yearGroup: newSubjYear,
        icon: 'BookOpen',
        order: subjects.length + 1,
      });
      showToast('ok', `Subject "${newSubjName}" created!`);
      setShowNewSubject(false);
      setNewSubjName('');
      await loadSubjects();
      setSelectedSubjectId(slug);
    } catch (err: any) {
      showToast('err', `Create subject failed: ${err.message}`);
    }
  };

  const handleCreateTopic = async () => {
    if (!newTopicTitle.trim() || !selectedSubjectId) return;
    const slug = `${selectedSubjectId}-${newTopicTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    try {
      await savePrepTopic({
        subjectId: selectedSubjectId,
        topicId: slug,
        title: newTopicTitle.trim(),
        order: topics.length + 1,
        difficulty: newTopicDifficulty,
        status: 'draft',
        tier: 'free',
        contentVersion: 1,
        explanationMd: `### ${newTopicTitle}\n\nDraft concept explanation for ${newTopicTitle}. Click "Generate AI Draft" to populate all 4 sections through the AI pipeline.`,
        formulas: [],
        tricks: [],
        howToSolve: [],
        featuredQuestionIds: [],
      });
      showToast('ok', `Topic "${newTopicTitle}" created!`);
      setShowNewTopic(false);
      setNewTopicTitle('');
      await loadTopics(selectedSubjectId);
      setSelectedTopicId(slug);
    } catch (err: any) {
      showToast('err', `Create topic failed: ${err.message}`);
    }
  };

  const handleGenerateDraft = async () => {
    if (!activeTopic || !selectedSubjectId) return;
    setDrafting(true);
    try {
      const res = await generatePrepDraft({
        subjectId: selectedSubjectId,
        topicId: activeTopic.id,
        title: activeTopic.title,
        stream: subjects.find((s) => s.id === selectedSubjectId)?.stream || 'management',
        difficulty: activeTopic.difficulty,
        program: 'bba',
      });
      setActiveTopic(res.data);
      showToast('ok', `AI draft created via ${res.provider}! (${res.tokensIn + res.tokensOut} tokens)`);
      await loadTopics(selectedSubjectId);
    } catch (err: any) {
      showToast('err', `Draft generation failed: ${err.message}`);
    } finally {
      setDrafting(false);
    }
  };

  // Sub-topic rows edited in the meta panel. Legacy topics only have a
  // `subtopics` title list; `topicSubtopics` synthesises empty briefs for them.
  const subtopicRows: PrepSubtopic[] = topicSubtopics(activeTopic);
  const nextSubtopicId = () => `sub-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`;
  const updateSubtopics = (rows: PrepSubtopic[]) => {
    if (!activeTopic) return;
    setActiveTopic({
      ...activeTopic,
      subtopicDetails: rows,
      subtopics: rows.map((r) => r.title),
    });
  };

  const handleSaveTopic = async () => {
    if (!activeTopic || !selectedSubjectId) return;
    setSaving(true);
    try {
      // Drop rows with no title; trim what remains. The API mirrors titles
      // back into `subtopics` for older readers.
      const cleanedSubtopics = subtopicRows
        .map((r) => ({ id: r.id, title: r.title.trim(), briefMd: r.briefMd.trim() }))
        .filter((r) => r.title.length > 0);
      await savePrepTopic({
        ...activeTopic,
        subtopicDetails: cleanedSubtopics,
        subtopics: cleanedSubtopics.map((r) => r.title),
        subjectId: selectedSubjectId,
        topicId: activeTopic.id,
      });
      showToast('ok', 'Topic content saved successfully.');
      await loadTopics(selectedSubjectId);
    } catch (err: any) {
      showToast('err', `Save failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handlePublishTopic = async () => {
    if (!activeTopic || !selectedSubjectId) return;
    setPublishing(true);
    try {
      await publishPrepTopic({
        subjectId: selectedSubjectId,
        topicId: activeTopic.id,
      });
      showToast('ok', `Topic "${activeTopic.title}" is now PUBLISHED platform-wide!`);
      await loadTopics(selectedSubjectId);
      await loadTopicDetail(selectedSubjectId, activeTopic.id);
      await loadSubjects();
    } catch (err: any) {
      showToast('err', `Publish failed: ${err.message}`);
    } finally {
      setPublishing(false);
    }
  };

  const handleLoadPracticePool = async () => {
    if (!activeTopic) return;
    setLoadingPractice(true);
    try {
      const data = await fetchPracticeQuestions({ topicId: activeTopic.id, count: 10 });
      setPracticePool(data);
    } catch (err: any) {
      showToast('err', `Failed to load practice pool: ${err.message}`);
    } finally {
      setLoadingPractice(false);
    }
  };

  const filteredSubjects = subjects.filter((s) => {
    const track = effectivePrepTrack(s);
    if (filterTrack !== 'all' && track !== filterTrack) return false;
    // Shared aptitude subjects have no year / semester; the academic filters
    // must not hide them.
    if (track === 'academic') {
      if (filterYear !== 'all' && s.yearGroup !== filterYear) return false;
      if (filterSemester !== 'all' && s.semester !== Number(filterSemester)) return false;
    }
    if (filterStream !== 'all' && s.stream !== filterStream) return false;
    return true;
  });

  const selectedSubject = subjects.find((s) => s.id === selectedSubjectId);

  return (
    <div className="space-y-6">
      {/* Toast Alert */}
      {toast && (
        <div
          className={`p-4 rounded-xl text-xs font-semibold flex items-center justify-between border ${
            toast.type === 'ok'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300'
              : 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {toast.type === 'ok' ? <Check className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
            <span>{toast.text}</span>
          </div>
          <button onClick={() => setToast(null)} className="text-slate-500 dark:text-slate-400 hover:text-slate-600">×</button>
        </div>
      )}

      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-teal-600" />
            Prep Content Studio (Academic Study & Concept Mastery)
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Concept-first explanations and worked problem-solving that supplement—not replace—any college or university curriculum. Authored once: AI draft → Curator review → Publish.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {SEEDABLE_PROGRAMS.map((p) => {
              const active = seedSelection[p.code];
              return (
                <button
                  key={p.code}
                  onClick={() => toggleSeedProgram(p.code)}
                  disabled={seeding}
                  aria-pressed={active}
                  className={
                    'inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-bold transition-colors ' +
                    (active
                      ? 'bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 border-teal-300 dark:border-teal-700'
                      : 'bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:text-slate-700 dark:hover:text-slate-300')
                  }
                >
                  {active ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Circle className="w-3.5 h-3.5" />}
                  {p.label}
                </button>
              );
            })}
          </div>
          <button
            onClick={handleSeed}
            disabled={seeding || selectedSeedCodes.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-bold hover:bg-teal-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {seeding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Database className="w-3.5 h-3.5" />}
            {seeding
              ? 'Seeding Catalog…'
              : selectedSeedCodes.length === SEEDABLE_PROGRAMS.length
                ? 'Seed All Programs'
                : `Seed ${selectedSeedCodes.length} Selected`}
          </button>
          <button
            onClick={() => setShowNewSubject(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-white dark:bg-white dark:text-slate-900 text-xs font-bold hover:opacity-90 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            New Subject
          </button>
        </div>
      </div>

      {/* Company prep visibility per college */}
      <CompanyPrepVisibilitySection />
      <CourseAssignmentsSection />

      {/* Previous-year university question papers */}
      <PreviousYearPapersSection refreshKey={seedPass} />

      {/* Studio Workspace Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Subjects & Topics Navigation */}
        <div className="lg:col-span-4 space-y-4">
          {/* Filters */}
          <div className="p-3 bg-white dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700/50 flex items-center gap-2 text-xs">
            <Filter className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 shrink-0" />
            <select
              value={filterTrack}
              onChange={(e) => setFilterTrack(e.target.value as 'all' | PrepTrack)}
              aria-label="Track"
              className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-slate-700 dark:text-slate-200"
            >
              <option value="all">All Tracks</option>
              <option value="academic">Academic</option>
              <option value="aptitude">Aptitude</option>
            </select>
            <select
              value={filterYear}
              onChange={(e) => setFilterYear(e.target.value)}
              className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-slate-700 dark:text-slate-200 w-1/2"
            >
              <option value="all">All Years</option>
              <option value="1st-year">1st Year</option>
              <option value="2nd-year">2nd Year</option>
              <option value="3rd-year">3rd Year</option>
              <option value="4th-year">4th Year</option>
              <option value="final-year">Final Year</option>
              <option value="pg-first-year">PG 1st Year</option>
              <option value="pg-second-year">PG 2nd Year</option>
            </select>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Semester:</span>
              <select
                value={filterSemester}
                onChange={(e) => setFilterSemester(e.target.value)}
                className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-slate-700 dark:text-slate-200 text-xs"
              >
                <option value="all">All Semesters (1–8)</option>
                <option value="1">Sem 1 (1st Year)</option>
                <option value="2">Sem 2 (1st Year)</option>
                <option value="3">Sem 3 (2nd Year)</option>
                <option value="4">Sem 4 (2nd Year)</option>
                <option value="5">Sem 5 (3rd Year)</option>
                <option value="6">Sem 6 (3rd Year)</option>
                <option value="7">Sem 7 (4th Year)</option>
                <option value="8">Sem 8 (4th Year)</option>
              </select>
            </div>
          </div>

          {/* Subject Selector */}
          <div className="bg-white dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700/50 p-3 max-h-72 overflow-y-auto space-y-1.5">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 px-2 pb-1">
              Subjects ({filteredSubjects.length})
            </div>
            {loadingSubjects ? (
              <div className="p-4 text-center text-xs text-slate-500 dark:text-slate-400">Loading subjects…</div>
            ) : filteredSubjects.length === 0 ? (
              <div className="p-4 text-center text-xs text-slate-500 dark:text-slate-400">No subjects found. Tick a program, the Universal Student Learning pack or the Aptitude track above and press "Seed".</div>
            ) : (
              filteredSubjects.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSelectedSubjectId(s.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-xs font-semibold flex items-center justify-between transition-colors ${
                    selectedSubjectId === s.id
                      ? 'bg-teal-50 dark:bg-teal-950/50 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <div className="truncate pr-2">
                    <p className="truncate font-bold">{s.name}</p>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400">
                      {effectivePrepTrack(s) === 'aptitude'
                        ? `Placement aptitude · all programs`
                        : `${formatStreamLabel(s.stream)} · ${s.yearGroup || 'All'}`}
                    </p>
                  </div>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-mono">
                    {s.topicCount || 0}
                  </span>
                </button>
              ))
            )}
          </div>

          {/* Topics for Selected Subject */}
          <div className="bg-white dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700/50 p-3 space-y-2">
            <div className="flex items-center justify-between px-2 pb-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Topics ({topics.length})
              </span>
              <button
                onClick={() => setShowNewTopic(true)}
                disabled={!selectedSubjectId}
                className="text-[11px] text-teal-600 hover:text-teal-700 font-bold flex items-center gap-1"
              >
                <Plus className="w-3 h-3" /> Add Topic
              </button>
            </div>

            <div className="max-h-80 overflow-y-auto space-y-1">
              {loadingTopics ? (
                <div className="p-4 text-center text-xs text-slate-500 dark:text-slate-400">Loading topics…</div>
              ) : topics.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-500 dark:text-slate-400">No topics in this subject yet.</div>
              ) : (
                topics.map((t) => {
                  const badge = formatDifficultyBadge(t.difficulty);
                  return (
                    <button
                      key={t.id}
                      onClick={() => setSelectedTopicId(t.id)}
                      className={`w-full text-left px-3 py-2 rounded-lg text-xs flex items-center justify-between transition-colors ${
                        selectedTopicId === t.id
                          ? 'bg-slate-100 dark:bg-slate-700/60 font-bold text-slate-900 dark:text-white'
                          : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                      }`}
                    >
                      <span className="truncate pr-2">{t.title}</span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${badge.bg} ${badge.color}`}>
                          {badge.label}
                        </span>
                        <span
                          className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                            t.status === 'published'
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                              : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                          }`}
                        >
                          {t.status}
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Topic Editor & Section Preview */}
        <div className="lg:col-span-8 space-y-4">
          {activeTopic ? (
            <div className="bg-white dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700/50 p-6 space-y-5">
              {/* Topic Action Bar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-800">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-slate-900 dark:text-white">{activeTopic.title}</h3>
                    <span
                      className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full ${
                        activeTopic.status === 'published'
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300'
                          : 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300'
                      }`}
                    >
                      {activeTopic.status}
                    </span>
                    <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400">v{activeTopic.contentVersion || 1}</span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Subject: {selectedSubject?.name} · Difficulty: {activeTopic.difficulty} · Tier: {activeTopic.tier}
                  </p>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={handleGenerateDraft}
                    disabled={drafting}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800 text-xs font-bold hover:bg-purple-100 transition-colors"
                  >
                    {drafting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-purple-600" />}
                    {drafting ? 'Generating AI Pack…' : 'Generate AI Draft'}
                  </button>

                  <button
                    onClick={handleSaveTopic}
                    disabled={saving}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold hover:bg-slate-200 transition-colors"
                  >
                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    Save Edits
                  </button>

                  <button
                    onClick={handlePublishTopic}
                    disabled={publishing || activeTopic.status === 'published'}
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors disabled:opacity-50"
                  >
                    {publishing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                    {activeTopic.status === 'published' ? 'Published' : 'Publish to Platform'}
                  </button>
                </div>
              </div>

              {/* Module & Granular Subtopics Meta */}
              <div className="bg-slate-50 dark:bg-slate-900/60 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-500">Module:</span>
                    <input
                      type="text"
                      value={activeTopic.moduleName || ''}
                      onChange={(e) => setActiveTopic({ ...activeTopic, moduleName: e.target.value })}
                      placeholder="e.g. Module 1: Management Foundations"
                      className="px-2 py-1 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold w-72"
                    />
                  </div>
                  {selectedSubject?.syllabusRef && (
                    <span className="text-[11px] font-mono text-teal-600 dark:text-teal-400">
                      {selectedSubject.syllabusRef}
                    </span>
                  )}
                </div>

                <div>
                  <div className="flex items-center justify-between pb-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Sub-topics &amp; briefs ({subtopicRows.length})
                    </span>
                    <button
                      type="button"
                      onClick={() => updateSubtopics([...subtopicRows, { id: nextSubtopicId(), title: '', briefMd: '' }])}
                      className="text-[10px] text-teal-600 font-bold hover:underline"
                    >
                      + Add Sub-topic
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-2">
                    Each sub-topic gets a title and a 1–3 sentence brief. Briefs are shown to learners on the public topic page under “What this topic covers”.
                  </p>
                  {subtopicRows.length > 0 ? (
                    <div className="space-y-2">
                      {subtopicRows.map((st, sIdx) => (
                        <div
                          key={st.id || sIdx}
                          className="rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-2.5"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400 w-5 shrink-0">{sIdx + 1}.</span>
                            <input
                              type="text"
                              value={st.title}
                              onChange={(e) => {
                                const next = subtopicRows.slice();
                                next[sIdx] = { ...st, title: e.target.value };
                                updateSubtopics(next);
                              }}
                              placeholder="Sub-topic title, e.g. Successive discounts"
                              className="flex-1 px-2 py-1 rounded bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-semibold"
                            />
                            <button
                              type="button"
                              onClick={() => updateSubtopics(subtopicRows.filter((_, idx) => idx !== sIdx))}
                              aria-label={`Remove sub-topic ${sIdx + 1}`}
                              className="text-slate-500 dark:text-slate-400 hover:text-rose-500 font-bold px-1"
                            >
                              ×
                            </button>
                          </div>
                          <textarea
                            value={st.briefMd}
                            onChange={(e) => {
                              const next = subtopicRows.slice();
                              next[sIdx] = { ...st, briefMd: e.target.value };
                              updateSubtopics(next);
                            }}
                            rows={2}
                            placeholder="Brief: what a learner should know about this sub-topic (markdown allowed)."
                            className="mt-1.5 w-full px-2 py-1.5 rounded bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[11px] leading-relaxed resize-y"
                          />
                          {st.title.trim() && st.briefMd.trim().length < 20 && (
                            <span className="text-[10px] text-amber-600 dark:text-amber-400">Add a brief (≥ 20 characters) so this sub-topic explains itself.</span>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 italic">No sub-topics defined yet.</span>
                  )}
                </div>
              </div>

              {/* Five Content Tabs */}
              <div className="flex border-b border-slate-200 dark:border-slate-700">
                {(['explanation', 'formulas', 'tricks', 'howToSolve', 'practice'] as const).map((tab) => {
                  const labels = {
                    explanation: 'Explanation (MD)',
                    formulas: `Formulas (${activeTopic.formulas?.length || 0})`,
                    tricks: `Shortcuts & Tricks (${activeTopic.tricks?.length || 0})`,
                    howToSolve: `How to Solve (${activeTopic.howToSolve?.length || 0})`,
                    practice: 'Practice Questions',
                  };
                  return (
                    <button
                      key={tab}
                      onClick={() => {
                        setActiveSection(tab);
                        if (tab === 'practice') handleLoadPracticePool();
                      }}
                      className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-colors ${
                        activeSection === tab
                          ? 'border-teal-600 text-teal-600 dark:text-teal-400'
                          : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                      }`}
                    >
                      {labels[tab]}
                    </button>
                  );
                })}
              </div>

              {/* Section 1: Explanation Markdown */}
              {activeSection === 'explanation' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                    <span>Comprehensive Markdown Explanation (curriculum-aligned)</span>
                    <div className="flex items-center gap-2">
                      <span className="hidden sm:inline">Markdown · KaTeX · images</span>
                      <input
                        ref={imageFileRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void handleUploadImage(file);
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => imageFileRef.current?.click()}
                        disabled={uploadingImage}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-600 px-2.5 py-1 font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
                        title="Upload a diagram (PNG/JPEG/WebP/GIF, max 4 MB) and insert it at your cursor"
                      >
                        {uploadingImage ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <ImagePlus className="w-3.5 h-3.5" />
                        )}
                        {uploadingImage ? 'Uploading…' : 'Upload image'}
                      </button>
                    </div>
                  </div>
                  <textarea
                    ref={explanationRef}
                    rows={16}
                    value={activeTopic.explanationMd || ''}
                    onChange={(e) => setActiveTopic({ ...activeTopic, explanationMd: e.target.value })}
                    className="w-full font-mono text-xs p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500"
                    placeholder={'Enter academic explanation in Markdown...\n\nVisuals: use "Upload image" above, or paste  ![Caption](https://image-url)  on its own line.'}
                  />
                </div>
              )}

              {/* Section 2: Formulas */}
              {activeSection === 'formulas' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-600 dark:text-slate-300">
                      Formula Sheet / Governing Formulations
                    </span>
                    <button
                      onClick={() => {
                        const newF: PrepFormula = {
                          id: `formula-${(activeTopic.formulas?.length || 0) + 1}`,
                          label: 'New Formula',
                          formula: 'Equation = X / Y',
                          exampleQ: 'Sample Question',
                          exampleA: 'Step-by-step solution',
                        };
                        setActiveTopic({
                          ...activeTopic,
                          formulas: [...(activeTopic.formulas || []), newF],
                        });
                      }}
                      className="text-xs text-teal-600 font-bold hover:underline flex items-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add Formula
                    </button>
                  </div>

                  {activeTopic.formulas?.length === 0 ? (
                    <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400 border border-dashed rounded-xl">
                      No formula cards added for this topic yet.
                    </div>
                  ) : (
                    activeTopic.formulas.map((f, i) => (
                      <div key={f.id || i} className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50 space-y-3">
                        <div className="flex items-center justify-between">
                          <input
                            type="text"
                            value={f.label}
                            onChange={(e) => {
                              const updated = [...activeTopic.formulas];
                              updated[i] = { ...updated[i], label: e.target.value };
                              setActiveTopic({ ...activeTopic, formulas: updated });
                            }}
                            className="font-bold text-xs bg-white dark:bg-slate-800 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 w-2/3"
                            placeholder="Formula label..."
                          />
                          <button
                            onClick={() => {
                              const updated = activeTopic.formulas.filter((_, idx) => idx !== i);
                              setActiveTopic({ ...activeTopic, formulas: updated });
                            }}
                            className="text-slate-500 dark:text-slate-400 hover:text-rose-500"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <div>
                          <label className="text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400">Formula / Equation</label>
                          <input
                            type="text"
                            value={f.formula}
                            onChange={(e) => {
                              const updated = [...activeTopic.formulas];
                              updated[i] = { ...updated[i], formula: e.target.value };
                              setActiveTopic({ ...activeTopic, formulas: updated });
                            }}
                            className="font-mono text-xs w-full bg-white dark:bg-slate-800 px-2 py-1.5 rounded border border-slate-200 dark:border-slate-700 text-teal-600 dark:text-teal-400 font-semibold"
                            placeholder="Formula equation..."
                          />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                          <div>
                            <label className="text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400">Example Question</label>
                            <textarea
                              rows={2}
                              value={f.exampleQ}
                              onChange={(e) => {
                                const updated = [...activeTopic.formulas];
                                updated[i] = { ...updated[i], exampleQ: e.target.value };
                                setActiveTopic({ ...activeTopic, formulas: updated });
                              }}
                              className="text-xs w-full bg-white dark:bg-slate-800 p-2 rounded border border-slate-200 dark:border-slate-700"
                              placeholder="Example question..."
                            />
                          </div>
                          <div>
                            <label className="text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400">Solution / Answer</label>
                            <textarea
                              rows={2}
                              value={f.exampleA}
                              onChange={(e) => {
                                const updated = [...activeTopic.formulas];
                                updated[i] = { ...updated[i], exampleA: e.target.value };
                                setActiveTopic({ ...activeTopic, formulas: updated });
                              }}
                              className="text-xs w-full bg-white dark:bg-slate-800 p-2 rounded border border-slate-200 dark:border-slate-700"
                              placeholder="Solution..."
                            />
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Section 3: Tricks */}
              {activeSection === 'tricks' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-600 dark:text-slate-300">
                      Shortcuts, Mnemonics & Exam Tricks
                    </span>
                    <button
                      onClick={() => {
                        const newT: PrepTrick = {
                          id: `trick-${(activeTopic.tricks?.length || 0) + 1}`,
                          title: 'New Exam Shortcut',
                          trick: 'Mnemonic or shortcut description',
                          whenToUse: 'When solving semester examination MCQs',
                        };
                        setActiveTopic({
                          ...activeTopic,
                          tricks: [...(activeTopic.tricks || []), newT],
                        });
                      }}
                      className="text-xs text-teal-600 font-bold hover:underline flex items-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add Trick
                    </button>
                  </div>

                  {activeTopic.tricks?.length === 0 ? (
                    <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400 border border-dashed rounded-xl">
                      No shortcuts or tricks added yet.
                    </div>
                  ) : (
                    activeTopic.tricks.map((t, i) => (
                      <div key={t.id || i} className="p-4 rounded-xl border border-amber-200/60 dark:border-amber-900/40 bg-amber-50/40 dark:bg-amber-950/20 space-y-2">
                        <div className="flex items-center justify-between">
                          <input
                            type="text"
                            value={t.title}
                            onChange={(e) => {
                              const updated = [...activeTopic.tricks];
                              updated[i] = { ...updated[i], title: e.target.value };
                              setActiveTopic({ ...activeTopic, tricks: updated });
                            }}
                            className="font-bold text-xs bg-white dark:bg-slate-800 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 w-2/3"
                          />
                          <button
                            onClick={() => {
                              const updated = activeTopic.tricks.filter((_, idx) => idx !== i);
                              setActiveTopic({ ...activeTopic, tricks: updated });
                            }}
                            className="text-slate-500 dark:text-slate-400 hover:text-rose-500"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <textarea
                          rows={2}
                          value={t.trick}
                          onChange={(e) => {
                            const updated = [...activeTopic.tricks];
                            updated[i] = { ...updated[i], trick: e.target.value };
                            setActiveTopic({ ...activeTopic, tricks: updated });
                          }}
                          className="text-xs w-full bg-white dark:bg-slate-800 p-2 rounded border border-slate-200 dark:border-slate-700"
                          placeholder="Shortcut / mnemonic..."
                        />
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400">When to use:</span>
                          <input
                            type="text"
                            value={t.whenToUse}
                            onChange={(e) => {
                              const updated = [...activeTopic.tricks];
                              updated[i] = { ...updated[i], whenToUse: e.target.value };
                              setActiveTopic({ ...activeTopic, tricks: updated });
                            }}
                            className="text-xs flex-1 bg-white dark:bg-slate-800 px-2 py-1 rounded border border-slate-200 dark:border-slate-700"
                          />
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Section 4: How To Solve */}
              {activeSection === 'howToSolve' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-600 dark:text-slate-300">
                      Step-by-Step Problem Solving Framework
                    </span>
                    <button
                      onClick={() => {
                        const newH: PrepHowToSolve = {
                          id: `step-${(activeTopic.howToSolve?.length || 0) + 1}`,
                          step: `Step ${(activeTopic.howToSolve?.length || 0) + 1}`,
                          detail: 'Execution details',
                          questionType: 'Standard 10-Mark Question',
                        };
                        setActiveTopic({
                          ...activeTopic,
                          howToSolve: [...(activeTopic.howToSolve || []), newH],
                        });
                      }}
                      className="text-xs text-teal-600 font-bold hover:underline flex items-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add Step
                    </button>
                  </div>

                  {activeTopic.howToSolve?.length === 0 ? (
                    <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400 border border-dashed rounded-xl">
                      No step framework defined yet.
                    </div>
                  ) : (
                    activeTopic.howToSolve.map((h, i) => (
                      <div key={h.id || i} className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50 space-y-2">
                        <div className="flex items-center justify-between">
                          <input
                            type="text"
                            value={h.step}
                            onChange={(e) => {
                              const updated = [...activeTopic.howToSolve];
                              updated[i] = { ...updated[i], step: e.target.value };
                              setActiveTopic({ ...activeTopic, howToSolve: updated });
                            }}
                            className="font-bold text-xs bg-white dark:bg-slate-800 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 w-1/2"
                          />
                          <input
                            type="text"
                            value={h.questionType}
                            onChange={(e) => {
                              const updated = [...activeTopic.howToSolve];
                              updated[i] = { ...updated[i], questionType: e.target.value };
                              setActiveTopic({ ...activeTopic, howToSolve: updated });
                            }}
                            className="text-xs text-slate-500 bg-white dark:bg-slate-800 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 w-1/3 text-right"
                            placeholder="Question type..."
                          />
                          <button
                            onClick={() => {
                              const updated = activeTopic.howToSolve.filter((_, idx) => idx !== i);
                              setActiveTopic({ ...activeTopic, howToSolve: updated });
                            }}
                            className="text-slate-500 dark:text-slate-400 hover:text-rose-500"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <textarea
                          rows={2}
                          value={h.detail}
                          onChange={(e) => {
                            const updated = [...activeTopic.howToSolve];
                            updated[i] = { ...updated[i], detail: e.target.value };
                            setActiveTopic({ ...activeTopic, howToSolve: updated });
                          }}
                          className="text-xs w-full bg-white dark:bg-slate-800 p-2 rounded border border-slate-200 dark:border-slate-700"
                          placeholder="Detailed instructions for this step..."
                        />
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Section 5: Practice Pool */}
              {activeSection === 'practice' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-600 dark:text-slate-300">
                      Practice Pool (Sampled from Universal Question Bank)
                    </span>
                    <button
                      onClick={handleLoadPracticePool}
                      disabled={loadingPractice}
                      className="text-xs text-teal-600 font-bold hover:underline flex items-center gap-1"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${loadingPractice ? 'animate-spin' : ''}`} />
                      Refresh Sample
                    </button>
                  </div>

                  {practicePool.length === 0 ? (
                    <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400 border border-dashed rounded-xl">
                      {loadingPractice ? 'Sampling questions…' : 'No practice questions matched. Click Refresh Sample.'}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {practicePool.map((q, i) => (
                        <div key={q.id || i} className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs space-y-2">
                          <p className="font-bold text-slate-900 dark:text-white">
                            Q{i + 1}. {q.questionText}
                          </p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pl-2">
                            {q.options?.map((opt, oIdx) => (
                              <div
                                key={oIdx}
                                className={`px-2 py-1 rounded text-[11px] ${
                                  oIdx === q.correctIndex
                                    ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-bold border border-emerald-200 dark:border-emerald-800'
                                    : 'text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/40'
                                }`}
                              >
                                {String.fromCharCode(65 + oIdx)}. {opt}
                              </div>
                            ))}
                          </div>
                          <p className="text-[11px] text-slate-500 pt-1 border-t border-slate-100 dark:border-slate-800">
                            <strong>Explanation:</strong> {q.explanation}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="p-12 text-center bg-white dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700/50 space-y-3">
              <BookOpen className="w-8 h-8 text-slate-400 dark:text-slate-400 mx-auto" />
              <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300">Select a Topic from the Left Panel</h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
                Select any BBA subject and topic to view or edit the explanation, formula sheet, tricks, and step-by-step solver.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* New Subject Modal */}
      {showNewSubject && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 max-w-md w-full space-y-4 border border-slate-200 dark:border-slate-700 shadow-xl">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">Create New Prep Subject</h3>
            <div className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-slate-500 block mb-1">Subject Name *</label>
                <input
                  type="text"
                  value={newSubjName}
                  onChange={(e) => setNewSubjName(e.target.value)}
                  placeholder="e.g. Corporate Finance"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                />
              </div>
              <div>
                <label className="font-bold text-slate-500 block mb-1">Stream *</label>
                <select
                  value={newSubjStream}
                  onChange={(e) => setNewSubjStream(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                >
                  <option value="management">Management</option>
                  <option value="commerce">Commerce</option>
                  <option value="economics">Economics</option>
                  <option value="aptitude">Aptitude / Quant</option>
                  <option value="finance">Finance</option>
                  <option value="law">Business Law</option>
                  <option value="strategy">Strategic Management</option>
                  <option value="operations">Operations Management</option>
                  <option value="taxation">Taxation</option>
                </select>
              </div>
              <div>
                <label className="font-bold text-slate-500 block mb-1">Year Group *</label>
                <select
                  value={newSubjYear}
                  onChange={(e) => setNewSubjYear(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                >
                  <option value="1st-year">1st Year</option>
                  <option value="2nd-year">2nd Year</option>
                  <option value="3rd-year">3rd Year</option>
                  <option value="4th-year">4th Year</option>
                  <option value="final-year">Final Year</option>
                  <option value="pg-first-year">PG 1st Year</option>
                  <option value="pg-second-year">PG 2nd Year</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowNewSubject(false)}
                className="px-4 py-2 rounded-lg text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateSubject}
                className="px-4 py-2 rounded-lg text-xs font-bold bg-teal-600 text-white hover:bg-teal-700"
              >
                Create Subject
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Topic Modal */}
      {showNewTopic && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 max-w-md w-full space-y-4 border border-slate-200 dark:border-slate-700 shadow-xl">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">Add Topic to {selectedSubject?.name}</h3>
            <div className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-slate-500 block mb-1">Topic Title *</label>
                <input
                  type="text"
                  value={newTopicTitle}
                  onChange={(e) => setNewTopicTitle(e.target.value)}
                  placeholder="e.g. Ratio Analysis & Solvency Ratios"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                />
              </div>
              <div>
                <label className="font-bold text-slate-500 block mb-1">Difficulty *</label>
                <select
                  value={newTopicDifficulty}
                  onChange={(e) => setNewTopicDifficulty(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                >
                  <option value="basic">Basic (Foundation)</option>
                  <option value="core">Core (Standard University)</option>
                  <option value="advanced">Advanced (Analytical / Case)</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowNewTopic(false)}
                className="px-4 py-2 rounded-lg text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateTopic}
                className="px-4 py-2 rounded-lg text-xs font-bold bg-teal-600 text-white hover:bg-teal-700"
              >
                Create Topic
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
