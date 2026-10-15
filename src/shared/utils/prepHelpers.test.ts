// src/shared/utils/prepHelpers.test.ts
//
// Decision-table unit tests for Prep content pure client helpers.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  filterTopicsByDifficulty,
  calculateSubjectProgress,
  formatStreamLabel,
  formatDifficultyBadge,
  cleanKatexFormula,
  getUniversityCrosswalk,
  generateCheatSheetMarkdown,
} from './prepHelpers.ts'

describe('filterTopicsByDifficulty', () => {
  const sampleTopics: any[] = [
    { id: 't1', title: 'Fayol Principles', difficulty: 'basic' },
    { id: 't2', title: 'BEP Analysis', difficulty: 'core' },
    { id: 't3', title: 'DCF & WACC', difficulty: 'advanced' },
    { id: 't4', title: 'Double Entry', difficulty: 'basic' },
  ]

  it('returns all topics when difficulty is null, undefined, or "all"', () => {
    assert.equal(filterTopicsByDifficulty(sampleTopics, null).length, 4)
    assert.equal(filterTopicsByDifficulty(sampleTopics, undefined).length, 4)
    assert.equal(filterTopicsByDifficulty(sampleTopics, 'all').length, 4)
  })

  it('filters accurately by difficulty case-insensitively', () => {
    const basic = filterTopicsByDifficulty(sampleTopics, 'basic')
    assert.equal(basic.length, 2)
    assert.deepEqual(basic.map((t) => t.id), ['t1', 't4'])

    const adv = filterTopicsByDifficulty(sampleTopics, 'ADVANCED')
    assert.equal(adv.length, 1)
    assert.equal(adv[0].id, 't3')
  })

  it('tolerates non-array inputs safely', () => {
    assert.deepEqual(filterTopicsByDifficulty(null as any, 'basic'), [])
    assert.deepEqual(filterTopicsByDifficulty(undefined as any, 'basic'), [])
  })
})

describe('calculateSubjectProgress', () => {
  const topics: any[] = [
    { id: 't1' },
    { id: 't2' },
    { id: 't3' },
    { id: 't4' },
  ]

  it('returns 0% when no topics are completed', () => {
    assert.deepEqual(calculateSubjectProgress(topics, null), { completed: 0, total: 4, percentage: 0 })
    assert.deepEqual(calculateSubjectProgress(topics, {}), { completed: 0, total: 4, percentage: 0 })
  })

  it('computes rounded percentage when topics are partially completed', () => {
    const completedMap = {
      t1: { completed: true },
      t2: { completed: false },
      t3: { completed: true },
    }
    const res = calculateSubjectProgress(topics, completedMap)
    assert.deepEqual(res, { completed: 2, total: 4, percentage: 50 })
  })

  it('returns 100% when all topics completed', () => {
    const completedMap = {
      t1: { completed: true },
      t2: { completed: true },
      t3: { completed: true },
      t4: { completed: true },
    }
    assert.deepEqual(calculateSubjectProgress(topics, completedMap), { completed: 4, total: 4, percentage: 100 })
  })

  it('handles empty topic lists gracefully without division by zero', () => {
    assert.deepEqual(calculateSubjectProgress([], {}), { completed: 0, total: 0, percentage: 0 })
  })
})

describe('formatStreamLabel', () => {
  it('maps standard stream codes to human-friendly academic titles', () => {
    assert.equal(formatStreamLabel('management'), 'Management & OB')
    assert.equal(formatStreamLabel('commerce'), 'Commerce & Accounting')
    assert.equal(formatStreamLabel('economics'), 'Managerial Economics')
    // 'aptitude' is the shared placement track (QA + LR + Verbal), not a stats elective.
    assert.equal(formatStreamLabel('aptitude'), 'Quantitative Aptitude & Reasoning')
    assert.equal(formatStreamLabel('communication'), 'Verbal Ability & Communication')
    assert.equal(formatStreamLabel('learning'), 'Learning & Problem Solving')
    assert.equal(formatStreamLabel('finance'), 'Financial Management')
    assert.equal(formatStreamLabel('law'), 'Business & Company Law')
    assert.equal(formatStreamLabel('strategy'), 'Strategic Management')
    assert.equal(formatStreamLabel('operations'), 'Operations & SCM')
    assert.equal(formatStreamLabel('taxation'), 'Taxation & GST')
    assert.equal(formatStreamLabel('computing'), 'Computing & Engineering')
    assert.equal(formatStreamLabel('electronics'), 'Electronics & Communication')
  })

  it('falls back to capitalized string or General when empty', () => {
    assert.equal(formatStreamLabel(''), 'General')
    assert.equal(formatStreamLabel(null), 'General')
    assert.equal(formatStreamLabel('custom'), 'Custom')
  })
})

describe('formatDifficultyBadge', () => {
  it('returns appropriate styling tokens for each difficulty level', () => {
    const b = formatDifficultyBadge('basic')
    assert.equal(b.label, 'Foundation')

    const c = formatDifficultyBadge('core')
    assert.equal(c.label, 'Core')

    const a = formatDifficultyBadge('advanced')
    assert.equal(a.label, 'Advanced')
  })
})

describe('cleanKatexFormula', () => {
  it('trims and removes display math wrappers', () => {
    assert.equal(cleanKatexFormula('\\[ E = mc^2 \\]'), 'E = mc^2')
    assert.equal(cleanKatexFormula(''), '')
    assert.equal(cleanKatexFormula(null), '')
  })
})

describe('getUniversityCrosswalk', () => {
  it('returns valid university crosswalk specs for Karnataka institutions', () => {
    const bu = getUniversityCrosswalk('bu')
    assert.ok(bu)
    assert.equal(bu.shortName, 'BU')
    assert.equal(bu.questionPaperPattern.totalMarks, 60)

    const uom = getUniversityCrosswalk('uom')
    assert.ok(uom)
    assert.equal(uom.shortName, 'UOM')
    assert.equal(uom.questionPaperPattern.totalMarks, 70)
  })

  it('returns null for all, null, undefined or unknown codes', () => {
    assert.equal(getUniversityCrosswalk('all'), null)
    assert.equal(getUniversityCrosswalk(null), null)
    assert.equal(getUniversityCrosswalk(undefined), null)
    assert.equal(getUniversityCrosswalk('oxford'), null)
  })
})

describe('generateCheatSheetMarkdown', () => {
  it('generates structured printable cheat sheet markdown with formulas and shortcuts', () => {
    const md = generateCheatSheetMarkdown({
      subjectName: 'Cost Accounting',
      topicTitle: 'Machine Hour Rate (MHR)',
      moduleName: 'Module 4: Overhead Accounting',
      syllabusRef: 'KSHEC NEP Sem-3',
      formulas: [
        { label: 'MHR Composite', formula: 'MHR = Standing/Hr + Machine/Hr', exampleQ: 'Cost 1L', exampleA: 'MHR = 17.90' },
      ],
      tricks: [
        { title: 'Idle Time Trap', trick: 'Always subtract unproductive setup time!', whenToUse: 'When setting-up time is unproductive' },
      ],
      howToSolve: [
        { step: 'Calculate Productive Hours', detail: 'Total hours minus idle hours' },
      ],
    })

    assert.ok(md.includes('# Machine Hour Rate (MHR) — Rapid Revision Cheat Sheet'))
    assert.ok(md.includes('Cost Accounting'))
    assert.ok(md.includes('Module 4: Overhead Accounting'))
    assert.ok(md.includes('MHR Composite'))
    assert.ok(md.includes('Idle Time Trap'))
    assert.ok(md.includes('Calculate Productive Hours'))
    assert.ok(md.includes('KSHEC NEP Sem-3'))
  })
})

