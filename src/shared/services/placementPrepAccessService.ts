// src/shared/services/placementPrepAccessService.ts
//
// Client-side gate for the "Placement Prep" navigation entry (Phase A of the
// One Vriddhi unified experience — docs/ONE_VRIDDHI_UNIFIED_STUDENT_EXPERIENCE.md).
//
// The company-prep master switch lives at colleges/{collegeId}/config/prep
// under `companyPrep` and is managed by the platform superadmin
// (CompanyPrepVisibilityPanel → PUT /api/prep/companies/settings). The
// DEFAULT is ON (see DEFAULT_COMPANY_PREP_SETTINGS in functions/src/prepShared.ts),
// so this gate hides the entry only when the college was EXPLICITLY switched
// off — the nav must never disagree with what /prep would actually show:
// `loadVisibleCompanies` on the server applies the same settings to the
// catalogue, and that server-side filter remains the real boundary (deep
// links included). This read is a courtesy for navigation, fail-closed on
// errors and on a missing college.

import { doc, getDoc } from 'firebase/firestore'
import { db } from '@/Firebase/config'

const configDoc = (collegeId: string) => doc(db, 'colleges', collegeId, 'config', 'prep')

/** True unless the college's prep master switch is explicitly off. */
export async function fetchCollegePlacementPrepAccess(collegeId: string): Promise<boolean> {
  const id = collegeId.trim()
  if (!id) return false
  try {
    const snapshot = await getDoc(configDoc(id))
    if (!snapshot.exists()) return true
    const companyPrep = snapshot.data()?.companyPrep
    return companyPrep?.enabled !== false
  } catch {
    // A rules denial or network error must never expose a gated section.
    return false
  }
}
