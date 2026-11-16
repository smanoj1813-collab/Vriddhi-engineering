import type { ReactNode } from 'react';
import { ArrowLeft, BookOpen, ShieldCheck, Sparkles, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import CampusIllustration from './CampusIllustration';
import '../styles/auth.css';

/** Presentation only. Account verification, redirects and recovery stay in
 * each existing login page; this shell never imports a data SDK or polls.
 * Copy is inline English: the Academics i18n keys do not exist in this app. */
export default function AuthPageLayout({ portal, children }: { portal: 'staff' | 'student'; children: ReactNode }) {
  const portals = [
    { id: 'staff', path: '/login', label: 'Staff & Faculty', Icon: Users },
    { id: 'student', path: '/student/login', label: 'Student Portal', Icon: BookOpen },
  ] as const;

  return (
    <main className="auth-page">
      <header className="auth-header">
        <Link to="/" className="auth-brand">
          <span className="auth-brand-mark"><img src="/brand/hero/vriddhi-mark-hero-light@600.png" alt="" width={44} height={44} /></span>
          <span><strong>Vriddhi Portal</strong><small>Engineering Management &amp; Assessment System</small></span>
        </Link>
      </header>

      <div className="auth-content">
        <section className="auth-story" aria-labelledby="auth-story-heading">
          <p className="auth-eyebrow"><span aria-hidden="true" />Academic Cloud</p>
          <h1 id="auth-story-heading">A little more focus.<br /><em>A lot more growth.</em></h1>
          <p className="auth-story-description">One connected campus for learning, teaching and everything in between.</p>
          <div className="auth-art" aria-hidden="true">
            <CampusIllustration />
            <div className="auth-art-note">
              <span className="auth-note-icon"><Sparkles size={20} /></span>
              <span><small>Your campus, connected</small><strong>Growing together, every day.</strong></span>
              <span className="auth-note-dot" />
            </div>
          </div>
        </section>

        <div className="auth-form-column">
          <section className="auth-card" aria-labelledby="auth-form-heading">
            <nav className="auth-portals" aria-label="Choose portal">
              {portals.map(({ id, path, label, Icon }) => portal === id
                ? <span key={id} aria-current="page" className="auth-portal auth-portal-active"><Icon size={16} aria-hidden="true" /><span>{label}</span></span>
                : <Link key={id} to={path} className="auth-portal"><Icon size={16} aria-hidden="true" /><span>{label}</span></Link>)}
            </nav>
            <div className="auth-form-intro">
              <span className="auth-welcome-mark" aria-hidden="true"><Sparkles size={18} /></span>
              <h2 id="auth-form-heading">Welcome back.</h2>
              <p>{portal === 'student' ? 'Sign in to your student workspace.' : 'Sign in to your college workspace.'}</p>
            </div>
            {children}
          </section>
          <p className="auth-account-note"><ShieldCheck size={14} aria-hidden="true" />Use the account provided by your college.</p>
        </div>
      </div>

      <footer className="auth-footer">
        <Link to="/"><ArrowLeft size={15} aria-hidden="true" />Back to homepage</Link>
        <span aria-hidden="true" className="auth-footer-signature">Vriddhi <span>·</span> Growing together, every day.</span>
      </footer>
    </main>
  );
}
