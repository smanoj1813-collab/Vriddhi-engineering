import React, { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { sendPasswordResetEmail } from 'firebase/auth';
import { Eye, EyeOff, Lock, Mail, ArrowRight } from 'lucide-react';
import { auth } from '../../../Firebase/config';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../../../shared/contexts/LanguageProvider';
import AuthPageLayout from '../components/AuthPageLayout';
import { dashboardPathFor, portalForRole } from '../roleRoutes';
import { IDLE_SIGNOUT_FLAG } from '../../../shared/utils/idleTimeout';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [idleSignOut, setIdleSignOut] = useState(false);
  // Self-service password recovery: the "Forgot?" link used to be a dead
  // `href="#"`, which left anyone with a lost one-time password locked out
  // (staff accounts are created with a generated password that is shown once
  // and never stored). Firebase emails a reset link; the user sets their own
  // password and the mustChangePassword flag is honoured at next sign-in.
  const [forgotMsg, setForgotMsg] = useState<{ kind: 'info' | 'ok' | 'err'; text: string } | null>(null);
  const [forgotSending, setForgotSending] = useState(false);
  const { login, isAuthenticated, user } = useAuth();

  // Auto-logout leaves a flag instead of a mystery: explain why the session
  // ended (see IdleSessionTimeout). Read-and-clear so a manual refresh of the
  // login page does not repeat the banner.
  React.useEffect(() => {
    if (sessionStorage.getItem(IDLE_SIGNOUT_FLAG) === '1') {
      sessionStorage.removeItem(IDLE_SIGNOUT_FLAG);
      setIdleSignOut(true);
    }
  }, []);
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const hasRedirected = React.useRef(false);

  React.useEffect(() => {
    if (hasRedirected.current) return;
    if (isAuthenticated && user) {
      hasRedirected.current = true;
      const from = (location.state as any)?.from?.pathname;
      // One map for every entry point (see roleRoutes.ts): the previous local
      // copy disagreed with the router about where HODs land.
      const target = from || dashboardPathFor(user.role);
      navigate(target, { replace: true });
    }
  }, [isAuthenticated, user, navigate, location]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const appUser = await login(email, password);
      // Sign-in worked but the account belongs behind the other door: say so,
      // instead of leaving a staff-only route to bounce the user back here.
      if (portalForRole(appUser.role) === 'student') {
        navigate('/student/login', { replace: true });
        return;
      }
    } catch (err: any) {
      const msg = err?.message || err?.code || '';
      if (msg.startsWith('AUTHORIZATION_STALE')) {
        setError(t('auth.identityStale'));
      } else if (msg === 'ACCOUNT_NOT_FOUND') {
        setError(t('auth.accountNotFound'));
      } else if (
        msg.includes('user-not-found') ||
        msg.includes('wrong-password') ||
        msg.includes('invalid-credential') ||
        msg.includes('invalid-login-credentials')
      ) {
        setError(t('auth.invalidCredentials'));
      } else if (msg.includes('too-many-requests')) {
        setError(t('auth.tooManyAttempts'));
      } else if (msg.includes('user-disabled')) {
        setError(t('auth.accountDisabled'));
      } else {
        setError(err.message || t('auth.genericError'));
      }
    } finally {
      setLoading(false);
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
      // Firebase returns auth/user-not-found for unknown addresses. Tell the
      // user the same "check the spelling / contact admin" story either way —
      // echoing "no such account" would turn the login page into an account
      // enumerator.
      console.warn('[Login] password reset email failed:', err?.code || err?.message);
      setForgotMsg({ kind: 'err', text: t('auth.forgotError') });
    } finally {
      setForgotSending(false);
    }
  };

  return (
    <AuthPageLayout portal="staff">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="login-email" className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5 block">
            {t('auth.academicEmail')}
          </label>
          <div className="relative">
            <Mail size={18} aria-hidden="true" className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@college.edu"
              required
              autoComplete="email"
              className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 text-sm font-medium transition-all"
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label htmlFor="login-password" className="text-xs font-bold uppercase tracking-wider text-slate-600">
              {t('auth.password')}
            </label>
            <button
              type="button"
              onClick={handleForgotPassword}
              disabled={forgotSending}
              className="text-xs text-teal-600 hover:underline font-medium disabled:opacity-60"
            >
              {t('auth.forgot')}
            </button>
          </div>
          <div className="relative">
            <Lock size={18} aria-hidden="true" className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              id="login-password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter account password"
              required
              autoComplete="current-password"
              className="w-full pl-10 pr-12 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 text-sm font-medium transition-all"
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

        {idleSignOut && !error && (
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

        {error && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-medium text-rose-700"
          >
            {error}
          </motion.div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 rounded-xl bg-[#1d6b5e] hover:bg-[#175a4f] disabled:bg-slate-300 text-white font-bold text-sm shadow-md shadow-teal-900/20 transition-all flex items-center justify-center gap-2 active:scale-[0.99]"
        >
          {loading ? (
            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <>
              Sign in to Staff Portal <ArrowRight size={17} />
            </>
          )}
        </button>
      </form>

      <div className="mt-6 pt-5 border-t border-slate-100 text-center">
        <p className="text-xs text-slate-500">
          Students should sign in using the{' '}
          <Link to="/student/login" className="text-teal-600 font-bold hover:underline">
            Student Portal →
          </Link>
        </p>
      </div>
    </AuthPageLayout>
  );
}
