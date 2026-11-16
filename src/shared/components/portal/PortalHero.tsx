import type { ReactNode } from 'react';
import { Sparkles } from 'lucide-react';

/**
 * Welcome banner shared by every role portal (super admin, principal, faculty,
 * student, operations, accounts). Presentation only: callers pass already-loaded
 * values, so this component never reads Firestore or starts timers.
 *
 * tone="mint"   — light card with the teal eyebrow (staff portals)
 * tone="indigo" — deep blue banner (student portal)
 */
export default function PortalHero({
  eyebrow,
  title,
  description,
  tone = 'mint',
  children,
}: {
  eyebrow: string;
  title: string;
  description?: ReactNode;
  tone?: 'mint' | 'indigo';
  children?: ReactNode;
}) {
  const indigo = tone === 'indigo';
  return (
    <section
      className={
        indigo
          ? 'relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 via-indigo-700 to-violet-800 p-5 md:p-8 text-white shadow-lg shadow-indigo-900/20'
          : 'relative overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-r from-white via-white to-emerald-50/70 p-5 md:p-7 shadow-sm dark:border-slate-800 dark:from-[#131b2e] dark:via-[#131b2e] dark:to-[#11231f]'
      }
    >
      <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p
            className={`mb-2 inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] ${
              indigo ? 'text-indigo-100' : 'text-teal-700 dark:text-teal-300'
            }`}
          >
            <Sparkles size={13} aria-hidden="true" />
            {eyebrow}
          </p>
          <h1
            className={`text-xl font-extrabold tracking-tight md:text-2xl ${
              indigo ? 'text-white' : 'text-slate-900 dark:text-white'
            }`}
          >
            {title}
          </h1>
          {description && (
            <p className={`mt-1 text-xs font-medium md:text-sm ${indigo ? 'text-indigo-100' : 'text-slate-500 dark:text-slate-400'}`}>
              {description}
            </p>
          )}
        </div>
        {children && <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>}
      </div>
      {/* Brand mark as the decorative element: no extra image request beyond the logo already used at sign-in. */}
      <img
        src="/brand/hero/vriddhi-mark-hero-light@600.png"
        alt=""
        aria-hidden="true"
        width={120}
        height={120}
        className="pointer-events-none absolute -right-4 -top-4 hidden h-28 w-28 opacity-[0.12] md:block"
      />
    </section>
  );
}
