// src/modules/superadmin/pages/SuperAdminPrepStudio.tsx
//
// Superadmin → "Prep Content Studio" (direct route: /superadmin/prep-studio)
//
// The Prep-Content authoring console previously lived only inside
// /admin/settings under the "AI Content & Cost" tab, which made it
// effectively undiscoverable for superadmins — the Settings page is a
// college-admin surface and the tab renders conditionally on role. This page
// exposes the very same <PrepContentStudioTab /> behind its own first-class
// sidebar entry so the platform content team can reach it without navigating
// college settings.
//
// It is a thin wrapper by design: all authoring, AI drafting, publishing
// state machine and practice-pool logic stays in PrepContentStudioTab, so
// there is a single source of truth for the studio UI regardless of entry
// point. Access is still enforced by the parent route's RoleRoute(['superadmin'])
// and, independently, by the /prep/* server endpoints.
//
// The "Share the public catalog" card answers "I need a URL for the Prep
// studio to check/verify without a college": the /prep routes are public and
// college-free (published content only), so the link can be opened or shown
// to anyone.

import { useState } from 'react';
import { Box, Typography, Alert, Card, CardContent, Button, Stack, TextField } from '@mui/material';
import { Link as LinkIcon, Check } from '@mui/icons-material';
import PrepContentStudioTab from '@/modules/admin/components/PrepContentStudioTab';
import CodingLabCollegeAssignment from '@/modules/superadmin/components/CodingLabCollegeAssignment';
import CodeRunnerSetupCheck from '@/modules/superadmin/components/CodeRunnerSetupCheck';

function PublicCatalogLinkCard() {
  const [copied, setCopied] = useState(false);
  // The public hub. Append ?program=bcom|ba|bba|bsc|mcom for a specific
  // catalog; subject and topic pages are deep-linkable too:
  //   /prep/subject/{subjectId}
  //   /prep/subject/{subjectId}/topic/{topicId}
  const baseUrl = `${window.location.origin}/prep`;
  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt('Copy this link:', url);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <LinkIcon /> Share the public catalog (no college, no login)
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Everything you publish here appears on these public URLs — open them to check and verify the
          catalog, or share them; no college assignment or sign-in is involved (only published content
          is visible).
        </Typography>
        <Stack spacing={1.5}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}>
            <TextField
              size="small"
              fullWidth
              value={`${baseUrl}?program=bcom`}
              slotProps={{ input: { readOnly: true } }}
              sx={{ maxWidth: { sm: 480 } }}
            />
            <Button variant="outlined" size="small" onClick={() => copy(`${baseUrl}?program=bcom`)} startIcon={copied ? <Check fontSize="inherit" /> : <LinkIcon fontSize="inherit" />}>
              {copied ? 'Copied' : 'Copy B.Com link'}
            </Button>
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}>
            <TextField
              size="small"
              fullWidth
              value={baseUrl}
              slotProps={{ input: { readOnly: true } }}
              sx={{ maxWidth: { sm: 480 } }}
            />
            <Button variant="outlined" size="small" onClick={() => copy(baseUrl)} startIcon={copied ? <Check fontSize="inherit" /> : <LinkIcon fontSize="inherit" />}>
              {copied ? 'Copied' : 'Copy home link'}
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary">
            Other programs: replace the query with ?program=ba, bba, bsc or mcom. Any subject or topic
            page is deep-linkable as /prep/subject/{'{subjectId}'} or /prep/subject/{'{subjectId}'}/topic/{'{topicId}'}.
          </Typography>
        </Stack>
      </CardContent>
    </Card>
  );
}

export default function SuperAdminPrepStudio() {
  return (
    <Box>
      <Box sx={{ mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 800 }}>
          Prep Content Studio — Concept-First Learning
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Build clear, advanced-but-accessible explanations, worked problem-solving,
          formulas, valid shortcuts and answer frameworks that add to a student’s
          own curriculum without assuming a particular university or scheme.
        </Typography>
        <Alert severity="info" sx={{ mt: 1.5 }}>
          Published Prep material is shared across colleges and B2C learners. The
          Universal Student Learning pack is curriculum-independent; any university-
          specific past papers remain separately labelled. Publishing updates the
          shared catalogue, so review content carefully.
        </Alert>
      </Box>
      <PublicCatalogLinkCard />
      <CodingLabCollegeAssignment />
      <CodeRunnerSetupCheck />
      <PrepContentStudioTab />
    </Box>
  );
}
