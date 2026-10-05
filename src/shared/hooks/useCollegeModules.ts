// src/shared/hooks/useCollegeModules.ts
//
// College-level optional module toggles for staff surfaces (faculty, admin,
// HOD, principal). Students get the same value through useStudentData; this
// hook is the staff equivalent. The read goes straight to Firestore
// (colleges/{collegeId}/config/modules — staff-readable under the rules) and
// FAILS OPEN: a missing doc or an error keeps every module ON, because these
// are core product areas that an error must not hide.

import { useEffect, useState } from 'react'
import { useAuth } from '@/modules/auth/context/AuthContext'
import {
  fetchCollegeModuleSettings,
  isCollegeModuleEnabled,
  type CollegeModuleSettings,
} from '@/shared/services/collegeModulesService'

export interface CollegeModulesState {
  assignmentsEnabled: boolean
  loading: boolean
  settings: CollegeModuleSettings | null
}

export function useCollegeModules(): CollegeModulesState {
  const { user } = useAuth()
  const collegeId = user?.collegeId || ''
  const [settings, setSettings] = useState<CollegeModuleSettings | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    if (!collegeId) {
      // Superadmin without an active college scope: keep defaults (ON).
      setSettings(null)
      setLoading(false)
      return
    }
    void fetchCollegeModuleSettings(collegeId).then((result) => {
      if (cancelled) return
      setSettings(result)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [collegeId])

  return {
    assignmentsEnabled: isCollegeModuleEnabled(settings, 'assignments'),
    loading,
    settings,
  }
}
