// src/modules/student/components/QuestionRenderer.tsx
// Renders different question types for the test-taking interface

import React from 'react';
import {
  Box,
  Typography,
  Radio,
  RadioGroup,
  FormControlLabel,
  FormControl,
  TextField,
  Chip,
  Paper,
  Checkbox,
} from '@mui/material';
import {
  Flag as FlagIcon,
  FlagOutlined as FlagOutlineIcon,
} from '@mui/icons-material';
import type { PaperQuestion, StudentAnswer } from '../types/assessment';
import CodingAnswerEditor from './CodingAnswerEditor';

interface QuestionRendererProps {
  question: PaperQuestion;
  answer?: Partial<StudentAnswer>;
  onAnswer: (answer: Partial<StudentAnswer>) => void;
  isFlagged: boolean;
  onToggleFlag: () => void;
  questionNumber: number;
  showResult?: boolean;
  /**
   * Blocks clipboard actions on the answer fields themselves. The exam page
   * also installs a document-level lockdown (see shared/utils/examLockdown),
   * but React-level handlers on the input are the last line of defence when
   * the answer field is rendered somewhere the lockdown does not reach.
   */
  lockClipboard?: boolean;
  resultStatus?: 'correct' | 'incorrect' | 'unattempted' | 'partial';
  correctAnswer?: string;
  marksObtained?: number;
  /**
   * The live attempt's test id. Only the coding answer box needs it: its "run
   * sample tests" button goes through the `runAssessmentCode` callable, which
   * verifies the caller really is sitting this test.
   */
  testId?: string;
}

/**
 * Props that make an answer field paste-proof on a phone: the long-press
 * "Paste", the keyboard's clipboard chip, drag-and-drop, and autocorrect
 * pulling a previously saved answer back in.
 */
function clipboardGuardProps(lock: boolean) {
  if (!lock) return {};
  const block = (event: React.SyntheticEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  return {
    onPaste: block,
    onCut: block,
    onCopy: block,
    onDrop: block,
    onDragOver: block,
    onContextMenu: block,
    // Native autofill/spellcheck would be another clipboard-shaped hole.
    spellCheck: false,
    autoComplete: 'off' as const,
    autoCorrect: 'off' as const,
    autoCapitalize: 'sentences' as const,
  };
}

const QuestionRenderer: React.FC<QuestionRendererProps> = ({
  question,
  answer,
  onAnswer,
  isFlagged,
  onToggleFlag,
  questionNumber,
  showResult = false,
  lockClipboard = false,
  resultStatus,
  correctAnswer,
  marksObtained,
  testId,
}) => {
  const guard = clipboardGuardProps(!showResult && lockClipboard);

  const handleMCQChange = (optionId: string) => {
    onAnswer({
      selectedOptionId: optionId,
      isFlagged,
      visitedAt: new Date().toISOString(),
    });
  };

  const handleMultiSelectChange = (optionId: string, checked: boolean) => {
    const current = answer?.selectedOptionIds || [];
    const updated = checked
      ? [...current, optionId]
      : current.filter((id) => id !== optionId);
    onAnswer({
      selectedOptionIds: updated,
      isFlagged,
      visitedAt: new Date().toISOString(),
    });
  };

  const handleTextChange = (value: string) => {
    onAnswer({
      textAnswer: value,
      isFlagged,
      visitedAt: new Date().toISOString(),
    });
  };

  const handleNumericalChange = (value: string) => {
    const num = parseFloat(value);
    onAnswer({
      numericalAnswer: isNaN(num) ? undefined : num,
      isFlagged,
      visitedAt: new Date().toISOString(),
    });
  };

  const getResultColor = () => {
    if (!showResult) return 'inherit';
    switch (resultStatus) {
      case 'correct': return 'success.main';
      case 'incorrect': return 'error.main';
      case 'partial': return 'warning.main';
      default: return 'text.secondary';
    }
  };

  const getResultBg = () => {
    if (!showResult) return 'transparent';
    switch (resultStatus) {
      case 'correct': return 'success.light';
      case 'incorrect': return 'error.light';
      case 'partial': return 'warning.light';
      default: return 'action.hover';
    }
  };

  // Coding questions own their whole answer area: language picker, code box,
  // the PUBLIC sample tests and the run button. Hidden test cases never appear
  // here — `caseCount` is a number and nothing more.
  if (question.type === 'coding') {
    if (showResult) {
      return (
        <Paper sx={{ p: 3, mb: 3 }}>
          <Typography variant="subtitle2" color="text.secondary" gutterBottom>
            Coding answer
          </Typography>
          <Typography
            variant="body2"
            component="pre"
            sx={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 12, m: 0 }}
          >
            {answer?.coding?.code || 'Not attempted'}
          </Typography>
          {marksObtained !== undefined && marksObtained !== null && (
            <Typography variant="body2" sx={{ mt: 1.5, fontWeight: 600 }}>
              {marksObtained} marks
            </Typography>
          )}
        </Paper>
      );
    }
    return (
      <Paper sx={{ p: 3, mb: 3 }}>
        <CodingAnswerEditor
          questionId={question.id}
          testId={testId}
          languages={question.coding?.languages ?? []}
          starterCode={question.coding?.starterCode}
          sampleCases={question.coding?.sampleCases ?? []}
          hiddenCaseCount={question.coding?.caseCount ?? 0}
          variesByStudent={question.coding?.variesByStudent === true}
          value={answer?.coding}
          onChange={(value) =>
            onAnswer({
              coding: value,
              isFlagged,
              visitedAt: new Date().toISOString(),
            })
          }
        />
      </Paper>
    );
  }

  return (
    <Box sx={{ width: '100%' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            Q{questionNumber}
          </Typography>
          <Chip
            label={`${question.marks} mark${question.marks !== 1 ? 's' : ''}`}
            size="small"
            color="primary"
            variant="outlined"
          />
          <Chip
            label={question.difficulty}
            size="small"
            color={
              question.difficulty === 'easy' ? 'success' :
              question.difficulty === 'medium' ? 'warning' : 'error'
            }
          />
          {question.negativeMarks ? (
            <Chip label={`-${question.negativeMarks} neg`} size="small" color="error" variant="outlined" />
          ) : null}
        </Box>
        {!showResult && (
          <Box
            onClick={onToggleFlag}
            sx={{
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              color: isFlagged ? 'warning.main' : 'text.secondary',
              p: 0.5,
              borderRadius: 1,
              '&:hover': { bgcolor: 'action.hover' },
            }}
          >
            {isFlagged ? <FlagIcon /> : <FlagOutlineIcon />}
            <Typography variant="caption">
              {isFlagged ? 'Flagged' : 'Flag'}
            </Typography>
          </Box>
        )}
      </Box>

      {/* Question Text */}
      <Paper
        elevation={0}
        sx={{
          p: 2,
          mb: 3,
          bgcolor: getResultBg(),
          border: showResult ? 1 : 0,
          borderColor: getResultColor(),
        }}
      >
        <Typography variant="body1" sx={{ fontSize: { xs: '1rem', sm: '1.05rem', md: '1.1rem' }, lineHeight: 1.7 }}>
          {question.text}
        </Typography>
        {question.caseText && (
          <Paper variant="outlined" sx={{ p: 2, mt: 2, bgcolor: 'action.hover' }}>
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>
              {question.caseText}
            </Typography>
          </Paper>
        )}
        {question.hasImage && question.imageUrl && (
          <Box
            component="img"
            src={question.imageUrl}
            alt="Question"
            sx={{ maxWidth: '100%', maxHeight: 300, mt: 2, borderRadius: 1 }}
          />
        )}
      </Paper>

      {/* Answer Input */}
      <Box sx={{ pl: 1 }}>
        {(question.type === 'mcq' || question.type === 'true_false') && (
          <FormControl component="fieldset" sx={{ width: '100%' }}>
            <RadioGroup
              value={answer?.selectedOptionId || ''}
              onChange={(e) => handleMCQChange(e.target.value)}
            >
              {question.options?.map((opt) => {
                const isCorrect = showResult && correctAnswer === opt.id;
                const isSelected = answer?.selectedOptionId === opt.id;
                const isWrong = showResult && isSelected && !isCorrect;

                return (
                  <Paper
                    key={opt.id}
                    elevation={0}
                    sx={{
                      mb: 1,
                      p: 1.5,
                      border: 1,
                      borderColor: isCorrect ? 'success.main' : isWrong ? 'error.main' : 'divider',
                      bgcolor: isCorrect ? 'success.light' : isWrong ? 'error.light' : isSelected ? 'primary.light' : 'background.paper',
                      borderRadius: 2,
                      transition: 'all 0.2s',
                      '&:hover': !showResult ? { borderColor: 'primary.main', bgcolor: 'action.hover' } : {},
                    }}
                  >
                    <FormControlLabel
                      value={opt.id}
                      control={<Radio disabled={showResult} />}
                      label={
                        <Typography sx={{ fontSize: '1rem' }}>
                          <strong>{opt.id}.</strong> {opt.text}
                        </Typography>
                      }
                      sx={{ width: '100%', m: 0 }}
                    />
                  </Paper>
                );
              })}
            </RadioGroup>
          </FormControl>
        )}

        {question.type === 'multi_select' && (
          <FormControl component="fieldset" sx={{ width: '100%' }}>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
              Select all correct options
            </Typography>
            {question.options?.map((opt) => {
              const checked = answer?.selectedOptionIds?.includes(opt.id);
              return (
                <Paper
                  key={opt.id}
                  elevation={0}
                  sx={{
                    mb: 1,
                    p: 1.5,
                    border: 1,
                    borderColor: checked ? 'primary.main' : 'divider',
                    bgcolor: checked ? 'primary.light' : 'background.paper',
                    borderRadius: 2,
                    transition: 'all 0.2s',
                    '&:hover': !showResult ? { borderColor: 'primary.main', bgcolor: 'action.hover' } : {},
                  }}
                >
                  <FormControlLabel
                    checked={!!checked}
                    onChange={(e) => handleMultiSelectChange(opt.id, (e.target as HTMLInputElement).checked)}
                    control={<Checkbox disabled={showResult} />}
                    label={
                      <Typography sx={{ fontSize: '1rem' }}>
                        <strong>{opt.id}.</strong> {opt.text}
                      </Typography>
                    }
                    sx={{ width: '100%', m: 0 }}
                  />
                </Paper>
              );
            })}
          </FormControl>
        )}

        {question.type === 'fill_in_blank' && (
          <TextField
            fullWidth
            label="Your Answer"
            value={answer?.textAnswer || ''}
            onChange={(e) => handleTextChange(e.target.value)}
            disabled={showResult}
            {...guard}
            placeholder="Type your answer here..."
            sx={{ maxWidth: 500 }}
          />
        )}

        {question.type === 'short_answer' && (
          <TextField
            fullWidth
            multiline
            rows={3}
            label="Your Answer"
            value={answer?.textAnswer || ''}
            onChange={(e) => handleTextChange(e.target.value)}
            disabled={showResult}
            {...guard}
            placeholder="Write your short answer here..."
          />
        )}

        {question.type === 'long_answer' && (
          <TextField
            fullWidth
            multiline
            rows={8}
            label="Your Answer"
            value={answer?.textAnswer || ''}
            onChange={(e) => handleTextChange(e.target.value)}
            disabled={showResult}
            {...guard}
            placeholder="Write your detailed answer here..."
          />
        )}

        {question.type === 'numerical' && (
          <TextField
            fullWidth
            type="number"
            label="Your Answer"
            value={answer?.numericalAnswer ?? ''}
            onChange={(e) => handleNumericalChange(e.target.value)}
            disabled={showResult}
            {...guard}
            placeholder="Enter numerical value..."
            sx={{ maxWidth: 300 }}
          />
        )}

        {question.type === 'matching' && (
          <Typography color="text.secondary">
            Matching questions are not yet supported in online mode.
          </Typography>
        )}

        {question.type === 'assertion_reason' && (
          <FormControl component="fieldset" sx={{ width: '100%' }}>
            <RadioGroup
              value={answer?.selectedOptionId || ''}
              onChange={(e) => handleMCQChange(e.target.value)}
            >
              {[
                { id: 'A', text: 'Both Assertion and Reason are true and Reason is the correct explanation' },
                { id: 'B', text: 'Both Assertion and Reason are true but Reason is not the correct explanation' },
                { id: 'C', text: 'Assertion is true but Reason is false' },
                { id: 'D', text: 'Assertion is false but Reason is true' },
              ].map((opt) => (
                <FormControlLabel
                  key={opt.id}
                  value={opt.id}
                  control={<Radio disabled={showResult} />}
                  label={`${opt.id}. ${opt.text}`}
                />
              ))}
            </RadioGroup>
          </FormControl>
        )}

        {question.type === 'case_based' && (
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Read the case study above and answer:
            </Typography>
            <TextField
              fullWidth
              multiline
              rows={4}
              label="Your Answer"
              value={answer?.textAnswer || ''}
              onChange={(e) => handleTextChange(e.target.value)}
              disabled={showResult}
              {...guard}
            />
          </Box>
        )}
      </Box>

      {/* Result display */}
      {showResult && (
        <Box sx={{ mt: 3, p: 2, bgcolor: 'action.hover', borderRadius: 2 }}>
          <Typography variant="subtitle2" gutterBottom>
            Result:
          </Typography>
          <Chip
            label={resultStatus?.toUpperCase()}
            color={
              resultStatus === 'correct' ? 'success' :
              resultStatus === 'incorrect' ? 'error' :
              resultStatus === 'partial' ? 'warning' : 'default'
            }
            sx={{ mr: 1 }}
          />
          <Chip
            label={`${marksObtained || 0} / ${question.marks} marks`}
            variant="outlined"
          />
          {correctAnswer && (
            <Typography variant="body2" sx={{ mt: 1 }}>
              <strong>Correct Answer:</strong> {correctAnswer}
            </Typography>
          )}
        </Box>
      )}
    </Box>
  );
};

export default QuestionRenderer;