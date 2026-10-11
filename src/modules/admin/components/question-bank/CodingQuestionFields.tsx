// src/modules/admin/components/question-bank/CodingQuestionFields.tsx
//
// The authoring block for a coding question, shown inside QuestionForm when the
// type is "Coding".
//
// Everything a faculty member has to supply for the answer to be scoreable is
// here, in the order they need it: the languages, how long a program may run,
// the starter code (optional — the platform has good defaults), the PUBLIC
// sample cases a student can run during the test, and the HIDDEN test cases
// that decide the marks. The readiness line at the bottom is the same check the
// server applies at Confirm time, so a question that cannot be scored is
// refused here in the same words rather than failing after the paper is locked.

import React from 'react';
import {
  Box,
  Button,
  Chip,
  IconButton,
  Paper,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { Add as AddIcon, Delete as DeleteIcon } from '@mui/icons-material';
import {
  CODING_DRY_RUN_CHOICES,
  CODING_LANGUAGE_OPTIONS,
  CODING_MAX_PLACEHOLDERS,
  codingConfigProblem,
  dryRunLimitLabel,
  type CodingPlaceholder,
} from '@/shared/utils/codingQuestion';
import type { QuestionCodingCase, QuestionCodingConfig } from '../../types/questionBank';

interface CodingQuestionFieldsProps {
  value: QuestionCodingConfig;
  onChange: (value: QuestionCodingConfig) => void;
}

const TIME_LIMITS = [1, 2, 3, 5, 10];

const emptyCase = (): QuestionCodingCase => ({ stdin: '', expectedOutput: '' });

export default function CodingQuestionFields({ value, onChange }: CodingQuestionFieldsProps) {
  const config: QuestionCodingConfig = {
    languages: value.languages?.length ? value.languages : ['python'],
    starterCode: value.starterCode || {},
    sampleCases: value.sampleCases || [],
    testCases: value.testCases?.length ? value.testCases : [emptyCase()],
    timeLimitSeconds: value.timeLimitSeconds || 2,
    placeholders: value.placeholders || [],
    dryRunLimit: value.dryRunLimit ?? 25,
  };
  const problem = codingConfigProblem(config);
  const hiddenCount = (config.testCases || []).filter((testCase) => String(testCase?.expectedOutput || '').trim()).length;

  const patch = (next: Partial<QuestionCodingConfig>) => onChange({ ...config, ...next });

  const updateCase = (list: 'sampleCases' | 'testCases', index: number, field: keyof QuestionCodingCase, text: string) => {
    const cases = [...(config[list] || [])];
    cases[index] = { ...cases[index], [field]: text };
    patch({ [list]: cases } as Partial<QuestionCodingConfig>);
  };

  const addCase = (list: 'sampleCases' | 'testCases') => {
    patch({ [list]: [...(config[list] || []), emptyCase()] } as Partial<QuestionCodingConfig>);
  };

  const removeCase = (list: 'sampleCases' | 'testCases', index: number) => {
    const cases = (config[list] || []).filter((_, i) => i !== index);
    // A coding question with no hidden case cannot be scored; keep one empty row
    // so the faculty member sees the requirement instead of an empty panel.
    patch({ [list]: list === 'testCases' && cases.length === 0 ? [emptyCase()] : cases } as Partial<QuestionCodingConfig>);
  };

  /**
   * Per-student numbers. A faculty member writes `{{a}} {{b}}` as the input and
   * `{{a + b}}` as the expected output; every student's paper draws its own a
   * and b, so an answer copied from someone else does not fit that student's
   * numbers — the cheapest large-scale cheat in an online paper.
   */
  function PlaceholderEditor({
    placeholders,
    onChange,
  }: {
    placeholders: CodingPlaceholder[];
    onChange: (placeholders: CodingPlaceholder[]) => void;
  }) {
    const update = (index: number, field: keyof CodingPlaceholder, raw: string) => {
      const next = [...placeholders];
      next[index] = {
        ...next[index],
        [field]: field === 'name' ? raw : Math.round(Number(raw) || 0),
      };
      onChange(next);
    };
    return (
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle2">Per-student numbers (optional)</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
          Declare a name and the range it is drawn from, then use it in a test as {'{{a}}'} for the value or{' '}
          {'{{a + b}}'} to work out the expected output (+, − and × only). Each student gets their own draw, so a
          memorised answer to one student&apos;s numbers fails another&apos;s. Leave this empty to give every student the
          same tests.
        </Typography>
        {placeholders.map((placeholder, index) => (
          <Box key={index} sx={{ display: 'flex', gap: 1, mb: 1, alignItems: 'center' }}>
            <TextField
              size="small"
              label="Name"
              value={placeholder.name}
              onChange={(event) => update(index, 'name', event.target.value)}
              placeholder="a"
              sx={{ width: 140 }}
            />
            <TextField
              size="small"
              type="number"
              label="From"
              value={placeholder.min}
              onChange={(event) => update(index, 'min', event.target.value)}
              sx={{ width: 120 }}
            />
            <TextField
              size="small"
              type="number"
              label="To"
              value={placeholder.max}
              onChange={(event) => update(index, 'max', event.target.value)}
              sx={{ width: 120 }}
            />
            <IconButton
              size="small"
              color="error"
              aria-label="Remove placeholder"
              onClick={() => onChange(placeholders.filter((_, i) => i !== index))}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Box>
        ))}
        {placeholders.length === 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            No per-student numbers yet — the same tests go to everyone.
          </Typography>
        )}
        <Button
          size="small"
          startIcon={<AddIcon />}
          disabled={placeholders.length >= CODING_MAX_PLACEHOLDERS}
          onClick={() => onChange([...placeholders, { name: '', min: 1, max: 99 }])}
        >
          Add a number
        </Button>
      </Paper>
    );
  }

  function CaseList({
    list,
    title,
    help,
    placeholder,
  }: {
    list: 'sampleCases' | 'testCases';
    title: string;
    help: string;
    placeholder: string;
  }) {
    const cases = config[list] || [];
    return (
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle2">{title}</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
          {help}
        </Typography>
        {cases.map((testCase, index) => (
          <Box key={index} sx={{ display: 'flex', gap: 1, mb: 1, alignItems: 'flex-start' }}>
            <TextField
              multiline
              minRows={2}
              size="small"
              fullWidth
              label={`Input ${index + 1}`}
              value={testCase.stdin}
              onChange={(event) => updateCase(list, index, 'stdin', event.target.value)}
              placeholder={placeholder}
              slotProps={{ input: { sx: { fontFamily: 'monospace', fontSize: 12 } } }}
            />
            <TextField
              multiline
              minRows={2}
              size="small"
              fullWidth
              label={`Expected output ${index + 1}`}
              value={testCase.expectedOutput}
              onChange={(event) => updateCase(list, index, 'expectedOutput', event.target.value)}
              slotProps={{ input: { sx: { fontFamily: 'monospace', fontSize: 12 } } }}
            />
            <IconButton size="small" color="error" onClick={() => removeCase(list, index)} aria-label="Remove case">
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Box>
        ))}
        <Button size="small" startIcon={<AddIcon />} onClick={() => addCase(list)}>
          Add {list === 'testCases' ? 'hidden test' : 'sample'}
        </Button>
      </Paper>
    );
  }

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle2" gutterBottom>
          Languages the student may answer in
        </Typography>
        <ToggleButtonGroup
          value={config.languages}
          onChange={(_event, next: string[]) => {
            if (next.length === 0) return; // at least one language, always
            patch({ languages: next });
          }}
          size="small"
        >
          {CODING_LANGUAGE_OPTIONS.map((option) => (
            <ToggleButton key={option.id} value={option.id} sx={{ textTransform: 'none' }}>
              {option.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>

        <Box sx={{ mt: 2, display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
          <Typography variant="caption" color="text.secondary">
            Time limit per test
          </Typography>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={config.timeLimitSeconds}
            onChange={(_event, next: number | null) => next && patch({ timeLimitSeconds: next })}
          >
            {TIME_LIMITS.map((seconds) => (
              <ToggleButton key={seconds} value={seconds}>
                {seconds}s
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          <Typography variant="caption" color="text.secondary">
            Marks are split evenly across the hidden tests unless you set a weight per test.
          </Typography>
        </Box>

        {/* The dry-run budget. This is the only knob that trades sandbox cost and
            queue contention against how freely a student can debug; the per-minute
            throttle applies on top of it either way. */}
        <Box sx={{ mt: 2, display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
          <Typography variant="caption" color="text.secondary">
            Sample runs a student may make
          </Typography>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={config.dryRunLimit ?? 25}
            onChange={(_event, next: number | null) => next !== null && patch({ dryRunLimit: next })}
          >
            {CODING_DRY_RUN_CHOICES.map((choice) => (
              <ToggleButton key={choice} value={choice} sx={{ textTransform: 'none' }}>
                {choice === 0 ? 'Unlimited' : choice}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          <Typography variant="caption" color="text.secondary">
            {dryRunLimitLabel(config.dryRunLimit ?? 25)}. Students who run out can still submit — marks come from
            the hidden tests.
          </Typography>
        </Box>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle2" gutterBottom>
          Starter code (optional)
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
          Shown in the student&apos;s editor. Leave blank to use the platform template for each language.
        </Typography>
        {config.languages.map((language) => (
          <TextField
            key={language}
            multiline
            minRows={3}
            size="small"
            fullWidth
            sx={{ mb: 1.5 }}
            label={`${CODING_LANGUAGE_OPTIONS.find((option) => option.id === language)?.label ?? language} template`}
            value={config.starterCode?.[language] || ''}
            onChange={(event) =>
              patch({ starterCode: { ...(config.starterCode || {}), [language]: event.target.value } })
            }
            slotProps={{ input: { sx: { fontFamily: 'monospace', fontSize: 12 } } }}
          />
        ))}
      </Paper>

      <PlaceholderEditor
        placeholders={config.placeholders || []}
        onChange={(placeholders) => patch({ placeholders })}
      />

      <CaseList
        list="testCases"
        title="Hidden test cases (these decide the marks)"
        help="Never shown to the student. Marks are awarded per test that passes, so partial credit is real. Use your placeholders here ({{a}}) to make each student's test different."
        placeholder="e.g. 4 7"
      />

      <CaseList
        list="sampleCases"
        title="Sample test cases (public)"
        help="Listed in the student's editor and runnable during the test. Give at least one so a student can check their input/output format."
        placeholder="e.g. 2 3"
      />

      {problem ? (
        <Chip color="warning" label={problem} sx={{ justifySelf: 'start' }} />
      ) : (
        <Chip
          color="success"
          label={`Ready — ${hiddenCount} hidden test${hiddenCount === 1 ? '' : 's'}, scored automatically`}
          sx={{ justifySelf: 'start' }}
        />
      )}

    </Box>
  );
}
