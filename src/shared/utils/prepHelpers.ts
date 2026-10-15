// src/shared/utils/prepHelpers.ts
//
// Pure helpers for Prep content UI, progress tracking, and formatting.
// Free of React/DOM dependencies for unit testing.

export interface MinimalPrepTopic {
  id: string
  difficulty?: string
  [key: string]: any
}

export function filterTopicsByDifficulty(
  topics: MinimalPrepTopic[],
  difficulty?: string | null
): MinimalPrepTopic[] {
  if (!Array.isArray(topics)) return []
  if (!difficulty || difficulty === 'all') return [...topics]
  return topics.filter((t) => t.difficulty?.toLowerCase() === difficulty.toLowerCase())
}

export function calculateSubjectProgress(
  topics: MinimalPrepTopic[],
  completedMap?: Record<string, { completed?: boolean }> | null
): { completed: number; total: number; percentage: number } {
  if (!Array.isArray(topics) || topics.length === 0) {
    return { completed: 0, total: 0, percentage: 0 }
  }

  const total = topics.length
  let completed = 0

  if (completedMap) {
    for (const t of topics) {
      if (completedMap[t.id]?.completed) {
        completed++
      }
    }
  }

  const percentage = Math.round((completed / total) * 100)
  return { completed, total, percentage }
}

export function formatStreamLabel(stream?: string | null): string {
  if (!stream) return 'General'
  const mapping: Record<string, string> = {
    management: 'Management & OB',
    commerce: 'Commerce & Accounting',
    economics: 'Managerial Economics',
    aptitude: 'Quantitative Aptitude & Reasoning',
    communication: 'Verbal Ability & Communication',
    finance: 'Financial Management',
    law: 'Business & Company Law',
    strategy: 'Strategic Management',
    operations: 'Operations & SCM',
    taxation: 'Taxation & GST',
    computing: 'Computing & Engineering',
    electronics: 'Electronics & Communication',
    learning: 'Learning & Problem Solving',
  }
  return mapping[stream.toLowerCase()] || stream.charAt(0).toUpperCase() + stream.slice(1)
}

export function formatDifficultyBadge(difficulty?: string | null): {
  label: string
  color: string
  bg: string
} {
  const norm = (difficulty || '').toLowerCase()
  switch (norm) {
    case 'basic':
      return { label: 'Foundation', color: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800' }
    case 'advanced':
      return { label: 'Advanced', color: 'text-purple-700 dark:text-purple-300', bg: 'bg-purple-50 dark:bg-purple-950/40 border-purple-200 dark:border-purple-800' }
    case 'core':
    default:
      return { label: 'Core', color: 'text-blue-700 dark:text-blue-300', bg: 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800' }
  }
}

export function cleanKatexFormula(formula?: string | null): string {
  if (!formula) return ''
  return formula.trim().replace(/^\\\[/, '').replace(/\\\]$/, '').trim()
}

export interface UniversityCrosswalkInfo {
  code: string
  name: string
  shortName: string
  syllabusAuthority: string
  examScheme: string
  questionPaperPattern: {
    partA: string
    partB: string
    partC: string
    totalMarks: number
  }
}

export const KARNATAKA_UNIVERSITIES: Record<string, UniversityCrosswalkInfo> = {
  bu: {
    code: 'bu',
    name: 'Bangalore University (Jnana Bharathi Campus)',
    shortName: 'BU',
    syllabusAuthority: 'KSHEC NEP BBA Curriculum',
    examScheme: '60 Marks External + 40 Marks Internal Assessment',
    questionPaperPattern: {
      partA: 'Section A: Answer 5 of 7 questions (2 Marks each = 10 Marks)',
      partB: 'Section B: Answer 4 of 6 questions (5 Marks each = 20 Marks)',
      partC: 'Section C: Answer 2 of 4 questions (15 Marks each = 30 Marks)',
      totalMarks: 60,
    },
  },
  bcu: {
    code: 'bcu',
    name: 'Bengaluru City University (Central College Campus)',
    shortName: 'BCU',
    syllabusAuthority: 'KSHEC NEP BBA Curriculum',
    examScheme: '60 Marks External + 40 Marks Internal Assessment',
    questionPaperPattern: {
      partA: 'Section A: Answer 5 of 7 short concept questions (2 Marks each = 10 Marks)',
      partB: 'Section B: Answer 4 of 6 analytical questions (5 Marks each = 20 Marks)',
      partC: 'Section C: Answer 2 of 4 practical/case questions (15 Marks each = 30 Marks)',
      totalMarks: 60,
    },
  },
  bnu: {
    code: 'bnu',
    name: 'Bengaluru North University (Tamaka Campus)',
    shortName: 'BNU',
    syllabusAuthority: 'KSHEC NEP BBA Curriculum',
    examScheme: '60 Marks External + 40 Marks Internal Assessment',
    questionPaperPattern: {
      partA: 'Section A: Answer 5 of 7 definition questions (2 Marks each = 10 Marks)',
      partB: 'Section B: Answer 4 of 6 computational questions (5 Marks each = 20 Marks)',
      partC: 'Section C: Answer 2 of 4 comprehensive questions (15 Marks each = 30 Marks)',
      totalMarks: 60,
    },
  },
  uom: {
    code: 'uom',
    name: 'University of Mysore (Manasagangotri Campus)',
    shortName: 'UOM',
    syllabusAuthority: 'UOM CBCS NEP Regulation',
    examScheme: '70 Marks External + 30 Marks Internal Assessment',
    questionPaperPattern: {
      partA: 'Section A: 5 Compulsory questions (2 Marks each = 10 Marks)',
      partB: 'Section B: Answer 4 of 6 questions (5 Marks each = 20 Marks)',
      partC: 'Section C: Answer 4 of 6 long essay/problem questions (10 Marks each = 40 Marks)',
      totalMarks: 70,
    },
  },
  vtu: {
    code: 'vtu',
    name: 'Visvesvaraya Technological University (Belagavi)',
    shortName: 'VTU',
    syllabusAuthority: 'VTU Management Studies Board',
    examScheme: '50/100 Marks Scaled Examination Scheme',
    questionPaperPattern: {
      partA: 'Module 1 & 2: Compulsory numerical/analytical choice (20 Marks)',
      partB: 'Module 3 & 4: Application and design problems (20 Marks)',
      partC: 'Module 5: Integrated business case analysis (20 Marks)',
      totalMarks: 60,
    },
  },
}

export function getUniversityCrosswalk(uniCode?: string | null): UniversityCrosswalkInfo | null {
  if (!uniCode || uniCode === 'all') return null
  return KARNATAKA_UNIVERSITIES[uniCode.toLowerCase()] || null
}

export function generateCheatSheetMarkdown(params: {
  subjectName: string
  topicTitle: string
  moduleName?: string
  syllabusRef?: string
  formulas?: Array<{ label: string; formula: string; exampleQ?: string; exampleA?: string }>
  tricks?: Array<{ title: string; trick: string; whenToUse?: string }>
  howToSolve?: Array<{ step: string; detail: string; questionType?: string }>
}): string {
  const lines: string[] = []
  lines.push(`# ${params.topicTitle} — Rapid Revision Cheat Sheet`)
  lines.push(`**Subject:** ${params.subjectName}${params.moduleName ? ` | **Module:** ${params.moduleName}` : ''}`)
  if (params.syllabusRef) {
    lines.push(`**Syllabus Ref:** ${params.syllabusRef}`)
  }
  lines.push(`*Generated by Vriddhi Prep · Aligned with KSHEC NEP Karnataka Universities*`)
  lines.push(`\n---\n`)

  // Formulas
  if (params.formulas && params.formulas.length > 0) {
    lines.push(`## 1. High-Yield Formulas & Definitions`)
    params.formulas.forEach((f, i) => {
      lines.push(`### ${i + 1}. ${f.label}`)
      lines.push(`$$\\mathbf{${cleanKatexFormula(f.formula)}}$$`)
      if (f.exampleQ) {
        lines.push(`- **Problem:** ${f.exampleQ}`)
      }
      if (f.exampleA) {
        lines.push(`- **Solution:** ${f.exampleA}`)
      }
      lines.push('')
    })
  }

  // Tricks & Shortcuts
  if (params.tricks && params.tricks.length > 0) {
    lines.push(`## 2. Examiner Shortcuts & Pitfall Warnings`)
    params.tricks.forEach((t, i) => {
      lines.push(`### ${i + 1}. ${t.title}`)
      lines.push(`> ${t.trick}`)
      if (t.whenToUse) {
        lines.push(`*When to use:* ${t.whenToUse}`)
      }
      lines.push('')
    })
  }

  // How to solve
  if (params.howToSolve && params.howToSolve.length > 0) {
    lines.push(`## 3. Step-by-Step Problem Solving Sequence`)
    params.howToSolve.forEach((h, i) => {
      lines.push(`**Step ${i + 1}: ${h.step}**${h.questionType ? ` *(${h.questionType})*` : ''}`)
      lines.push(`${h.detail}\n`)
    })
  }

  return lines.join('\n')
}

