import { useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Stack,
  Typography,
} from '@mui/material'
import { Refresh as RefreshIcon, Terminal as TerminalIcon } from '@mui/icons-material'
import { checkCodeRunnerSetup } from '@/modules/superadmin/services/codeRunnerSetupApi'
import {
  runnerSetupErrorMessage,
  runnerSetupHeadline,
  runnerSetupSeverity,
  type CodeRunnerSetupReport,
} from '@/modules/superadmin/utils/codeRunnerSetup'

/**
 * Superadmin check of the hosted code compiler. Makes one request to the runner
 * and reads/writes nothing in Firestore, so it is safe to press as often as
 * needed while configuring. The server decides the verdict; this only shows it.
 */
export default function CodeRunnerSetupCheck() {
  const [checking, setChecking] = useState(false)
  const [report, setReport] = useState<CodeRunnerSetupReport | null>(null)
  const [error, setError] = useState('')

  const runCheck = async () => {
    setChecking(true)
    setError('')
    try {
      setReport(await checkCodeRunnerSetup())
    } catch (checkError) {
      setReport(null)
      setError(runnerSetupErrorMessage(checkError))
    } finally {
      setChecking(false)
    }
  }

  return (
    <Card variant="outlined" sx={{ mb: 3 }}>
      <CardContent>
        <Stack spacing={2}>
          <Box>
            <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1, fontWeight: 800 }}>
              <TerminalIcon color="primary" /> Code compiler — setup check
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Checks the hosted compiler that runs student code: that it is reachable, has the key it needs, and has a
              compiler for C, C++, Java and Python. It reads and writes nothing, so it is safe to run as often as you like.
            </Typography>
          </Box>

          <Box>
            <Button
              variant="outlined"
              startIcon={checking ? <CircularProgress size={16} color="inherit" /> : <RefreshIcon />}
              onClick={() => void runCheck()}
              disabled={checking}
            >
              {checking ? 'Checking…' : report ? 'Check again' : 'Check code compiler'}
            </Button>
          </Box>

          {error && <Alert severity="error">{error}</Alert>}

          {report && (
            <Stack spacing={1.5}>
              <Alert severity={runnerSetupSeverity(report)}>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>{runnerSetupHeadline(report)}</Typography>
                {report.problems.length > 0 && (
                  <Box component="ul" sx={{ m: 0, mt: 1, pl: 2.5 }}>
                    {report.problems.map((problem) => (
                      <li key={problem}>
                        <Typography variant="body2">{problem}</Typography>
                      </li>
                    ))}
                  </Box>
                )}
              </Alert>

              {report.notes.length > 0 && (
                <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                  {report.notes.map((note) => (
                    <li key={note}>
                      <Typography variant="body2" color="text.secondary">{note}</Typography>
                    </li>
                  ))}
                </Box>
              )}

              {report.languages.length > 0 && (
                <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }}>
                  {report.languages.map((language) => (
                    <Chip key={language} size="small" variant="outlined" label={language} />
                  ))}
                </Stack>
              )}

              <Typography variant="caption" color="text.secondary">
                Checked {new Date(report.checkedAt).toLocaleString('en-IN')}
              </Typography>
            </Stack>
          )}
        </Stack>
      </CardContent>
    </Card>
  )
}
