// src/shared/utils/obeCsv.ts
//
// Paste-from-Excel import for attainment runs (manual path until Slice 4 wires
// assessment marks automatically). Two long formats, headers required:
//
//   Scores:   studentId, co, obtained, max
//   Surveys:  co, score, maxScore
//
// Pure + unit tested. Returns the valid rows AND every row error with line
// numbers; the run dialog blocks compute while any error remains — SAR
// evidence must be clean, never "imported except 3 rows nobody noticed".

export interface ObeCsvScoresResult {
  rows: { studentId: string; co: string; obtained: number; max: number }[];
  errors: string[];
}

export interface ObeCsvSurveysResult {
  surveys: { co: string; score: number; maxScore: number }[];
  errors: string[];
}

function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

function cells(line: string): string[] {
  // Excel paste is tab-separated when coming from a sheet, comma-separated
  // from a CSV file — accept both, tabs win when both are present.
  const parts = line.includes('\t') ? line.split('\t') : line.split(',');
  return parts.map((c) => c.trim().replace(/^"|"$/g, ''));
}

function headerIndex(header: string[], names: string[]): number {
  const lowered = header.map((h) => h.toLowerCase().replace(/[\s_]+/g, ''));
  for (const name of names) {
    const hit = lowered.indexOf(name);
    if (hit >= 0) return hit;
  }
  return -1;
}

/** Parses long-format CO scores; `coCodes` is the mapping's CO list. */
export function parseObeScoresCsv(text: string, coCodes: string[]): ObeCsvScoresResult {
  const rows: ObeCsvScoresResult['rows'] = [];
  const errors: string[] = [];
  const allowed = new Set(coCodes.map((c) => c.toUpperCase()));
  const lines = splitLines(text);
  if (lines.length === 0) return { rows, errors: ['No rows found — paste a header plus at least one row.'] };

  const header = cells(lines[0]);
  const iStudent = headerIndex(header, ['studentid', 'student', 'rollno', 'rollnumber', 'usn']);
  const iCo = headerIndex(header, ['co', 'courseoutcome', 'outcome']);
  const iObtained = headerIndex(header, ['obtained', 'scored', 'marks', 'score']);
  const iMax = headerIndex(header, ['max', 'maxmarks', 'outof', 'total']);
  if (iStudent < 0 || iCo < 0 || iObtained < 0 || iMax < 0) {
    return { rows, errors: ['Header must name studentId, co, obtained and max (e.g. "studentId,co,obtained,max").'] };
  }

  const seen = new Set<string>();
  lines.slice(1).forEach((line, index) => {
    const lineNo = index + 2;
    const cols = cells(line);
    const studentId = (cols[iStudent] ?? '').trim();
    const co = (cols[iCo] ?? '').trim().toUpperCase();
    const obtained = Number(cols[iObtained]);
    const max = Number(cols[iMax]);
    if (!studentId) {
      errors.push(`Row ${lineNo}: missing studentId.`);
      return;
    }
    if (!allowed.has(co)) {
      errors.push(`Row ${lineNo}: "${co || '?'}" is not a CO on this mapping (${coCodes.join(', ') || 'none'}).`);
      return;
    }
    if (!Number.isFinite(obtained) || obtained < 0) {
      errors.push(`Row ${lineNo}: obtained must be a number ≥ 0.`);
      return;
    }
    if (!Number.isFinite(max) || max <= 0) {
      errors.push(`Row ${lineNo}: max must be a number > 0.`);
      return;
    }
    if (obtained > max) {
      errors.push(`Row ${lineNo}: obtained (${obtained}) exceeds max (${max}).`);
      return;
    }
    const key = `${studentId} ${co}`;
    if (seen.has(key)) {
      errors.push(`Row ${lineNo}: duplicate entry for ${studentId} / ${co}.`);
      return;
    }
    seen.add(key);
    rows.push({ studentId, co, obtained, max });
  });

  if (rows.length === 0 && errors.length === 0) errors.push('No data rows found below the header.');
  return { rows, errors };
}

/** Parses long-format indirect-survey responses. */
export function parseObeSurveysCsv(text: string, coCodes: string[]): ObeCsvSurveysResult {
  const surveys: ObeCsvSurveysResult['surveys'] = [];
  const errors: string[] = [];
  const allowed = new Set(coCodes.map((c) => c.toUpperCase()));
  const lines = splitLines(text);
  if (lines.length === 0) return { surveys, errors: [] };

  const header = cells(lines[0]);
  const iCo = headerIndex(header, ['co', 'courseoutcome', 'outcome']);
  const iScore = headerIndex(header, ['score', 'rating', 'obtained']);
  const iMax = headerIndex(header, ['maxscore', 'max', 'scale', 'outof']);
  if (iCo < 0 || iScore < 0 || iMax < 0) {
    return { surveys, errors: ['Survey header must name co, score and maxScore (e.g. "co,score,maxScore").'] };
  }

  lines.slice(1).forEach((line, index) => {
    const lineNo = index + 2;
    const cols = cells(line);
    const co = (cols[iCo] ?? '').trim().toUpperCase();
    const score = Number(cols[iScore]);
    const maxScore = Number(cols[iMax]);
    if (!allowed.has(co)) {
      errors.push(`Survey row ${lineNo}: "${co || '?'}" is not a CO on this mapping.`);
      return;
    }
    if (!Number.isFinite(score) || score < 0) {
      errors.push(`Survey row ${lineNo}: score must be a number ≥ 0.`);
      return;
    }
    if (!Number.isFinite(maxScore) || maxScore <= 0) {
      errors.push(`Survey row ${lineNo}: maxScore must be a number > 0.`);
      return;
    }
    if (score > maxScore) {
      errors.push(`Survey row ${lineNo}: score (${score}) exceeds maxScore (${maxScore}).`);
      return;
    }
    surveys.push({ co, score, maxScore });
  });
  return { surveys, errors };
}

/** Escapes one CSV cell (commas, quotes and newlines, per Excel). */
function escapeCell(value: string | number | null | undefined): string {
  if (value == null) return '';
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Builds the SAR evidence CSV for one computed run — the same two tables the
 * reviewer sees on screen (CO attainment, PO/PSO attainment), so the Excel
 * cross-check colleges keep on file always matches the UI.
 */
export function buildSarResultsCsv(args: {
  courseCode: string;
  label?: string;
  students: number;
  tools: string[];
  coRows: { co: string; statement?: string; direct: number; indirect: number | null; combined: number; target?: number; status: string }[];
  outcomeRows: { outcome: string; title?: string; attainment: number; target?: number; gap?: number; status: string }[];
}): string {
  const lines = [
    ['course', 'run', 'students', 'tools'].map(escapeCell).join(','),
    [args.courseCode, args.label || '', args.students, args.tools.join(' + ')].map(escapeCell).join(','),
    '',
    ['CO attainment'].map(escapeCell).join(','),
    ['co', 'statement', 'direct', 'indirect', 'combined', 'target', 'status'].map(escapeCell).join(','),
    ...args.coRows.map((r) =>
      [r.co, r.statement || '', r.direct, r.indirect, r.combined, r.target, r.status].map(escapeCell).join(','),
    ),
    '',
    ['PO/PSO attainment'].map(escapeCell).join(','),
    ['outcome', 'title', 'attainment', 'target', 'gap', 'status'].map(escapeCell).join(','),
    ...args.outcomeRows.map((r) =>
      [r.outcome, r.title || '', r.attainment, r.target, r.gap, r.status].map(escapeCell).join(','),
    ),
  ];
  return `${lines.join('\n')}\n`;
}

/** Folds long CSV rows into the per-student shape the engine consumes. */
export function foldScoresToStudents(
  rows: ObeCsvScoresResult['rows'],
): { studentId: string; coScores: Record<string, { obtained: number; max: number }> }[] {
  const byStudent = new Map<string, Record<string, { obtained: number; max: number }>>();
  const ordered: string[] = [];
  for (const row of rows) {
    if (!byStudent.has(row.studentId)) {
      byStudent.set(row.studentId, {});
      ordered.push(row.studentId);
    }
    byStudent.get(row.studentId)![row.co] = { obtained: row.obtained, max: row.max };
  }
  return ordered.map((studentId) => ({ studentId, coScores: byStudent.get(studentId)! }));
}
