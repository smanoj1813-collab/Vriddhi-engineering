// ═══════════════════════════════════════════════════════════════════════
// PwaPrompts — service-worker registration + "update available" and
// "install app" banners. Frontend-only; safe on every route.
// ═══════════════════════════════════════════════════════════════════════
import React, { useEffect, useRef, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import {
  isPwaStandalone,
  PWA_INSTALL_REQUEST_EVENT,
  pwaInstallGuidance,
} from './install'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const INSTALL_DISMISSED_KEY = 'vriddhi.pwa.installDismissedAt'
const DISMISS_FOR_DAYS = 14

function installRecentlyDismissed(): boolean {
  try {
    const raw = localStorage.getItem(INSTALL_DISMISSED_KEY)
    if (!raw) return false
    return Date.now() - Number(raw) < DISMISS_FOR_DAYS * 24 * 60 * 60 * 1000
  } catch {
    return false
  }
}

const bannerStyle: React.CSSProperties = {
  position: 'fixed',
  left: 16,
  right: 16,
  bottom: 'calc(16px + env(safe-area-inset-bottom))',
  zIndex: 2000,
  margin: '0 auto',
  maxWidth: 560,
  background: '#0f172a',
  color: '#fff',
  borderRadius: 14,
  padding: '12px 16px',
  boxShadow: '0 10px 30px rgba(0,0,0,.25)',
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 12,
  fontFamily: 'Inter, system-ui, sans-serif',
  fontSize: 14,
}

const btn = (primary: boolean): React.CSSProperties => ({
  border: 'none',
  borderRadius: 10,
  padding: '8px 14px',
  fontWeight: 600,
  cursor: 'pointer',
  background: primary ? '#14b8a6' : 'transparent',
  color: primary ? '#052e2b' : '#cbd5e1',
  whiteSpace: 'nowrap',
})

export const PwaPrompts: React.FC = () => {
  // Update flow: a new SW is waiting; user reloads when convenient.
  // No timed update checks: the browser already re-checks the service worker on
  // every page load and navigation. A timer here only raised the banner mid-session,
  // on whatever page the user was on, and added background requests.
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  // Install flow (Chrome/Edge/Android). iOS has no event; Safari users use
  // Share → Add to Home Screen.
  const installEventRef = useRef<BeforeInstallPromptEvent | null>(null)
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [showInstall, setShowInstall] = useState(false)
  const [showInstallHelp, setShowInstallHelp] = useState(false)

  const rememberInstallEvent = (event: BeforeInstallPromptEvent | null) => {
    installEventRef.current = event
    setInstallEvent(event)
  }

  const dismissInstall = () => {
    setShowInstall(false)
    try { localStorage.setItem(INSTALL_DISMISSED_KEY, String(Date.now())) } catch { /* ignore */ }
  }

  const promptForInstall = async (event: BeforeInstallPromptEvent) => {
    setShowInstall(false)
    setShowInstallHelp(false)
    try {
      await event.prompt()
      const { outcome } = await event.userChoice
      if (outcome === 'dismissed') dismissInstall()
    } catch {
      // The browser may invalidate a captured event or enforce a prompt
      // cooldown. Keep the user moving with menu-based instructions.
      setShowInstallHelp(true)
    } finally {
      rememberInstallEvent(null) // A beforeinstallprompt event can only be used once.
    }
  }

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault()
      const promptEvent = event as BeforeInstallPromptEvent
      rememberInstallEvent(promptEvent)
      // "Not now" suppresses only the automatic banner. The permanent Install
      // App menu remains able to use this captured event immediately.
      if (!isPwaStandalone() && !installRecentlyDismissed()) setShowInstall(true)
    }
    const onInstalled = () => {
      setShowInstall(false)
      setShowInstallHelp(false)
      rememberInstallEvent(null)
      try { localStorage.removeItem(INSTALL_DISMISSED_KEY) } catch { /* ignore */ }
    }
    const onManualInstallRequest = () => {
      if (isPwaStandalone()) return
      // A manual request explicitly reverses the earlier "Not now" choice.
      try { localStorage.removeItem(INSTALL_DISMISSED_KEY) } catch { /* ignore */ }
      const promptEvent = installEventRef.current
      if (promptEvent) {
        void promptForInstall(promptEvent)
      } else {
        // iOS never emits beforeinstallprompt; Chrome may also impose a native
        // cooldown after its own prompt is dismissed. Give the exact fallback.
        setShowInstall(false)
        setShowInstallHelp(true)
      }
    }

    // Always capture beforeinstallprompt, even during the 14-day automatic
    // banner cooldown. Previously the early return here made re-installing from
    // inside the app impossible after "Not now".
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    window.addEventListener(PWA_INSTALL_REQUEST_EVENT, onManualInstallRequest)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
      window.removeEventListener(PWA_INSTALL_REQUEST_EVENT, onManualInstallRequest)
    }
  }, [])

  const doInstall = async () => {
    const event = installEvent || installEventRef.current
    if (!event) {
      setShowInstall(false)
      setShowInstallHelp(true)
      return
    }
    await promptForInstall(event)
  }

  if (needRefresh) {
    return (
      <div role="status" style={bannerStyle}>
        <span style={{ flex: 1 }}>A new version of Vriddhi is available.</span>
        <button style={btn(false)} onClick={() => setNeedRefresh(false)}>Later</button>
        <button style={btn(true)} onClick={() => updateServiceWorker(true)}>Reload</button>
      </div>
    )
  }

  if (showInstallHelp) {
    return (
      <div role="dialog" aria-label="How to install Vriddhi" style={bannerStyle}>
        <img src="/icons/icon-192.png" alt="" width={36} height={36} style={{ borderRadius: 9 }} />
        <span style={{ flex: 1 }}>{pwaInstallGuidance(navigator.userAgent)}</span>
        <button style={btn(true)} onClick={() => setShowInstallHelp(false)}>Got it</button>
      </div>
    )
  }

  if (showInstall && installEvent) {
    return (
      <div role="dialog" aria-label="Install Vriddhi" style={bannerStyle}>
        <img src="/icons/icon-192.png" alt="" width={36} height={36} style={{ borderRadius: 9 }} />
        <span style={{ flex: 1 }}>Install Vriddhi on this device for quick access.</span>
        <button style={btn(false)} onClick={dismissInstall}>Not now</button>
        <button style={btn(true)} onClick={doInstall}>Install</button>
      </div>
    )
  }

  return null
}

export default PwaPrompts
