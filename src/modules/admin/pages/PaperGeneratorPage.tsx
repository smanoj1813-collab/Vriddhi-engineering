// src/modules/admin/pages/PaperGeneratorPage.tsx
// Admin Paper Generator page — configure sections and generate a paper from the bank.

import React, { useEffect, useState } from 'react';
import { Box, Button, CircularProgress, Typography, Alert, Snackbar, Dialog } from '@mui/material';
import { CloudUpload as CloudUploadIcon, Description as TemplateIcon } from '@mui/icons-material';
import PaperUploadEditor from '@/shared/components/question-paper/PaperUploadEditor';
import { useAuth } from '../../auth/context/AuthContext';
import PaperGenerator from '../components/question-bank/PaperGenerator';
import TemplateSelector from '../components/TemplateSelector';
import { getBatchBranchConfig, getQuestionStats } from '../api/questionBankApi';
import { DEFAULT_SUBJECTS } from '@/shared/constants/academicPrograms';

export default function PaperGeneratorPage() {
  const { user } = useAuth();
  const collegeId = user?.collegeId || '';
  const [batches, setBatches] = useState<string[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!collegeId) {
      setError('Not authenticated — missing collegeId');
      setLoading(false);
      return;
    }

    Promise.all([
      getBatchBranchConfig(collegeId),
      getQuestionStats(collegeId).catch(() => null),
    ])
      .then(([cfg, stats]) => {
        const derived = Object.keys(stats?.bySubject || {});
        setBatches(cfg.batches || []);
        setBranches(cfg.branches || []);
        setSubjects(derived.length > 0 ? derived : DEFAULT_SUBJECTS);
      })
      .catch((err) => setError(err.message || 'Failed to load paper generator configuration'))
      .finally(() => setLoading(false));
  }, [collegeId]);

  if (!collegeId) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">
          {user?.role === 'employee'
            ? 'No active college is selected. Choose a college on the Employee dashboard, then open this page again.'
            : 'Please sign in with a college account to generate papers.'}
        </Alert>
      </Box>
    );
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 8 }}>
        <CircularProgress />
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>Loading paper generator...</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1.5, mb: 2 }}>
        <Button variant="outlined" startIcon={<TemplateIcon />} onClick={() => setTemplateOpen(true)}>
          Choose Template
        </Button>
        <Button variant="contained" startIcon={<CloudUploadIcon />} onClick={() => setUploadOpen(true)}>
          Upload Question Paper
        </Button>
      </Box>
      <PaperGenerator key={reloadKey} batches={batches} branches={branches} subjects={subjects} />
      <Dialog open={templateOpen} onClose={() => setTemplateOpen(false)} maxWidth="md" fullWidth>
        <TemplateSelector
          onClose={() => setTemplateOpen(false)}
          onPaperGenerated={() => {
            setTemplateOpen(false);
            setToast('Paper generated successfully from template');
            setReloadKey(k => k + 1);
          }}
        />
      </Dialog>
      <PaperUploadEditor
        open={uploadOpen}
        collegeId={collegeId}
        userId={user?.id || user?.uid || ''}
        userName={user?.name || ''}
        subjects={subjects}
        batches={batches}
        branches={branches}
        canPublishDirectly
        onClose={() => setUploadOpen(false)}
        onSaved={(_id, action) => {
          setToast(
            action === 'draft'
              ? 'Paper saved as draft'
              : action === 'save'
                ? 'Paper saved and ready to use'
                : action === 'published'
                  ? 'Paper approved and published'
                  : 'Paper submitted for HOD approval'
          );
          setReloadKey((k) => k + 1);
        }}
      />
      <Snackbar open={Boolean(toast)} autoHideDuration={4000} onClose={() => setToast('')} message={toast} />
    </Box>
  );
}
