import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { sendPasswordResetEmail } from 'firebase/auth';
import { Eye, EyeOff, Lock, Mail, ArrowRight } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { auth } from '../../../Firebase/config';
import { useAuth } from '../hooks/useAuth';
import { useTranslation } from '../../../shared/contexts/LanguageProvider';
import AuthPageLayout from '../components/AuthPageLayout';
import { IDLE_SIGNOUT_FLAG } from '../../../shared/utils/idleTimeout';

export default function StudentLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [localError, setLocalError] = useState('');
  const [idleSignOut, setIdleSignOut] = useState(false);
  // Self-service password recovery — the "Forgot?" link was a dead `href="#"`.
  // Student accounts are bulk-provisioned with one-time passwords that are
  // shown once and never stored, so a lost password must be recoverable
  // without an admin: Firebase emails a reset link.
  const [forgotMsg, setForgotMsg] = useState<{ kind: 'info' | 'ok' | 'err'; text: string } | null>(null);
  const [forgotSending, setForgotSending] = useState(false);

  // Auto-logout leaves a flag so the student is told WHY the session ended
  // (see IdleSessionTimeout). Read-and-clear — a refresh must not repeat it.
  useEffect(() => {
    if (sessionStorage.getItem(IDLE_SIGNOUT_FLAG) === '1') {
      sessionStorage.removeItem(IDLE_SIGNOUT_FLAG);
      setIdleSignOut(true);
    }
  }, []);

  const { login, logout, isLoading } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError('');

    try {
      const appUser = await login(email, password);
      if (appUser.role !== 'student') {
        await logout();
        setLocalError(t('auth.notStudent'));
        return;
      }
      navigate('/student/dashboard', { replace: true });
    } catch (err: any) {
      const msg = err?.message || '';
      if (msg.startsWith('AUTHORIZATION_STALE')) {
        setLocalError(t('auth.identityStale'));
      } else if (msg.includes('ACCOUNT_NOT_FOUND')) {
        setLocalError(t('auth.noStudentProfile'));
      } else if (msg.includes('auth/invalid-credential') || msg.includes('auth/wrong-password')) {
        setLocalError(t('auth.invalidCredentials'));
      } else if (msg.includes('auth/user-not-found')) {
        setLocalError(t('auth.noAccountEmail'));
      } else if (msg.includes('auth/invalid-email')) {
        setLocalError(t('auth.invalidEmail'));
      } else if (msg.includes('auth/too-many-requests')) {
        setLocalError(t('auth.tooManyAttempts'));
      } else {
        setLocalError(msg || t('auth.loginFailed'));
      }
    }
  };

  const handleForgotPassword = async (e: React.MouseEvent) => {
    e.preventDefault();
    const target = email.trim().toLowerCase();
    if (!target) {
      setForgotMsg({ kind: 'info', text: t('auth.forgotEnterEmail') });
      return;
    }
    setForgotSending(true);
    setForgotMsg({ kind: 'info', text: t('auth.forgotSending') });
    try {
      await sendPasswordResetEmail(auth, target);
      setForgotMsg({ kind: 'ok', text: t('auth.forgotSent', { email: target }) });
    } catch (err: any) {
      // Same generic message for unknown addresses and send failures — the
      // login page must not become an account enumerator.
      console.warn('[StudentLogin] password reset email failed:', err?.code || err?.message);
      setForgotMsg({ kind: 'err', text: t('auth.forgotError') });
    } finally {
      setForgotSending(false);
    }
  };

  return (
    <AuthPageLayout portal="student">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="student-email" className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5 block">
            {t('auth.studentEmail')}
          </label>
          <div className="relative">
            <Mail size={18} aria-hidden="true" className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              id="student-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="student@vriddhi.edu"
              autoComplete="email"
              required
              className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 text-sm font-medium transition-all"
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label htmlFor="student-password" className="text-xs font-bold uppercase tracking-wider text-slate-600">
              {t('auth.password')}
            </label>
            <button
              type="button"
              onClick={handleForgotPassword}
              disabled={forgotSending}
              className="text-xs text-indigo-600 hover:underline font-medium disabled:opacity-60"
            >
              {t('auth.forgot')}
            </button>
          </div>
          <div className="relative">
            <Lock size={18} aria-hidden="true" className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              id="student-password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your student password"
              autoComplete="current-password"
              required
              className="w-full pl-10 pr-12 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 text-sm font-medium transition-all"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-800 p-0.5"
            >
              {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </div>
        </div>

        {idleSignOut && !localError && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-300/70 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
            <span className="font-semibold">Signed out for inactivity.</span>
            <span>Your session ended automatically after a period without activity. Please sign in again.</span>
          </div>
        )}

        {forgotMsg && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className={`p-3 rounded-xl border text-xs font-medium ${
              forgotMsg.kind === 'ok'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                : forgotMsg.kind === 'err'
                  ? 'bg-rose-50 border-rose-200 text-rose-700'
                  : 'bg-sky-50 border-sky-200 text-sky-700'
            }`}
          >
            {forgotMsg.text}
          </motion.div>
        )}

        {localError && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-medium text-rose-700"
          >
            {localError}
          </motion.div>
        )}

        <button
          type="submit"
          disabled={isLoading}
          className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-bold text-sm shadow-md shadow-indigo-600/20 transition-all flex items-center justify-center gap-2 active:scale-[0.99]"
        >
          {isLoading ? (
            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <>
              Sign in to Student Portal <ArrowRight size={17} />
            </>
          )}
        </button>
      </form>

      <div className="mt-6 pt-5 border-t border-slate-100 text-center">
        <p className="text-xs text-slate-500">
          {t('auth.staffHint')}{' '}
          <Link to="/login" className="text-teal-600 font-bold hover:underline">
            {t('auth.staffLoginLink')}
          </Link>
        </p>
      </div>
    </AuthPageLayout>
  );
}
