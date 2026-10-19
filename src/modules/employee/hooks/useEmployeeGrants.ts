// src/modules/employee/hooks/useEmployeeGrants.ts
import { useEffect, useState } from 'react'
import { getMyEmployeeAccess } from '../api/employeeApi'

/**
 * The signed-in employee's grants. Returns null until loaded (and for
 * non-employees). A failed lookup yields [] so grant-gated pages stay hidden.
 */
export function useEmployeeGrants(enabled: boolean): string[] | null {
  const [grants, setGrants] = useState<string[] | null>(null)

  useEffect(() => {
    if (!enabled) return
    let live = true
    getMyEmployeeAccess()
      .then((res) => { if (live) setGrants(res.employee?.grants ?? []) })
      .catch(() => { if (live) setGrants([]) })
    return () => { live = false }
  }, [enabled])

  return enabled ? grants : null
}
