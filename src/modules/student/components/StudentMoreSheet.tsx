import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Download, LogOut, Moon, Sun, X } from 'lucide-react'
import { useTranslation } from '../../../shared/contexts/LanguageProvider'
import { useThemeMode } from '../../../shared/contexts/ThemeProvider'
import LanguageSwitcher from '../../../shared/components/LanguageSwitcher'
import TextSizeControl from '../../../shared/components/TextSizeControl'
import { isPwaStandalone, requestPwaInstall } from '../../../shared/pwa/install'
import type { TranslationKey } from '../../../shared/i18n'
import { STUDENT_NAV_GROUPS, moreSheetItems } from '../studentNav'
import { useStudentData } from '../hooks/useStudentData'

interface StudentMoreSheetProps {
  open: boolean
  onClose: () => void
  onSignOut: () => void
  studentName?: string
  studentMeta?: string
  unreadNotifications?: number
}

/**
 * The "More" sheet — the mobile answer to the desktop sidebar. Everything a
 * student does not reach daily lives here as thumb-sized tiles, so the phone
 * layout never falls back to scrolling a long desktop nav list. Fees and
 * Notifications live here too: they are checked occasionally, and the two
 * bottom-bar hubs (Academics, Learning) now own the daily study pages.
 */
export default function StudentMoreSheet({
  open,
  onClose,
  onSignOut,
  studentName,
  studentMeta,
  unreadNotifications = 0,
}: StudentMoreSheetProps) {
  const { t } = useTranslation()
  const { resolvedMode, toggleMode } = useThemeMode()
  const { profile, codingLabEnabled, assignmentsEnabled, placementPrepEnabled } = useStudentData()
  const showInstall = !isPwaStandalone()
  const sheetItems = moreSheetItems({ showInstallApp: showInstall, profile, codingLabEnabled, assignmentsEnabled, placementPrepEnabled })

  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="md:hidden fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="All menu">
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-[2px] animate-[fadeIn_.15s_ease-out]"
      />
      <div className="absolute inset-x-0 bottom-0 max-h-[82vh] overflow-y-auto overscroll-contain rounded-t-3xl border-t border-slate-200 bg-white pb-[calc(16px+env(safe-area-inset-bottom))] shadow-2xl dark:border-slate-800 dark:bg-[#131b2e] animate-[sheetUp_.22s_cubic-bezier(.22,1,.36,1)]">
        <div className="sticky top-0 z-10 bg-white/95 px-4 pb-3 pt-2.5 backdrop-blur dark:bg-[#131b2e]/95">
          <div className="mx-auto h-1 w-10 rounded-full bg-slate-300 dark:bg-slate-600" />
          <div className="mt-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-slate-900 dark:text-white">{studentName || 'Student'}</p>
              {studentMeta && <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">{studentMeta}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mr-1 rounded-xl p-2 text-slate-500 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="space-y-5 px-4 pb-2">
          {STUDENT_NAV_GROUPS.map((group) => {
            const items = sheetItems.filter((item) => item.group === group.id)
            if (items.length === 0) return null
            return (
              <section key={group.id}>
                <h2 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {group.label}
                </h2>
                <div className="grid grid-cols-3 gap-2">
                  {items.map((item) => {
                    const Icon = item.icon
                    const label = item.translationKey ? t(item.translationKey as TranslationKey) : item.label
                    return (
                      <Link
                        key={item.id}
                        to={item.path}
                        onClick={onClose}
                        className="relative flex min-h-[84px] flex-col items-center justify-center gap-1.5 rounded-2xl border border-slate-200 bg-slate-50 px-2 py-3 text-center transition-colors active:bg-teal-50 active:border-teal-300 dark:border-slate-800 dark:bg-slate-900/60 dark:active:bg-teal-950/40"
                      >
                        <Icon className="h-5 w-5 text-teal-700 dark:text-teal-300" />
                        <span className="text-[11px] font-semibold leading-tight text-slate-700 dark:text-slate-200">
                          {label}
                        </span>
                        {item.badge === 'notifications' && unreadNotifications > 0 && (
                          <span className="absolute right-2 top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
                            {unreadNotifications > 9 ? '9+' : unreadNotifications}
                          </span>
                        )}
                      </Link>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </div>

        <div className="mt-2 space-y-2 px-4">
          <TextSizeControl className="justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900" />
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <LanguageSwitcher compact showLabel={false} className="w-full" />
            </div>
            <button
              type="button"
              onClick={toggleMode}
              aria-label={resolvedMode === 'dark' ? 'Light mode' : 'Dark mode'}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition-colors active:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
            >
              {resolvedMode === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
          {showInstall && (
            <button
              type="button"
              onClick={() => {
                onClose()
                requestPwaInstall()
              }}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-teal-200 bg-teal-50 px-4 py-2.5 text-xs font-bold text-teal-800 transition-colors active:bg-teal-100 dark:border-teal-800/60 dark:bg-teal-950/40 dark:text-teal-200"
            >
              <Download className="h-4 w-4" /> Install Vriddhi on this phone
            </button>
          )}
          <button
            type="button"
            onClick={onSignOut}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs font-bold text-rose-700 transition-colors active:bg-rose-100 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300"
          >
            <LogOut className="h-4 w-4" /> {t('common.signOut' as TranslationKey)}
          </button>
        </div>
      </div>
    </div>
  )
}
