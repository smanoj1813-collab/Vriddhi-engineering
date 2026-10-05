// functions/src/routes/config.ts
import * as express from 'express';
import { db } from '../config/firebase';
import { verifyAuth, AuthenticatedRequest } from '../middleware/auth';
import {
  MODULES_CONFIG_DOC,
  defaultCollegeModuleSettings,
  normaliseCollegeModuleSettings,
} from '../collegeModules';

const router = express.Router();

// GET /api/config/batch-branch
router.get('/batch-branch', verifyAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const collegeId = req.user!.collegeId;
    if (!collegeId) {
      res.status(400).json({ error: 'No college associated with user' });
      return;
    }

    const configDoc = await db.collection('college_configs').doc(collegeId).get();
    const config = configDoc.data();

    res.json({
      success: true,
      batches: config?.batches || ['2026', '2027', '2028', '2029'],
      branches: config?.branches || ['B.Com', 'BBA', 'BCA'],
    });
  } catch (err: any) {
    console.error('Batch-branch config error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── College module toggles ──────────────────────────────────────────────────
// Optional product modules (currently: Assignments) are switched per college
// via colleges/{collegeId}/config/modules. These endpoints ride on the shared
// `api` function on purpose: creating new callables would add Cloud Run
// services, which is exactly what the current CPU quota cannot absorb.
// Students normally read the doc straight from Firestore (see firestore rules);
// these routes exist for the staff Settings UI and for superadmin overrides.

const MODULE_EDITOR_ROLES = ['superadmin', 'admin', 'principal', 'hod'];

function resolveModulesCollegeId(req: AuthenticatedRequest): string {
  const requested = String(
    (req.query?.collegeId as string | undefined) || (req.body?.collegeId as string | undefined) || ''
  ).trim();
  if (req.user?.role === 'superadmin') {
    return requested || String(req.user.collegeId || '');
  }
  return String(req.user?.collegeId || '');
}

// GET /api/config/modules — any authenticated member of the college.
router.get('/modules', verifyAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const collegeId = resolveModulesCollegeId(req);
    if (!collegeId) {
      res.status(400).json({ error: 'No college associated with user' });
      return;
    }
    if (req.user?.role !== 'superadmin' && req.user?.collegeId !== collegeId) {
      res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
      return;
    }
    const doc = await db
      .collection('colleges')
      .doc(collegeId)
      .collection('config')
      .doc(MODULES_CONFIG_DOC)
      .get();
    const raw = doc.exists ? doc.data() : undefined;
    res.json({
      success: true,
      collegeId,
      configured: doc.exists,
      modules: normaliseCollegeModuleSettings(raw),
      defaults: defaultCollegeModuleSettings(),
      updatedAt: raw && typeof (raw as Record<string, unknown>).updatedAt === 'object'
        ? ((raw as Record<string, unknown>).updatedAt as { toMillis?: () => number }).toMillis?.() || null
        : null,
    });
  } catch (err: any) {
    console.error('Module settings read error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/config/modules — college administrators (and superadmin) only.
router.put('/modules', verifyAuth, async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.user || !MODULE_EDITOR_ROLES.includes(req.user.role || '')) {
      res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
      return;
    }
    const collegeId = resolveModulesCollegeId(req);
    if (!collegeId) {
      res.status(400).json({ error: 'No college associated with user' });
      return;
    }
    if (req.user.role !== 'superadmin' && req.user.collegeId !== collegeId) {
      res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
      return;
    }
    const modules = normaliseCollegeModuleSettings(req.body?.modules);
    await db
      .collection('colleges')
      .doc(collegeId)
      .collection('config')
      .doc(MODULES_CONFIG_DOC)
      .set(
        {
          ...modules,
          updatedAt: new Date().toISOString(),
          updatedBy: req.user.name || req.user.email || req.user.role,
        },
        { merge: true }
      );
    res.json({ success: true, collegeId, modules });
  } catch (err: any) {
    console.error('Module settings save error:', err);
    res.status(500).json({ error: err.message });
  }
});

export { router };
