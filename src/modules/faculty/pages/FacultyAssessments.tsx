import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
  Paper,
  Stack,
  Step,
  StepLabel,
  Stepper,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import { Add as AddIcon, LibraryBooks as BankIcon } from '@mui/icons-material';
import { useAuth } from '../../auth/context/AuthContext';
import TestScheduler from '../components/TestScheduler';
import AssessmentTestReports from '../components/AssessmentTestReports';
import AssessmentGradingQueue from '../components/AssessmentGradingQueue';

// Engineering internal-assessment hub (CIE tests, quizzes, AAT, lab internals).
// The flow mirrors how a B.E./B.Tech course is assessed: build the test from
// the question bank (CO / RBT tagged), schedule it for a branch-semester-
// section, then grade descriptive answers.
export default function FacultyAssessments() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const collegeId = user?.collegeId || '';
  const [tab, setTab] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);

  return (
    <Box sx={{ minHeight: '100%', bgcolor: 'background.default' }}>
      <Box sx={{ px: { xs: 2, md: 3 }, pt: 3 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} sx={{ justifyContent: 'space-between', alignItems: { md: 'flex-end' }, gap: 2 }}>
          <Box>
            <Typography variant="h4" sx={{ fontWeight: 700 }}>Internal Assessments (CIE)</Typography>
            <Typography color="text.secondary">
              Schedule CIE tests, quizzes and AAT for your branch &amp; sections, track attempts and grade descriptive answers.
            </Typography>
          </Box>
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" startIcon={<BankIcon />} onClick={() => navigate('/faculty/question-bank')}>
              Question bank
            </Button>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => navigate('/faculty/create-test')}>
              Create test
            </Button>
          </Stack>
        </Stack>

        <Paper variant="outlined" sx={{ mt: 2, p: 2 }}>
          <Stepper alternativeLabel activeStep={-1}>
            <Step><StepLabel optional={<Typography variant="caption">CO / RBT tagged questions</Typography>}>Create test</StepLabel></Step>
            <Step><StepLabel optional={<Typography variant="caption">Branch · Semester · Section</Typography>}>Schedule</StepLabel></Step>
            <Step><StepLabel optional={<Typography variant="caption">Auto + manual grading</Typography>}>Grade &amp; publish</StepLabel></Step>
          </Stepper>
        </Paper>

        <Tabs value={tab} onChange={(_, value) => setTab(value)} sx={{ mt: 2 }} variant="scrollable" allowScrollButtonsMobile>
          <Tab label="Schedule a test" />
          <Tab label="Results & attempts" />
          <Tab label={`Manual grading${pendingCount ? ` (${pendingCount})` : ''}`} />
        </Tabs>
      </Box>

      {tab === 0 && <TestScheduler collegeId={collegeId} />}
      {tab === 1 && (
        <Box sx={{ p: { xs: 2, md: 3 } }}>
          <AssessmentTestReports showScheduleHint />
        </Box>
      )}
      {tab === 2 && (
        <Box sx={{ p: { xs: 2, md: 3 } }}>
          <AssessmentGradingQueue onCountChange={setPendingCount} />
        </Box>
      )}
    </Box>
  );
}
