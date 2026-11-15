// src/shared/theme/appearance.ts
//
// Appearance preferences (accent color, font size, compact mode, animations).
// Builds on accent.ts but keeps the "account-scoped, never browser-wide"
// guarantee established there. `normalizeAppearance` is the firewall between
// untrusted data (Firestore document, imported JSON, query string) and the
// prefs object — identity fields must never be copied out of it.

import {
  DEFAULT_ACCENT,
  setAccent,
  getStoredAccent,
  applyStoredFontSize,
  readAppearancePref,
  writeAppearancePref,
  appearanceKey,
  ACCENT_STORAGE_KEY,
  FONT_SIZE_STORAGE_KEY,
  hexToRgb,
  type AppearanceFontSize,
} from './accent'

export type AppearanceCompactMode = 'normal' | 'compact'
export type AppearanceAnimations = 'on' | 'off'

export interface AppearancePreferences {
  accentColor: string
  fontSize: AppearanceFontSize
  compactMode: boolean
  animationsEnabled: boolean
}

export const DEFAULT_APPEARANCE: AppearancePreferences = {
  accentColor: DEFAULT_ACCENT,
  fontSize: 'medium',
  compactMode: false,
  animationsEnabled: true,
}

/** Swatch presets shown in Settings → Accent Color. */
export const ACCENT_COLORS: Array<{ id: string; name: string; hex: string }> = [
  { id: 'teal',     name: 'Teal',     hex: '#14b8a6' },
  { id: 'indigo',   name: 'Indigo',   hex: '#6366f1' },
  { id: 'amber',    name: 'Amber',    hex: '#f59e0b' },
  { id: 'red',      name: 'Red',      hex: '#ef4444' },
  { id: 'violet',   name: 'Violet',   hex: '#8b5cf6' },
  { id: 'cyan',     name: 'Cyan',     hex: '#06b6d4' },
  { id: 'pink',     name: 'Pink',     hex: '#ec4899' },
  { id: 'lime',     name: 'Lime',     hex: '#84cc16' },
]

const COMPACT_STORAGE_KEY = 'vriddhi_compact_mode'
const ANIMATIONS_STORAGE_KEY = 'vriddhi_animations'

/**
 * Project untrusted data (a Firestore doc, an imported JSON blob, a URL
 * query string) onto the cosmetic preference fields ONLY. This is the
 * only place prefs come in from outside, so identity fields (uid, role,
 * collegeId, email, …) can never be smuggled in on a prefs object.
 */
export function normalizeAppearance(raw: unknown): Partial<AppearancePreferences> {
  if (!raw || typeof raw !== 'object') return {}
  const source = raw as Record<string, unknown>
  const out: Partial<AppearancePreferences> = {}

  if (typeof source.accentColor === 'string' && hexToRgb(source.accentColor)) {
    out.accentColor = source.accentColor
  }
  if (source.fontSize === 'small' || source.fontSize === 'medium' || source.fontSize === 'large') {
    out.fontSize = source.fontSize
  }
  if (typeof source.compactMode === 'boolean') {
    out.compactMode = source.compactMode
  }
  if (typeof source.animationsEnabled === 'boolean') {
    out.animationsEnabled = source.animationsEnabled
  }

  return out
}

function readBooleanPref(base: string, uid: string | null | undefined, fallback: boolean): boolean {
  const v = readAppearancePref(base, uid)
  if (v === null) return fallback
  return v === '1'
}

function writeBooleanPref(base: string, uid: string | null | undefined, value: boolean): void {
  writeAppearancePref(base, uid, value ? '1' : '0')
}

/** Apply the complete set of prefs to the DOM (CSS variables + classes). */
export function applyAppearance(prefs: AppearancePreferences, uid?: string | null): void {
  setAccent(prefs.accentColor, false, uid ?? null)
  // Font size is driven by accent.ts's applyStoredFontSize, but when
  // applying an arbitrary prefs object we set it directly.
  if (typeof document !== 'undefined') {
    const px = prefs.fontSize === 'small' ? '14px' : prefs.fontSize === 'large' ? '18px' : '16px'
    document.documentElement.style.fontSize = px
  }
  // Compact mode toggles a root class the spacing utilities read.
  if (typeof document !== 'undefined') {
    const root = document.documentElement
    root.classList.toggle('vriddhi-compact', prefs.compactMode)
    root.classList.toggle('vriddhi-no-animations', !prefs.animationsEnabled)
  }
}

/** Read one account's full prefs from localStorage (synchronous). */
export function loadAppearanceForUser(uid: string | null | undefined): AppearancePreferences {
  const accent = uid ? getStoredAccent(uid) : DEFAULT_ACCENT
  const sizeRaw = readAppearancePref(FONT_SIZE_STORAGE_KEY, uid)
  const fontSize: AppearanceFontSize =
    sizeRaw === 'small' || sizeRaw === 'large' ? sizeRaw : 'medium'
  const compactMode = readBooleanPref(COMPACT_STORAGE_KEY, uid, false)
  const animationsEnabled = readBooleanPref(ANIMATIONS_STORAGE_KEY, uid, true)
  return { accentColor: accent, fontSize, compactMode, animationsEnabled }
}

/** Persist and apply all prefs for an account. */
export function saveAppearanceForUser(
  prefs: AppearancePreferences,
  uid: string | null | undefined,
): void {
  setAccent(prefs.accentColor, true, uid ?? null)
  writeAppearancePref(FONT_SIZE_STORAGE_KEY, uid, prefs.fontSize)
  writeBooleanPref(COMPACT_STORAGE_KEY, uid, prefs.compactMode)
  writeBooleanPref(ANIMATIONS_STORAGE_KEY, uid, prefs.animationsEnabled)
  applyAppearance(prefs, uid)
}

/** Reset to platform defaults (used on sign-out). */
export function resetAppearance(): void {
  if (typeof document === 'undefined') return
  applyAppearance(DEFAULT_APPEARANCE, null)
}
