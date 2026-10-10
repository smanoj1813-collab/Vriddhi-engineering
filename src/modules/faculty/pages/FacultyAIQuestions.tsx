// src/modules/faculty/pages/FacultyAIQuestions.tsx
// AI Question Studio: generate, EDIT every question, add manually, save to bank.

import { useState, useEffect } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import {
  Sparkles, Wand2, Loader2, Copy, Check, AlertCircle, Save, Plus, Trash2, Edit3, X, BookOpen, ArrowRight
} from 'lucide-react';
import { useAIQuestionGenerator } from '../../admin/hooks/useAIQuestionGenerator';
import { useAuth } from '../../auth/context/AuthContext';
import type { GeneratedQuestion, QuestionType, DifficultyLevel } from '../../admin/types/questionBank';
import { SUPPORTED_LANGUAGES } from '@/shared/i18n';
import { useLanguage } from '@/shared/contexts/LanguageProvider';

function blankQuestion(subject: string): GeneratedQuestion {
  return {
    text: '',
    type: 'mcq',
    difficulty: 'medium',
    subject,
    marks: 1,
    options: [
      { id: 'A', text: '', isCorrect: true },
      { id: 'B', text: '', isCorrect: false },
      { id: 'C', text: '', isCorrect: false },
      { id: 'D', text: '', isCorrect: false },
    ],
    correctAnswer: 'A',
    explanation: '',
  };
}

export default function FacultyAIQuestions() {
  const { user } = useAuth();
  const { language: uiLanguage, t } = useLanguage();
  const { generate, saveAll, generating, saving, error } = useAIQuestionGenerator();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const [subject, setSubject] = useState('');
  const [topic, setTopic] = useState('');
  const [prefilledBanner, setPrefilledBanner] = useState<string | null>(null);

  // Prefill from curriculum → AI one-stop: /faculty/ai-questions?subject=X&topic=Y or location.state
  useEffect(() => {
    const qSubject = searchParams.get('subject') || (location.state as any)?.subject || '';
    const qTopic = searchParams.get('topic') || (location.state as any)?.topic || '';
    if (qSubject) setSubject(qSubject);
    if (qTopic) setTopic(qTopic);
    if (qSubject || qTopic) {
      setPrefilledBanner(qTopic ? `Prefilled from curriculum: ${qSubject} — ${qTopic}` : `Prefilled from curriculum: ${qSubject}`);
    }
  }, [searchParams, location.state]);
  const [language, setLanguage] = useState(uiLanguage);
  const [difficulty, setDifficulty] = useState<DifficultyLevel>('medium');
  const [count, setCount] = useState(5);
  const [provider, setProvider] = useState<'gemini' | 'openai' | 'deepseek'>('gemini');
  const [questions, setQuestions] = useState<GeneratedQuestion[]>([]);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [saveMessage, setSaveMessage] = useState('');
  // Survives the staged-questions clear: confirms WHERE the save landed, with
  // a direct route into the bank, so a successful save never feels like the
  // questions vanished.
  const [saveSummary, setSaveSummary] = useState<{ count: number; subject: string } | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualQ, setManualQ] = useState<GeneratedQuestion>(blankQuestion(''));
  const [localLoading, setLocalLoading] = useState(false);
  const loading = generating || localLoading;

  // ─── Generate ───
  const generateQuestions = async () => {
    if (!topic.trim()) return;
    setLocalLoading(true);
    setSaveMessage('');
    try {
      const result = await generate({
        subject: subject.trim() || topic.trim(),
        topic: topic.trim(),
        questionType: 'mcq',
        difficulty,
        count,
        marks: 1,
        language,
        includeExplanation: true,
        batch: '',
        branch: '',
        provider,
      } as any);
      setQuestions(result.questions);
    } catch (err: any) {
      console.error('[FacultyAI] Generate failed:', err);
      // error is surfaced by the hook
    } finally {
      setLocalLoading(false);
    }
  };

  // ─── Save all — FIX: use collegeId from user, not subject/topic as batch/branch
  const saveGenerated = async () => {
    if (questions.length === 0) return;
    setSaveMessage('');
    setSaveSummary(null);
    try {
      // saveAll signature is (questions, batch, branch) — we pass empty batch/branch
      // and let convertAllToQuestionData use collegeId from auth context
      const saved = await saveAll(questions, '', '');
      if (saved.length === 0) {
        setSaveMessage(`Saved 0/${questions.length} — check console for [saveAll] Errors. Likely Firestore rules or missing collegeId.`);
        return;
      }
      setSaveSummary({ count: saved.length, subject: saved[0]?.subject || subject || 'General' });
      // Clear the staging list only after a confirmed save; the summary panel
      // below stays so the user can navigate straight to the saved questions.
      setQuestions([]);
    } catch (err: any) {
      console.error('[FacultyAI] Save failed:', err);
      const msg = err?.message || '';
      if (msg.includes('Missing or insufficient permissions') || msg.includes('permission')) {
        setSaveMessage(`Save failed: Firestore rules blocked. Ensure faculty doc has collegeId and role. Error: ${msg}`);
      } else if (msg.includes('collegeId')) {
        setSaveMessage(`Save failed: collegeId missing. Check faculty profile. ${msg}`);
      } else {
        setSaveMessage(`Failed to save: ${msg || 'Please try again.'}`);
      }
    }
  };

  // ─── Edit a question ───
  const updateQuestion = (idx: number, patch: Partial<GeneratedQuestion>) => {
    setQuestions(prev => prev.map((q, i) => (i === idx ? { ...q, ...patch } : q)));
  };

  const updateOption = (qIdx: number, optIdx: number, text: string) => {
    setQuestions(prev => prev.map((q, i) => {
      if (i !== qIdx || !q.options) return q;
      const opts = [...q.options];
      opts[optIdx] = { ...opts[optIdx], text };
      return { ...q, options: opts };
    }));
  };

  const setCorrectOption = (qIdx: number, optId: string) => {
    setQuestions(prev => prev.map((q, i) => {
      if (i !== qIdx || !q.options) return q;
      const opts = q.options.map(o => ({ ...o, isCorrect: o.id === optId }));
      return { ...q, options: opts, correctAnswer: optId };
    }));
  };

  const deleteQuestion = (idx: number) => {
    setQuestions(prev => prev.filter((_, i) => i !== idx));
    setEditingIndex(null);
  };

  // ─── Manual add ───
  const addManualQuestion = () => {
    const q = { ...manualQ, subject: subject || manualQ.subject || 'General' };
    setQuestions(prev => [...prev, q]);
    setManualQ(blankQuestion(subject));
    setShowManualForm(false);
  };

  const copyToClipboard = (text: string, idx: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(idx);
    setTimeout(() => setCopiedIndex(null), 1500);
  };

  return (
    <div className="min-h-full p-6">
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 rounded-lg bg-violet-500/10 text-violet-400">
            <Sparkles size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('ai.title')}</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {t('ai.facultySubtitle')}
            </p>
          </div>
        </div>
        {user?.name && <p className="text-xs text-slate-500 dark:text-slate-400">Signed in as {user.name}</p>}
        {prefilledBanner && (
          <div className="mt-3 p-3 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center gap-2 text-sm text-violet-700 dark:text-violet-300">
            <BookOpen size={16} className="text-violet-400 shrink-0" />
            <span>{prefilledBanner}</span>
            <button onClick={() => setPrefilledBanner(null)} className="ml-auto text-violet-400 hover:text-violet-600">×</button>
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <a href="/faculty/curriculum" className="text-xs px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:text-teal-600 flex items-center gap-1">
            <BookOpen size={14} /> My Curriculum <ArrowRight size={12} />
          </a>
          <a href="/faculty/topics" className="text-xs px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:text-teal-600 flex items-center gap-1">
            <BookOpen size={14} /> Topics <ArrowRight size={12} />
          </a>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ─── Config Panel ─── */}
        <div className="glass-card p-6 lg:col-span-1">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
            <Wand2 size={18} className="text-violet-400" />
            {t('ai.configuration')}
          </h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('ai.subject')}</label>
              <input type="text" value={subject} onChange={e => setSubject(e.target.value)}
                placeholder="e.g. Financial Accounting" className="input-field w-full" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('ai.topic')}</label>
              <input type="text" value={topic} onChange={e => setTopic(e.target.value)}
                placeholder="e.g. Double Entry Bookkeeping" className="input-field w-full" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('ai.difficulty')}</label>
              <select value={difficulty} onChange={e => setDifficulty(e.target.value as DifficultyLevel)} className="input-field w-full">
                <option value="easy">{t('ai.easy')}</option>
                <option value="medium">{t('ai.medium')}</option>
                <option value="hard">{t('ai.hard')}</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('ai.language')}</label>
              <select value={language} onChange={e => setLanguage(e.target.value as typeof language)} className="input-field w-full">
                {SUPPORTED_LANGUAGES.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.nativeName} · {lang.englishName}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-slate-400 mt-1">{t('ai.languageHint')}</p>
            </div>
            {/* Provider selector — only visible to superadmin to avoid confusion, faculty auto-uses best available */}
            {user?.role === 'superadmin' && (
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">AI Provider (Admin)</label>
                <select value={provider} onChange={e => setProvider(e.target.value as any)} className="input-field w-full">
                  <option value="gemini">Gemini (Google) — Free</option>
                  <option value="openai">OpenAI GPT-4o — High Quality</option>
                  <option value="deepseek">DeepSeek — Balanced</option>
                </select>
                <p className="text-[11px] text-slate-400 mt-1">
                  Faculty auto-uses best available. Set keys in functions/.env
                </p>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('ai.count')}</label>
              <input type="number" min={1} max={20} value={count}
                onChange={e => setCount(Number(e.target.value))} className="input-field w-full" />
            </div>
            <button onClick={generateQuestions} disabled={loading || !topic.trim()}
              className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50">
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              {loading ? t('ai.generating') : t('ai.generate')}
            </button>

            {/* ─── Manual Add Button ─── */}
            <button onClick={() => { setShowManualForm(true); setManualQ(blankQuestion(subject)); }}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border-2 border-dashed border-violet-400/40 text-violet-400 hover:bg-violet-500/10 transition-colors text-sm font-medium">
              <Plus size={16} />
              {t('ai.addManually')}
            </button>

            {questions.length > 0 && (
              <button onClick={saveGenerated} disabled={saving}
                className="btn-primary w-full flex items-center justify-center gap-2 bg-teal-500 disabled:opacity-50">
                <Save size={16} />
                {saving ? t('ai.saving') : t('ai.saveAllToBank', { count: questions.length })}
              </button>
            )}
            {saveMessage && <p className="text-xs text-teal-400">{saveMessage}</p>}
            {saveSummary && (
              <div className="mt-3 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-2">
                <p className="text-xs text-emerald-600 dark:text-emerald-300 font-semibold flex items-center gap-1.5">
                  <Check size={14} />
                  Saved {saveSummary.count} question{saveSummary.count !== 1 ? 's' : ''} to the Question Bank
                  {saveSummary.subject ? ` under “${saveSummary.subject}”` : ''}.
                </p>
                <div className="flex items-center gap-2">
                  <Link
                    to="/faculty/universal-bank"
                    className="text-[11px] px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-700 inline-flex items-center gap-1"
                  >
                    Open Universal Bank <ArrowRight size={12} />
                  </Link>
                  <button
                    onClick={() => setSaveSummary(null)}
                    className="text-[11px] text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ─── Questions Panel ─── */}
        <div className="lg:col-span-2 space-y-4">
          {error && (
            <div className="flex items-start gap-3 p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400">
              <AlertCircle size={18} className="mt-0.5 shrink-0" />
              <p className="text-sm">{error}</p>
            </div>
          )}

          {/* ─── Manual Form ─── */}
          {showManualForm && (
            <div className="glass-card p-6 border-2 border-violet-500/30">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Plus size={18} className="text-violet-400" />
                  Add Question Manually
                </h3>
                <button onClick={() => setShowManualForm(false)}
                  className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500">
                  <X size={16} />
                </button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Question Text</label>
                  <textarea rows={3} value={manualQ.text}
                    onChange={e => setManualQ(p => ({ ...p, text: e.target.value }))}
                    placeholder="Type your question here..."
                    className="input-field w-full resize-none" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Type</label>
                    <select value={manualQ.type}
                      onChange={e => setManualQ(p => ({ ...p, type: e.target.value as QuestionType }))}
                      className="input-field w-full">
                      <option value="mcq">MCQ</option>
                      <option value="short_answer">Short Answer</option>
                      <option value="long_answer">Long Answer</option>
                      <option value="true_false">True/False</option>
                      <option value="fill_in_blank">Fill in the Blank</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Difficulty</label>
                    <select value={manualQ.difficulty}
                      onChange={e => setManualQ(p => ({ ...p, difficulty: e.target.value as DifficultyLevel }))}
                      className="input-field w-full">
                      <option value="easy">Easy</option>
                      <option value="medium">Medium</option>
                      <option value="hard">Hard</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Marks</label>
                  <input type="number" min={1} value={manualQ.marks}
                    onChange={e => setManualQ(p => ({ ...p, marks: Number(e.target.value) }))}
                    className="input-field w-full max-w-[120px]" />
                </div>
                {manualQ.type === 'mcq' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Options (click radio for correct answer)</label>
                    <div className="space-y-2">
                      {(manualQ.options || []).map((opt, oi) => (
                        <div key={oi} className="flex items-center gap-2">
                          <input type="radio" name="manual-correct"
                            checked={opt.isCorrect}
                            onChange={() => {
                              const opts = (manualQ.options || []).map((o, j) => ({ ...o, isCorrect: j === oi }));
                              setManualQ(p => ({ ...p, options: opts, correctAnswer: String.fromCharCode(65 + oi) }));
                            }}
                            className="shrink-0" />
                          <span className="text-xs text-slate-400 w-4">{opt.id || String.fromCharCode(65 + oi)}</span>
                          <input type="text" value={opt.text}
                            onChange={e => {
                              const opts = [...(manualQ.options || [])];
                              opts[oi] = { ...opts[oi], text: e.target.value };
                              setManualQ(p => ({ ...p, options: opts }));
                            }}
                            placeholder={`Option ${String.fromCharCode(65 + oi)}`}
                            className="input-field flex-1 text-sm" />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {(manualQ.type === 'short_answer' || manualQ.type === 'fill_in_blank') && (
                  <div>
                    <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Correct Answer</label>
                    <input type="text" value={typeof manualQ.correctAnswer === 'string' ? manualQ.correctAnswer : ''}
                      onChange={e => setManualQ(p => ({ ...p, correctAnswer: e.target.value }))}
                      className="input-field w-full" />
                  </div>
                )}
                <div>
                  <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Explanation (optional)</label>
                  <input type="text" value={manualQ.explanation || ''}
                    onChange={e => setManualQ(p => ({ ...p, explanation: e.target.value }))}
                    className="input-field w-full" />
                </div>
                <button onClick={addManualQuestion} disabled={!manualQ.text.trim()}
                  className="btn-primary flex items-center gap-2 disabled:opacity-50">
                  <Plus size={16} />
                  Add to List
                </button>
              </div>
            </div>
          )}

          {/* ─── Generated / Edited Questions ─── */}
          <div className="glass-card p-6">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">
              Questions {questions.length > 0 && <span className="text-sm font-normal text-slate-500">({questions.length})</span>}
            </h3>
            {questions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-500">
                <AlertCircle size={32} className="mb-3 opacity-50" />
                <p>{t('ai.noQuestions')}</p>
                <p className="text-sm">{t('ai.noQuestionsHint')}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {questions.map((q, i) => (
                  <div key={q.id || i}
                    className="p-4 rounded-xl bg-slate-100/50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700">
                    {editingIndex === i ? (
                      // ─── EDIT MODE ───
                      <div className="space-y-3">
                        <div>
                          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Question</label>
                          <textarea rows={2} value={q.text}
                            onChange={e => updateQuestion(i, { text: e.target.value })}
                            className="input-field w-full resize-none text-sm" />
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <select value={q.type}
                            onChange={e => updateQuestion(i, { type: e.target.value as QuestionType })}
                            className="input-field text-sm">
                            <option value="mcq">MCQ</option>
                            <option value="short_answer">Short Answer</option>
                            <option value="long_answer">Long Answer</option>
                            <option value="true_false">True/False</option>
                            <option value="fill_in_blank">Fill in Blank</option>
                          </select>
                          <select value={q.difficulty}
                            onChange={e => updateQuestion(i, { difficulty: e.target.value as DifficultyLevel })}
                            className="input-field text-sm">
                            <option value="easy">Easy</option>
                            <option value="medium">Medium</option>
                            <option value="hard">Hard</option>
                          </select>
                          <input type="number" min={1} value={q.marks}
                            onChange={e => updateQuestion(i, { marks: Number(e.target.value) })}
                            className="input-field text-sm" placeholder="Marks" />
                        </div>
                        {q.type === 'mcq' && q.options && (
                          <div className="space-y-2">
                            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Options (radio = correct)</label>
                            {q.options.map((opt, oi) => (
                              <div key={oi} className="flex items-center gap-2">
                                <input type="radio" name={`correct-${i}`}
                                  checked={opt.isCorrect}
                                  onChange={() => setCorrectOption(i, opt.id || String.fromCharCode(65 + oi))}
                                  className="shrink-0" />
                                <span className="text-xs text-slate-400 w-4">{opt.id || String.fromCharCode(65 + oi)}</span>
                                <input type="text" value={opt.text}
                                  onChange={e => updateOption(i, oi, e.target.value)}
                                  className="input-field flex-1 text-sm" />
                              </div>
                            ))}
                          </div>
                        )}
                        <div>
                          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Explanation</label>
                          <input type="text" value={q.explanation || ''}
                            onChange={e => updateQuestion(i, { explanation: e.target.value })}
                            className="input-field w-full text-sm" />
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => setEditingIndex(null)}
                            className="px-3 py-1.5 rounded-lg bg-teal-500/20 text-teal-400 text-sm hover:bg-teal-500/30">
                            Done Editing
                          </button>
                          <button onClick={() => deleteQuestion(i)}
                            className="px-3 py-1.5 rounded-lg bg-rose-500/20 text-rose-400 text-sm hover:bg-rose-500/30">
                            Delete
                          </button>
                        </div>
                      </div>
                    ) : (
                      // ─── READ MODE ───
                      <div className="flex items-start gap-3">
                        <span className="text-violet-400 font-bold text-sm shrink-0">{i + 1}.</span>
                        <div className="flex-1">
                          <p className="text-sm text-slate-800 dark:text-slate-200">
                            {q.text}
                            <span className="ml-2 text-xs text-slate-400">
                              [{q.difficulty}] {q.type} · {q.marks} mark{q.marks !== 1 ? 's' : ''}
                            </span>
                          </p>
                          {q.options && q.options.length > 0 && (
                            <ul className="mt-2 space-y-1 text-xs text-slate-600 dark:text-slate-300">
                              {q.options.map((opt, oi) => (
                                <li key={opt.id || oi} className={opt.isCorrect ? 'font-semibold text-teal-500' : ''}>
                                  {opt.id || String.fromCharCode(65 + oi)}. {opt.text}
                                  {opt.isCorrect && ' ✓'}
                                </li>
                              ))}
                            </ul>
                          )}
                          {q.explanation && (
                            <p className="mt-1 text-xs text-slate-400 italic">Explanation: {q.explanation}</p>
                          )}
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <button onClick={() => setEditingIndex(i)}
                            className="p-2 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 transition-colors"
                            title="Edit">
                            <Edit3 size={14} />
                          </button>
                          <button onClick={() => copyToClipboard(q.text, i)}
                            className="p-2 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 transition-colors"
                            title="Copy">
                            {copiedIndex === i ? <Check size={14} className="text-teal-400" /> : <Copy size={14} />}
                          </button>
                          <button onClick={() => deleteQuestion(i)}
                            className="p-2 rounded-lg hover:bg-rose-500/20 text-slate-500 hover:text-rose-400 transition-colors"
                            title="Delete">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
