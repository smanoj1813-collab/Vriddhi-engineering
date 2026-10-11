// src/modules/student/components/CodingAnswerEditor.tsx
//
// The answer box for a coding question, during a live test.
//
// Design notes, in the order they mattered:
//
// 1. Run the SAMPLES as much as the student wants (within a per-student
//    budget): engineering students debug, and a paper that makes you submit
//    blind measures nerve, not skill. The hidden tests are never run here and
//    never sent to the browser — `hiddenCaseCount` is a number and nothing
//    more, so the "run" button cannot be turned into an answer key.
// 2. Every line of feedback names what happened ("Output did not match",
//    "Time limit exceeded") so a student can act on it.
// 3. The exam clipboard lockdown still applies: pasting is blocked everywhere
//    else, so the code box is where a student TYPES. That is a deliberate
//    trade — see the note in the component below — and it is why the run
//    button exists at all.
//
// No editor dependency: a plain textarea with tab indentation. Loading a
// multi-megabyte editor bundle mid-test (on a college network, on a phone) is
// the kind of decision that costs more marks than it saves.

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Play, Terminal } from 'lucide-react';
import {
  CODING_SOURCE_MAX_CHARS,
  applyTabIndent,
  codingAnswerProblem,
  codingLanguageOption,
  displayOutput,
  hiddenTestSummary,
  starterForLanguage,
  summarizeSampleRun,
  variantNotice,
  type SampleRunResult,
} from '@/shared/utils/codingQuestion';
import { runAssessmentCode } from '../services/assessmentCodeApi';

interface CodingAnswerEditorProps {
  questionId: string;
  /** The live attempt's test id — the callable verifies it is really theirs. */
  testId?: string;
  /** Languages the faculty member allowed for this question. */
  languages: string[];
  starterCode?: Record<string, string>;
  sampleCases?: Array<{ stdin?: string; expectedOutput?: string }>;
  /** How many hidden tests decide the marks. A number, never the cases. */
  hiddenCaseCount?: number;
  /** The question drew its numbers for this student (variantNotice explains). */
  variesByStudent?: boolean;
  value?: { language?: string; code?: string };
  onChange: (value: { language: string; code: string }) => void;
  /** Errors from the question (e.g. a failed upload of the answer) — unused here. */
  disabled?: boolean;
}

export default function CodingAnswerEditor({
  questionId,
  testId,
  languages,
  starterCode,
  sampleCases = [],
  hiddenCaseCount = 0,
  variesByStudent = false,
  value,
  onChange,
  disabled = false,
}: CodingAnswerEditorProps) {
  const allowed = useMemo(
    () => (languages.length ? languages : ['python', 'c', 'cpp', 'java']),
    [languages],
  );
  const [language, setLanguage] = useState<string>(value?.language || allowed[0]);
  const [code, setCode] = useState<string>(value?.code ?? '');
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [runSummary, setRunSummary] = useState<string | null>(null);
  const [results, setResults] = useState<SampleRunResult[]>([]);
  const [output, setOutput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Restore an answer the student already wrote (resume, or coming back to the
  // question): the parent owns the value once the student starts typing.
  useEffect(() => {
    if (value?.language && allowed.includes(value.language) && value.language !== language) {
      setLanguage(value.language);
    }
    if (typeof value?.code === 'string' && value.code !== code && textareaRef.current && !code) {
      setCode(value.code);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value?.language, value?.code]);

  const problem = codingAnswerProblem(language, code, allowed);
  const charsLeft = CODING_SOURCE_MAX_CHARS - code.length;

  function update(nextLanguage: string, nextCode: string) {
    setLanguage(nextLanguage);
    setCode(nextCode);
    onChange({ language: nextLanguage, code: nextCode });
  }

  function handleLanguageChange(nextLanguage: string) {
    // Switching language keeps the code only when the student has not typed
    // anything yet; anything else would silently re-label a C program as Java.
    const untouched = !code.trim() || code === starterForLanguage(language, starterCode);
    const nextCode = untouched ? starterForLanguage(nextLanguage, starterCode) : code;
    update(nextLanguage, nextCode);
  }

  async function handleRun() {
    if (running || disabled) return;
    if (problem) {
      setRunError(problem);
      return;
    }
    if (!testId) {
      setRunError('Sample runs are unavailable right now — submit your answer normally.');
      return;
    }
    setRunning(true);
    setRunError(null);
    try {
      const response = await runAssessmentCode({ testId, questionId, language, code });
      setResults(response.results || []);
      setOutput(response.output || '');
      setRunSummary(response.failure || summarizeSampleRun(response.results));
      if (response.failure) setRunError(response.failure);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not run your code.';
      setRunError(message);
      setRunSummary(null);
    } finally {
      setRunning(false);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Tab') return;
    event.preventDefault();
    const target = event.currentTarget;
    const { value: next, caret } = applyTabIndent(
      code,
      target.selectionStart ?? code.length,
      target.selectionEnd ?? code.length,
    );
    update(language, next);
    window.requestAnimationFrame(() => {
      target.selectionStart = caret;
      target.selectionEnd = caret;
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Language
          </span>
          <select
            value={language}
            disabled={disabled || allowed.length === 1}
            onChange={(event) => handleLanguageChange(event.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm font-semibold dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          >
            {allowed.map((id) => (
              <option key={id} value={id}>
                {codingLanguageOption(id)?.label ?? id}
              </option>
            ))}
          </select>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {hiddenTestSummary(hiddenCaseCount)}
        </p>
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        {codingLanguageOption(language)?.hint}
      </p>

      {variantNotice(variesByStudent) && (
        <p className="rounded-lg border border-teal-200 bg-teal-50 p-2.5 text-xs font-semibold text-teal-800 dark:border-teal-900 dark:bg-teal-950/30 dark:text-teal-200">
          {variantNotice(variesByStudent)}
        </p>
      )}

      <textarea
        ref={textareaRef}
        value={code}
        onChange={(event) => update(language, event.target.value)}
        onKeyDown={handleKeyDown}
        rows={12}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        autoComplete="off"
        wrap="off"
        disabled={disabled}
        aria-label="Your code answer"
        className="w-full overflow-x-auto rounded-lg border border-slate-300 bg-slate-950 p-3 font-mono text-xs leading-relaxed text-slate-100 outline-none focus:border-teal-500 dark:border-slate-700"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-400">
          {code.length.toLocaleString()} characters
          {charsLeft < 2000 && <span className="text-amber-600"> · {charsLeft.toLocaleString()} left</span>}
        </p>
        <button
          type="button"
          onClick={() => void handleRun()}
          disabled={running || disabled || Boolean(problem)}
          title={problem ?? 'Runs the sample tests shown below'}
          className="inline-flex items-center gap-1.5 rounded-lg border border-teal-600 px-3 py-1.5 text-xs font-bold text-teal-700 hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-teal-300 dark:hover:bg-teal-950/40"
        >
          {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          Run sample tests
        </button>
      </div>

      {runError && (
        <p className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs font-semibold text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {runError}
        </p>
      )}

      {runSummary && !runError && (
        <p
          className={`flex items-center gap-2 text-xs font-bold ${
            results.every((result) => result.passed) ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'
          }`}
        >
          <CheckCircle2 size={14} /> {runSummary}
        </p>
      )}

      {results.length > 0 && (
        <div className="space-y-2">
          {results.map((result) => (
            <div
              key={result.index}
              className={`rounded-lg border p-2.5 text-xs ${
                result.passed
                  ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30'
                  : 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30'
              }`}
            >
              <p className="font-bold text-slate-700 dark:text-slate-200">
                Sample {result.index + 1}: {result.passed ? 'passed' : result.reason || 'did not pass'}
                {typeof result.timeMs === 'number' && (
                  <span className="ml-2 font-normal text-slate-500">{result.timeMs} ms</span>
                )}
              </p>
              {result.stdin && (
                <p className="mt-1 whitespace-pre-wrap font-mono text-[11px] text-slate-600 dark:text-slate-300">
                  Input: {displayOutput(result.stdin, 300)}
                </p>
              )}
              <p className="mt-1 whitespace-pre-wrap font-mono text-[11px] text-slate-600 dark:text-slate-300">
                Expected: {displayOutput(result.expectedOutput, 300)}
              </p>
              {!result.passed && (
                <p className="mt-1 whitespace-pre-wrap font-mono text-[11px] text-rose-700 dark:text-rose-300">
                  Your output: {displayOutput(result.got, 300)}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {output && (
        <div>
          <p className="mb-1 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            <Terminal size={13} /> Program output
          </p>
          <pre className="max-h-40 overflow-auto rounded-lg bg-slate-950 p-3 font-mono text-[11px] text-slate-200">
            {displayOutput(output)}
          </pre>
        </div>
      )}

      {sampleCases.length > 0 && results.length === 0 && (
        <div className="rounded-lg bg-slate-50 p-2.5 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
          <p className="font-bold uppercase tracking-wide">Sample tests</p>
          <ul className="mt-1 space-y-1">
            {sampleCases.map((sampleCase, index) => (
              <li key={index} className="whitespace-pre-wrap font-mono text-[11px]">
                Input: {displayOutput(sampleCase.stdin, 200)} → Expected: {displayOutput(sampleCase.expectedOutput, 200)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
