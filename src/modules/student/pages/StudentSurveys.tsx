// src/modules/student/pages/StudentSurveys.tsx
// Course-exit / program-exit surveys (OBE Slice 5). This is the indirect-
// attainment capture: the ratings a student gives here become the 20% share of
// their course's attainment run, and the CO list is the one frozen onto the
// round by the staff side — the student is never asked to invent a CO.
//
// One row per round per student, written straight to obeSurveyResponses under
// {surveyId}__{uid}; the rules reject any other id, any other college, an empty
// answer set, and any round that is closed or does not exist. A submitted round
// stays editable while it is open (mis-clicks happen), and once it is closed the
// answers are frozen evidence.

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ClipboardList, Loader2, Send } from 'lucide-react';
import { useAuth } from '../../auth/context/AuthContext';
import { useStudentProfile } from '../hooks/useStudentProfile';
import {
  fetchMySurveyResponses,
  fetchStudentSurveys,
  submitSurveyResponse,
} from '../api/obeSurveyApi';
import { isSurveyComplete, unscoredCos } from '@/shared/utils/obeSurvey';
import { OBE_SURVEY_AUDIENCES, type ObeSurveyDoc } from '@/shared/types/obeSurvey';

const CARD = 'rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900';

function audienceLabel(survey: ObeSurveyDoc): string {
  return OBE_SURVEY_AUDIENCES.find((a) => a.id === survey.audience)?.label ?? 'Survey';
}

function RatingRow({
  label,
  hint,
  value,
  scaleMax,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number | undefined;
  scaleMax: number;
  onChange: (value: number) => void;
}) {
  const options = useMemo(() => Array.from({ length: scaleMax }, (_, i) => i + 1), [scaleMax]);
  return (
    <fieldset className="border-b border-slate-100 py-3 last:border-b-0 dark:border-slate-800">
      <legend className="text-sm font-bold text-slate-800 dark:text-slate-100">{label}</legend>
      {hint && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
      <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={value === option}
            onClick={() => onChange(option)}
            className={`h-9 w-9 rounded-lg border text-sm font-bold transition-colors ${
              value === option
                ? 'border-teal-600 bg-teal-600 text-white'
                : 'border-slate-300 text-slate-600 hover:border-teal-400 dark:border-slate-600 dark:text-slate-300'
            }`}
          >
            {option}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function SurveyForm({
  survey,
  existing,
  collegeId,
  uid,
  name,
  onSubmitted,
}: {
  survey: ObeSurveyDoc;
  existing?: Record<string, number>;
  collegeId: string;
  uid: string;
  name?: string;
  onSubmitted: () => void;
}) {
  const [scores, setScores] = useState<Record<string, number>>(existing ?? {});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setScores(existing ?? {});
  }, [existing]);

  const missing = unscoredCos(scores, survey.cos, survey.scaleMax);
  const complete = isSurveyComplete(scores, survey.cos, survey.scaleMax);

  async function handleSubmit() {
    if (!complete || saving) return;
    setSaving(true);
    setError(null);
    try {
      await submitSurveyResponse({
        surveyId: survey.id,
        collegeId,
        uid,
        ...(name ? { name } : {}),
        scores,
        scaleMax: survey.scaleMax,
      });
      onSubmitted();
    } catch (err) {
      const code = (err as { code?: string } | null)?.code ?? '';
      setError(
        code === 'permission-denied'
          ? 'This round is no longer accepting answers, or your sign-in is missing its college link. Ask your faculty to check the survey status.'
          : err instanceof Error
            ? err.message
            : 'Could not save your answers. Check your connection and try again.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={CARD}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">
            {survey.courseCode}
            {survey.courseTitle ? ` — ${survey.courseTitle}` : ''}
          </h3>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {audienceLabel(survey)}
            {survey.academicYear ? ` · ${survey.academicYear}` : ''}
            {survey.term ? ` · ${survey.term}` : ''} · {survey.cos.length} outcomes · rate 1 (not met) to{' '}
            {survey.scaleMax} (fully met)
          </p>
        </div>
        {existing && (
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
            Answered — you can update while it is open
          </span>
        )}
      </div>

      {survey.prompt && (
        <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {survey.prompt}
        </p>
      )}

      <div className="mt-2">
        {survey.cos.map((co) => (
          <RatingRow
            key={co.code}
            label={co.code}
            hint={co.statement}
            value={scores[co.code]}
            scaleMax={survey.scaleMax}
            onChange={(value) => setScores((prev) => ({ ...prev, [co.code]: value }))}
          />
        ))}
      </div>

      {error && (
        <p className="mt-3 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {error}
        </p>
      )}

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {complete
            ? 'All outcomes rated.'
            : `${missing.length} outcome${missing.length === 1 ? '' : 's'} left: ${missing.join(', ')}`}
        </p>
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={!complete || saving}
          className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-bold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          {existing ? 'Update answers' : 'Submit answers'}
        </button>
      </div>
    </div>
  );
}

export default function StudentSurveys() {
  const { user } = useAuth();
  const { profile } = useStudentProfile(user?.uid);
  const queryClient = useQueryClient();
  const [justSubmitted, setJustSubmitted] = useState<string | null>(null);

  const collegeId = user?.collegeId ?? '';
  const surveysQuery = useQuery({
    queryKey: ['studentSurveys', collegeId, profile?.program, profile?.branch],
    enabled: Boolean(collegeId),
    queryFn: () => fetchStudentSurveys(collegeId, profile ?? null),
  });
  const responsesQuery = useQuery({
    queryKey: ['studentSurveyResponses', user?.uid],
    enabled: Boolean(user?.uid),
    queryFn: () => fetchMySurveyResponses(user!.uid),
  });

  const surveys = surveysQuery.data ?? [];
  const answersBySurvey = useMemo(() => {
    const map = new Map<string, Record<string, number>>();
    for (const response of responsesQuery.data ?? []) {
      map.set(response.surveyId, response.scores ?? {});
    }
    return map;
  }, [responsesQuery.data]);

  const open = surveys.filter((survey) => survey.status === 'open');
  const loading = surveysQuery.isLoading || responsesQuery.isLoading;

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-2 sm:p-4">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-800 dark:text-slate-100">
          <ClipboardList size={20} /> Feedback
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Rate how far each course met its stated outcomes. Your answers are anonymous in every report —
          staff see the average per outcome, never who said what.
        </p>
      </header>

      {loading && (
        <div className={`${CARD} flex items-center gap-2 text-sm text-slate-500`}>
          <Loader2 size={16} className="animate-spin" /> Loading your surveys…
        </div>
      )}

      {!loading && !collegeId && (
        <div className={CARD}>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Your account is not linked to a college yet, so there are no surveys to show.
          </p>
        </div>
      )}

      {!loading && collegeId && open.length === 0 && (
        <div className={CARD}>
          <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 size={16} /> Nothing to fill right now.
          </p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Course-exit surveys open after a course finishes and appear here until staff close them. Your
            answers are already counted — nothing to do.
          </p>
        </div>
      )}

      {justSubmitted && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
          <CheckCircle2 size={16} className="mr-1 inline" /> Thanks — your answers were recorded.
        </div>
      )}

      {open.map((survey) => (
        <SurveyForm
          key={survey.id}
          survey={survey}
          existing={answersBySurvey.get(survey.id)}
          collegeId={collegeId}
          uid={user?.uid ?? ''}
          name={user?.name ?? undefined}
          onSubmitted={() => {
            setJustSubmitted(survey.id);
            void queryClient.invalidateQueries({ queryKey: ['studentSurveyResponses', user?.uid] });
          }}
        />
      ))}

      {!loading && surveysQuery.isError && (
        <div className={CARD}>
          <p className="text-sm font-semibold text-rose-600">
            Could not load your surveys. Check your connection and try again.
          </p>
        </div>
      )}

      <p className="pb-4 text-center text-xs text-slate-400">
        Looking for your syllabus? <Link to="/student/curriculum" className="underline">Curriculum</Link> shows
        what each outcome covers.
      </p>
    </div>
  );
}
