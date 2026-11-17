import { useEffect, useMemo, useState } from 'react';
import { User, Bell, Shield, Palette, Save, Loader2, Check, Lock, Mail, GraduationCap, Building2, Hash, BookOpen } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { auth, functions } from '@/Firebase/config';
import ChangePasswordForm from '../../../shared/components/ChangePasswordForm';
import { useStudentProfile } from '../hooks/useStudentProfile';
import { useAuth } from '../../auth/context/AuthContext';
import { useThemeMode } from '../../../shared/contexts/ThemeProvider';
import LanguageSettingsBlock from '../../../shared/components/LanguageSettingsBlock';
import { useTranslation } from '../../../shared/contexts/LanguageProvider';
import { getStoredAccent, setAccent } from '@/shared/theme/accent';

type TabId = 'profile' | 'notifications' | 'privacy' | 'appearance';

interface Prefs {
  exams: boolean;
  fees: boolean;
  assignments: boolean;
  events: boolean;
}

const DEFAULT_PREFS: Prefs = { exams: true, fees: true, assignments: true, events: true };

const updateStudentProfile = httpsCallable<
  { name?: string; notificationPrefs?: Prefs },
  { success: boolean; name: string; notificationPrefs: Prefs | null }
>(functions, 'updateMyStudentProfile');

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem('vriddhi_notification_prefs');
    return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

// Same palette as the admin and faculty Settings screens.
const STUDENT_ACCENT_COLORS = [
  { color: '#14b8a6', name: 'Teal' },
  { color: '#6366f1', name: 'Indigo' },
  { color: '#f59e0b', name: 'Amber' },
  { color: '#ef4444', name: 'Red' },
  { color: '#8b5cf6', name: 'Violet' },
  { color: '#06b6d4', name: 'Cyan' },
  { color: '#ec4899', name: 'Pink' },
  { color: '#84cc16', name: 'Lime' },
];

export default function StudentSettings() {
  const { user } = useAuth();
  const { profile, loading, error, refresh } = useStudentProfile(user?.uid);
  const { resolvedMode, toggleMode } = useThemeMode();
  const { t } = useTranslation();

  const [activeTab, setActiveTab] = useState<TabId>('profile');
  // Accent colour: per account, stored on this device only (no server call).
  const [accentColor, setAccentColor] = useState(() => getStoredAccent(user?.uid));
  useEffect(() => { setAccent(accentColor, true, user?.uid); }, [accentColor, user?.uid]);
  const [name, setName] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [prefsSaved, setPrefsSaved] = useState(false);
  const [prefsError, setPrefsError] = useState<string | null>(null);
  const [savingPrefs, setSavingPrefs] = useState(false);

  // Password change lives in the shared ChangePasswordForm (re-authenticates
  // with the current password, enforces the platform 10-char floor, and clears
  // the one-time-password flag server-side).

  useEffect(() => {
    if (profile) {
      setName(profile.name || '');
      const storedPrefs = profile.notificationPrefs as Partial<Prefs> | undefined;
      if (storedPrefs) setPrefs({ ...DEFAULT_PREFS, ...storedPrefs });
    }
  }, [profile]);

  const tabs = useMemo(
    () => [
      { id: 'profile' as const, label: 'Profile Details', icon: User },
      { id: 'notifications' as const, label: 'Alert Preferences', icon: Bell },
      { id: 'privacy' as const, label: 'Security & Password', icon: Shield },
      { id: 'appearance' as const, label: 'Appearance & Theme', icon: Palette },
    ],
    []
  );

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setProfileMsg({ type: 'err', text: 'Full name cannot be empty.' });
      return;
    }
    setSavingProfile(true);
    setProfileMsg(null);
    try {
      await updateStudentProfile({ name: name.trim() });
      setProfileMsg({ type: 'ok', text: 'Profile updated successfully.' });
      refresh();
    } catch (err: any) {
      setProfileMsg({ type: 'err', text: err.message || 'Failed to update profile.' });
    } finally {
      setSavingProfile(false);
    }
  };

  const handleSavePrefs = async () => {
    setSavingPrefs(true);
    setPrefsSaved(false);
    setPrefsError(null);
    try {
      await updateStudentProfile({ notificationPrefs: prefs });
      // Keep a local copy only as an offline UI cache; Firestore is canonical.
      localStorage.setItem('vriddhi_notification_prefs', JSON.stringify(prefs));
      setPrefsSaved(true);
      setTimeout(() => setPrefsSaved(false), 2500);
    } catch (err: any) {
      setPrefsError(err.message || 'Failed to save notification preferences.');
    } finally {
      setSavingPrefs(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center">
        <div className="w-10 h-10 border-3 border-teal-600 border-t-transparent rounded-full animate-spin" />
        <p className="mt-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Loading Preferences...</p>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200" role="alert">
        {error || 'Your account is not linked to a student profile. Contact your college administrator.'}
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto p-1">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">Account Settings</h1>
          <p className="text-xs md:text-sm text-slate-500 dark:text-slate-400 mt-0.5">Manage personal profile, notifications, password and app preferences</p>
        </div>
        <div className="flex items-center gap-2 text-[11px] font-semibold px-3 py-1.5 rounded-full bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          {profile?.collegeId ? `College: ${profile.collegeId.slice(0, 8)}...` : 'Student Account'}
        </div>
      </div>

      {/* Settings Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {/* Tabs Sidebar */}
        <div className="space-y-1 md:col-span-1">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-xs md:text-sm font-bold transition-all text-left ${
                  active
                    ? 'bg-teal-600 text-white shadow-sm shadow-teal-600/20'
                    : 'bg-white dark:bg-[#131b2e] text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-slate-800'
                }`}
              >
                <Icon size={16} className="shrink-0" />
                <span className="truncate min-w-0">{tab.label}</span>
              </button>
            );
          })}

          {/* Quick Info Card - only on desktop sidebar */}
          <div className="hidden md:block mt-6 p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">Academic Info</p>
            <div className="space-y-2 text-xs">
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300"><Hash size={12} /> Reg: {profile?.regNo || profile?.registrationNumber || profile?.rollNumber || '—'}</div>
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300"><Building2 size={12} /> Dept: {profile?.department || profile?.branch || '—'}</div>
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300"><BookOpen size={12} /> Course: {profile?.course || '—'}</div>
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300"><GraduationCap size={12} /> Batch: {profile?.batch || profile?.academicYear || '—'}</div>
            </div>
            <p className="text-[10px] text-slate-400 mt-3">Contact details are managed by your college administration. To update email or phone, please contact admin.</p>
          </div>
        </div>

        {/* Content Card */}
        <div className="md:col-span-3 bg-white dark:bg-[#131b2e] border border-slate-200 dark:border-slate-800 rounded-3xl p-6 md:p-8 shadow-sm">
          {activeTab === 'profile' && (
            <form onSubmit={handleSaveProfile} className="space-y-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-base font-bold text-slate-900 dark:text-white pb-1">Personal Information</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Update your display name. Email and academic details are read-only and managed by administration.</p>
                </div>
                <div className="w-12 h-12 rounded-2xl bg-teal-600 text-white flex items-center justify-center font-bold text-lg shadow-sm">
                  {name.charAt(0)?.toUpperCase() || 'S'}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-5 pt-2 border-t border-slate-100 dark:border-slate-800">
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1.5 block">
                    Full Name
                  </label>
                  <div className="relative">
                    <User size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Your full name"
                      required
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-sm font-medium outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 transition-all"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1.5 block">
                      Email Address
                    </label>
                    <div className="relative">
                      <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="email"
                        disabled
                        value={user?.email || profile?.email || ''}
                        className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 text-sm font-medium cursor-not-allowed"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1.5 block">
                      Registration No
                    </label>
                    <div className="relative">
                      <Hash size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        disabled
                        value={(profile?.regNo || profile?.registrationNumber || profile?.rollNumber || '—') as string}
                        className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 text-sm font-medium cursor-not-allowed"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1.5 block">
                      Department / Branch
                    </label>
                    <input
                      type="text"
                      disabled
                      value={(profile?.department || profile?.branch || '—') as string}
                      className="w-full px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 text-sm font-medium cursor-not-allowed"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1.5 block">
                      Course & Batch
                    </label>
                    <input
                      type="text"
                      disabled
                      value={`${profile?.course || ''} ${profile?.batch ? `• ${profile.batch}` : ''}`.trim() || '—'}
                      className="w-full px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 text-sm font-medium cursor-not-allowed"
                    />
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 text-[11px] text-amber-800 dark:text-amber-300">
                  <strong>Note:</strong> Mobile number and other contact details cannot be changed from student portal. Please contact your college administrator for any corrections to email, phone, or academic information.
                </div>
              </div>

              {profileMsg && (
                <div className={`p-3 rounded-xl text-xs font-bold border flex items-center gap-2 ${profileMsg.type === 'ok' ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-800' : 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-300 dark:border-rose-800'}`}>
                  {profileMsg.type === 'ok' ? <Check size={14} /> : <Shield size={14} />}
                  {profileMsg.text}
                </div>
              )}

              <button
                type="submit"
                disabled={savingProfile}
                className="px-5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white font-bold text-xs md:text-sm shadow-sm transition-all flex items-center gap-2"
              >
                {savingProfile ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                Save Changes
              </button>
            </form>
          )}

          {activeTab === 'notifications' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white pb-1">Notification Preferences</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">Choose which alerts you want to receive. Preferences are saved locally and synced to your profile.</p>
              </div>

              <div className="space-y-3 pt-2">
                {[
                  { key: 'exams' as const, label: 'Exam & Assessment Reminders', desc: 'Get notified when new tests are published or deadlines approach.' },
                  { key: 'assignments' as const, label: 'Assignment Deadlines', desc: 'Alerts for upcoming homework submissions and teacher remarks.' },
                  { key: 'fees' as const, label: 'Fee Invoices & Dues', desc: 'Reminders for fee term deadlines and cleared payment receipts.' },
                  { key: 'events' as const, label: 'Campus Events & Workshops', desc: 'Updates regarding university workshops, webinars and fests.' },
                ].map((item) => (
                  <div key={item.key} className="flex items-center justify-between p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 transition-colors">
                    <div className="pr-4">
                      <p className="text-xs md:text-sm font-bold text-slate-900 dark:text-white">{item.label}</p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{item.desc}</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={prefs[item.key]}
                        onChange={(e) => setPrefs({ ...prefs, [item.key]: e.target.checked })}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-teal-500/30 rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-teal-600"></div>
                    </label>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-3 pt-3">
                <button
                  type="button"
                  onClick={handleSavePrefs}
                  disabled={savingPrefs}
                  className="px-5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white font-bold text-xs md:text-sm shadow-sm transition-all flex items-center gap-2"
                >
                  {savingPrefs ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save Preferences
                </button>
                {prefsSaved && (
                  <span className="text-xs font-bold text-emerald-600 flex items-center gap-1 animate-in fade-in">
                    <Check size={14} /> Saved!
                  </span>
                )}
                {prefsError && (
                  <span className="text-xs font-bold text-rose-600" role="alert">
                    {prefsError}
                  </span>
                )}
              </div>
            </div>
          )}

          {activeTab === 'privacy' && (
            <ChangePasswordForm />
          )}

          {activeTab === 'appearance' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white pb-1">{t('settings.appearance')}</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">{t('settings.appearanceDesc')}</p>
              </div>
              <LanguageSettingsBlock />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-5 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-xl bg-teal-600/10 dark:bg-teal-900/30 flex items-center justify-center">
                      <Palette size={18} className="text-teal-600 dark:text-teal-400" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-900 dark:text-white">Theme Mode</p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">Light for day, dark for night study</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={toggleMode}
                    className="w-full px-4 py-3 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs shadow-sm flex items-center justify-center gap-2 transition-colors"
                  >
                    <Palette size={16} /> Switch to {resolvedMode === 'dark' ? 'Light Theme' : 'Dark Theme'}
                  </button>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-3 text-center">
                    Currently active: <span className="font-bold uppercase text-teal-600">{resolvedMode} mode</span>
                  </p>
                </div>

                <div className="p-5 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 md:col-span-2">
                  <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-1">Accent Colour</h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-3">Changes the highlight colour across the portal on this device.</p>
                  <div className="flex flex-wrap gap-3">
                    {STUDENT_ACCENT_COLORS.map((item) => (
                      <button
                        key={item.color}
                        type="button"
                        onClick={() => setAccentColor(item.color)}
                        aria-pressed={accentColor === item.color}
                        title={item.name}
                        className={`relative w-11 h-11 rounded-xl transition-all duration-200 ${accentColor === item.color ? 'ring-2 ring-offset-2 ring-teal-500 ring-offset-white dark:ring-offset-slate-900 scale-110' : 'hover:scale-105'}`}
                        style={{ backgroundColor: item.color }}
                      >
                        {accentColor === item.color && (
                          <Check className="w-5 h-5 text-white absolute inset-0 m-auto drop-shadow-md" />
                        )}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-2">
                    Selected: {STUDENT_ACCENT_COLORS.find((c) => c.color === accentColor)?.name ?? 'Custom'} ({accentColor})
                  </p>
                </div>

                <div className="p-5 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-2">Accessibility Tips</h4>
                  <ul className="text-[11px] text-slate-500 dark:text-slate-400 space-y-1.5 list-disc pl-4">
                    <li>Dark mode reduces eye strain during night study</li>
                    <li>Your theme preference is saved automatically</li>
                    <li>All pages adapt to your chosen theme</li>
                    <li>Clear cache if theme doesn&apos;t apply immediately</li>
                  </ul>
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-teal-50 dark:bg-teal-950/20 border border-teal-200 dark:border-teal-800">
                <p className="text-xs font-semibold text-teal-800 dark:text-teal-300">Vriddhi Academic Palette</p>
                <p className="text-[11px] text-teal-700/70 dark:text-teal-400/70 mt-1">Our design uses a clean light academic palette with teal accents for focus and clarity. The interface is optimized for long study hours with high contrast and readable typography.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
