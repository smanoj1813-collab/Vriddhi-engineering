import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, Award, BookOpen, ChevronDown, ChevronUp, GraduationCap, Loader2, BarChart2 } from 'lucide-react';
import { useAuth } from '../../auth/context/AuthContext';
import { useStudentProfile } from '../hooks/useStudentProfile';
import { fetchGrades } from '../api/studentDataApi';
import { getCollegeSchemePack } from '@/modules/admin/api/schemePackApi';
import { convertCgpaToPercentage } from '@/shared/utils/engineeringScheme';
import type { UniversitySchemePack } from '@/shared/types/schemePack';

interface GradeRecord {
  id: string;
  subject: string;
  code: string;
  credits?: number;
  internal?: number;
  external?: number;
  total?: number;
  grade: string;
  gradePoint?: number;
  semester: number;
}

const gradeColors: Record<string, string> = {
  'A+': 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800',
  'O': 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800',
  'A': 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/40 dark:text-teal-300 dark:border-teal-800',
  'B+': 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800',
  'B': 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800',
  'C': 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800',
  'D': 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-800',
  'F': 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800',
};

export default function StudentGrades() {
  const { user } = useAuth();
  const { profile, loading: profileLoading, error: profileError } = useStudentProfile(user?.uid);
  const [grades, setGrades] = useState<GradeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [schemePack, setSchemePack] = useState<UniversitySchemePack | null>(null);

  useEffect(() => {
    if (!profile?.collegeId) return;
    let cancelled = false;
    getCollegeSchemePack(profile.collegeId, {
      programId: profile.course,
      branchId: profile.branch || profile.department,
      admissionBatch: profile.batch || profile.academicYear,
    }).then((resolved) => {
      if (!cancelled) setSchemePack(resolved.pack);
    }).catch(() => {
      if (!cancelled) setSchemePack(null);
    });
    return () => { cancelled = true; };
  }, [profile?.collegeId, profile?.course, profile?.branch, profile?.department, profile?.batch, profile?.academicYear]);

  useEffect(() => {
    if (profileLoading) return;
    if (!profile) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    fetchGrades(profile.collegeId || user?.collegeId, profile.id)
      .then((data) => !cancelled && setGrades(data))
      .catch((err) => {
        console.error('[StudentGrades] load failed:', err);
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Failed to load official grade records');
        }
      })
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [profile, profileLoading, user?.collegeId]);

  const semesterWise = useMemo(() => {
    return grades.reduce((acc, g) => {
      const sem = g.semester || 1;
      if (!acc[sem]) acc[sem] = [];
      acc[sem].push(g);
      return acc;
    }, {} as Record<number, GradeRecord[]>);
  }, [grades]);

  const semesters = useMemo(
    () => Object.keys(semesterWise).map(Number).sort((a, b) => b - a),
    [semesterWise]
  );

  const [expandedSemester, setExpandedSemester] = useState<number | null>(
    semesters[0] ?? (profile?.semester || 1)
  );
  const [activeTab, setActiveTab] = useState<'grades' | 'progress'>('grades');

  useEffect(() => {
    if (expandedSemester == null && semesters.length) setExpandedSemester(semesters[0]);
  }, [semesters, expandedSemester]);

  const totalCredits = grades.reduce((sum, g) => sum + (g.credits ?? 0), 0);
  const totalGradePoints = grades.reduce(
    (sum, g) => sum + (g.gradePoint ?? 0) * (g.credits ?? 0),
    0
  );
  const cgpa = totalCredits ? (totalGradePoints / totalCredits).toFixed(2) : '—';
  const percentageEquivalent = schemePack
    ? convertCgpaToPercentage(Number(cgpa), profile?.batch || profile?.academicYear, schemePack)
    : null;

  const semesterGPA = (semester: number) => {
    const list = semesterWise[semester] || [];
    const credits = list.reduce((s, g) => s + (g.credits ?? 0), 0);
    const points = list.reduce(
      (s, g) => s + (g.gradePoint ?? 0) * (g.credits ?? 0),
      0
    );
    return credits ? (points / credits).toFixed(2) : '—';
  };

  if (profileLoading || loading) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center">
        <div className="w-10 h-10 border-3 border-teal-600 border-t-transparent rounded-full animate-spin" />
        <p className="mt-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Loading Grade Records...</p>
      </div>
    );
  }

  const error = profileError || loadError;
  if (error || !profile) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200" role="alert">
        {error || 'Your account is not linked to a student profile. Contact your college administrator.'}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl md:text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">Grades &amp; Academic Progress</h1>
        <p className="text-xs md:text-sm text-slate-500 dark:text-slate-400 mt-0.5">Comprehensive performance scorecards and cumulative GPA trajectory</p>
      </div>

      {/* CGPA Card */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131b2e] p-6 md:p-8 shadow-sm"
      >
        <div className="flex flex-col md:flex-row items-center gap-8">
          <div className="relative w-36 h-36 shrink-0">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="42" fill="none" stroke="#e2e8f0" strokeWidth="8" className="dark:stroke-slate-800" />
              <motion.circle
                cx="50" cy="50" r="42"
                fill="none"
                stroke="#0d9488"
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={`${2 * Math.PI * 42}`}
                initial={{ strokeDashoffset: 2 * Math.PI * 42 }}
                animate={{ strokeDashoffset: 2 * Math.PI * 42 * (1 - (parseFloat(cgpa) || 0) / 10) }}
                transition={{ duration: 1.2, ease: 'easeOut' }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-3xl font-black text-slate-900 dark:text-white">{cgpa}</span>
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">CGPA</span>
              {percentageEquivalent !== null && (
                <span className="text-[8px] font-semibold text-teal-700 dark:text-teal-300">{percentageEquivalent.toFixed(2)}% equivalent</span>
              )}
            </div>
          </div>

          <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 w-full">
            <div className="text-center p-4 rounded-2xl bg-teal-50 dark:bg-teal-950/40 border border-teal-200/80 dark:border-teal-800/60">
              <Award className="w-5 h-5 text-teal-600 dark:text-teal-400 mx-auto mb-1.5" />
              <p className="text-xl font-black text-teal-900 dark:text-teal-100">{grades.filter(g => g.grade === 'A' || g.grade === 'A+' || g.grade === 'O').length}</p>
              <p className="text-xs font-semibold text-teal-700 dark:text-teal-300">Top Grades</p>
            </div>
            <div className="text-center p-4 rounded-2xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200/80 dark:border-blue-800/60">
              <BookOpen className="w-5 h-5 text-blue-600 dark:text-blue-400 mx-auto mb-1.5" />
              <p className="text-xl font-black text-blue-900 dark:text-blue-100">{totalCredits}</p>
              <p className="text-xs font-semibold text-blue-700 dark:text-blue-300">Earned Credits</p>
            </div>
            <div className="text-center p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/80 dark:border-emerald-800/60">
              <TrendingUp className="w-5 h-5 text-emerald-600 dark:text-emerald-400 mx-auto mb-1.5" />
              <p className="text-xl font-black text-emerald-900 dark:text-emerald-100">Sem {semesters[0] ?? '1'}</p>
              <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">Current Level</p>
            </div>
            <div className="text-center p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800">
              <GraduationCap className="w-5 h-5 text-slate-600 dark:text-slate-400 mx-auto mb-1.5" />
              <p className="text-xl font-black text-slate-900 dark:text-slate-100">{grades.length}</p>
              <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">Total Courses</p>
            </div>
          </div>
        </div>
      </motion.div>

      {grades.length === 0 ? (
        <div className="text-center py-16 rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131b2e] p-8 shadow-sm">
          <GraduationCap className="w-12 h-12 text-slate-600 dark:text-slate-400 mx-auto mb-3" />
          <p className="text-slate-900 dark:text-white font-bold text-base">No published grade records yet</p>
          <p className="text-xs text-slate-500 mt-1">Official semester transcripts will show up here after term evaluations.</p>
        </div>
      ) : (
        <>
          <div className="flex gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
            {(['grades', 'progress'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 rounded-xl text-xs md:text-sm font-bold transition-all ${
                  activeTab === tab
                    ? 'bg-teal-600 text-slate-900 dark:text-white shadow-sm shadow-teal-600/20'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {tab === 'grades' ? 'Semester Grade Cards' : 'GPA Progression Trend'}
              </button>
            ))}
          </div>

          {activeTab === 'grades' ? (
            <div className="space-y-4">
              {semesters.map((semester) => (
                <motion.div
                  key={semester}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131b2e] overflow-hidden shadow-sm"
                >
                  <button
                    onClick={() => setExpandedSemester(expandedSemester === semester ? null : semester)}
                    className="w-full px-5 py-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-9 h-9 rounded-xl bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 flex items-center justify-center text-sm font-extrabold border border-teal-200/80 dark:border-teal-800/60">
                        {semester}
                      </span>
                      <div className="text-left">
                        <p className="text-sm font-bold text-slate-900 dark:text-white">Semester {semester}</p>
                        <p className="text-xs text-slate-500 font-medium">{semesterWise[semester].length} courses &bull; SGPA: <span className="font-bold text-teal-600 dark:text-teal-400">{semesterGPA(semester)}</span></p>
                      </div>
                    </div>
                    {expandedSemester === semester ? (
                      <ChevronUp className="w-5 h-5 text-slate-400" />
                    ) : (
                      <ChevronDown className="w-5 h-5 text-slate-400" />
                    )}
                  </button>

                  {expandedSemester === semester && (
                    <div className="px-5 pb-5 pt-1 border-t border-slate-100 dark:border-slate-800">
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead>
                            <tr className="text-left text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                              <th className="pb-3 pt-2 font-bold">Course Title</th>
                              <th className="pb-3 pt-2 font-bold">Code</th>
                              <th className="pb-3 pt-2 font-bold text-center">Credits</th>
                              <th className="pb-3 pt-2 font-bold text-center">Internal</th>
                              <th className="pb-3 pt-2 font-bold text-center">External</th>
                              <th className="pb-3 pt-2 font-bold text-center">Total</th>
                              <th className="pb-3 pt-2 font-bold text-center">Grade</th>
                            </tr>
                          </thead>
                          <tbody className="text-xs md:text-sm divide-y divide-slate-100 dark:divide-slate-800">
                            {semesterWise[semester].map((g) => (
                              <tr key={g.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/20">
                                <td className="py-3 font-semibold text-slate-900 dark:text-white">{g.subject}</td>
                                <td className="py-3 text-slate-500 font-mono">{g.code}</td>
                                <td className="py-3 text-center text-slate-600 dark:text-slate-300 font-medium">{g.credits ?? '—'}</td>
                                <td className="py-3 text-center text-slate-600 dark:text-slate-300 font-medium">{g.internal ?? '—'}</td>
                                <td className="py-3 text-center text-slate-600 dark:text-slate-300 font-medium">{g.external ?? '—'}</td>
                                <td className="py-3 text-center font-bold text-slate-900 dark:text-white">{g.total ?? '—'}</td>
                                <td className="py-3 text-center">
                                  <span className={`px-2.5 py-0.5 rounded-lg text-xs font-extrabold border ${gradeColors[g.grade] || 'bg-slate-100 text-slate-700 border-slate-200'}`}>
                                    {g.grade}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </motion.div>
              ))}
            </div>
          ) : (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131b2e] p-6 md:p-8 shadow-sm"
            >
              <h3 className="text-base font-bold text-slate-900 dark:text-white mb-6 flex items-center gap-2">
                <BarChart2 className="w-5 h-5 text-teal-600" /> Semester-wise SGPA Progression
              </h3>
              <div className="space-y-4 max-w-2xl">
                {semesters
                  .slice()
                  .sort((a, b) => a - b)
                  .map((semester) => {
                    const gpa = parseFloat(semesterGPA(semester));
                    const percentage = (gpa / 10) * 100;
                    return (
                      <div key={semester} className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800">
                        <div className="flex justify-between text-xs font-bold mb-2">
                          <span className="text-slate-800 dark:text-slate-200">Semester {semester}</span>
                          <span className="text-teal-700 dark:text-teal-400 font-extrabold text-sm">{gpa} SGPA</span>
                        </div>
                        <div className="h-3 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${percentage}%` }}
                            transition={{ duration: 1, delay: semester * 0.1 }}
                            className="h-full rounded-full bg-teal-600"
                          />
                        </div>
                      </div>
                    );
                  })}
              </div>
            </motion.div>
          )}
        </>
      )}
    </div>
  );
}
