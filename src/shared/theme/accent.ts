// Accent colour runtime. Tailwind's `teal-*` palette (used across the app as
// the brand colour) reads CSS variables set here, so changing the accent in
// Settings re-colours the whole UI instantly without a rebuild.
//
// Appearance prefs are PER-ACCOUNT. They used to live in one browser-wide
// localStorage key, so an accent picked in the superadmin account followed the
// operator into every college / faculty account signed in on the same browser
// (demo laptops, shared office machines). Keys are now suffixed with the uid;
// AuthContext re-applies the right account's prefs on every sign-in/out.

export const DEFAULT_ACCENT = '#14b8a6'
export const ACCENT_STORAGE_KEY = 'vriddhi_accent_color'
export const FONT_SIZE_STORAGE_KEY = 'vriddhi_font_size'
export const ACCENT_EVENT = 'vriddhi:accent-change'

export type AppearanceFontSize = 'small' | 'medium' | 'large'

/** localStorage key for one account's pref (`key` pre-auth / legacy). */
export function appearanceKey(base: string, uid?: string | null): string {
  return uid ? `${base}__${uid}` : base
}

/** Read one account's pref. Falls back to the legacy shared key only pre-auth. */
export function readAppearancePref(base: string, uid?: string | null): string | null {
  try {
    if (uid) {
      const scoped = localStorage.getItem(appearanceKey(base, uid))
      if (scoped !== null) return scoped
      return null
    }
    return localStorage.getItem(base)
  } catch {
    return null
  }
}

/** Write one account's pref (scoped when a uid is known; never the shared key). */
export function writeAppearancePref(base: string, uid: string | null | undefined, value: string): void {
  try {
    if (uid) {
      localStorage.setItem(appearanceKey(base, uid), value)
      // Migrate away from the leaky shared key so a pre-auth reload cannot
      // resurrect this account's accent for somebody else.
      localStorage.removeItem(base)
    } else {
      localStorage.setItem(base, value)
    }
  } catch { /* ignore */ }
}

export type RGB = [number, number, number]

export function hexToRgb(hex: string): RGB | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const mix = (a: RGB, b: RGB, t: number): RGB =>
  [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as RGB

const WHITE: RGB = [255, 255, 255]
const BLACK: RGB = [0, 0, 0]

/** Shade scale anchored on the chosen colour as 500 (mirrors Tailwind's teal ramp). */
export function accentScale(hex: string): Record<number, RGB> {
  const base = hexToRgb(hex) || (hexToRgb(DEFAULT_ACCENT) as RGB)
  return {
    50: mix(base, WHITE, 0.94),
    100: mix(base, WHITE, 0.82),
    200: mix(base, WHITE, 0.64),
    300: mix(base, WHITE, 0.42),
    400: mix(base, WHITE, 0.2),
    500: base,
    600: mix(base, BLACK, 0.18),
    700: mix(base, BLACK, 0.34),
    800: mix(base, BLACK, 0.48),
    900: mix(base, BLACK, 0.58),
    950: mix(base, BLACK, 0.72),
  }
}

export const rgbToHex = (c: RGB) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`

export function getStoredAccent(uid?: string | null): string {
  try {
    const v = readAppearancePref(ACCENT_STORAGE_KEY, uid)
    return v && hexToRgb(v) ? v : DEFAULT_ACCENT
  } catch {
    return DEFAULT_ACCENT
  }
}

/** Write the CSS variables consumed by tailwind.config.js. */
export function applyAccentVars(hex: string): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  Object.entries(accentScale(hex)).forEach(([shade, rgb]) => {
    root.style.setProperty(`--accent-${shade}`, rgb.join(' '))
  })
}

/**
 * Change the accent app-wide. `persist=false` gives a live preview (Settings
 * swatch click) without committing it; the theme provider listens for the
 * event so MUI components follow too. Pass the signed-in uid so the value is
 * stored under that account's key rather than the browser-wide legacy key.
 */
export function setAccent(hex: string, persist = true, uid?: string | null): void {
  if (!hexToRgb(hex)) return
  if (persist) {
    writeAppearancePref(ACCENT_STORAGE_KEY, uid, hex)
  }
  applyAccentVars(hex)
  window.dispatchEvent(new CustomEvent(ACCENT_EVENT, { detail: hex }))
}

/** Font-size preference was only applied on Save; apply it at boot as well. */
export function applyStoredFontSize(uid?: string | null): void {
  const v = readAppearancePref(FONT_SIZE_STORAGE_KEY, uid)
  const px = v === 'small' ? '14px' : v === 'large' ? '18px' : v === 'medium' ? '16px' : ''
  if (px) document.documentElement.style.fontSize = px
}

/**
 * Apply the signed-in account's appearance (accent + font size). Called by
 * AuthContext whenever the session changes: with a uid it restores that
 * account's own prefs; with `null` (sign-out / signed-out session) it resets
 * the browser to the platform defaults so the previous account's colours never
 * bleed into the login screen or the next person's session.
 */
export function applyStoredAppearanceForUser(uid: string | null | undefined): void {
  const accent = uid ? getStoredAccent(uid) : DEFAULT_ACCENT
  applyAccentVars(accent)
  window.dispatchEvent(new CustomEvent(ACCENT_EVENT, { detail: accent }))
  if (uid) {
    applyStoredFontSize(uid)
  } else {
    document.documentElement.style.fontSize = '16px'
  }
}
