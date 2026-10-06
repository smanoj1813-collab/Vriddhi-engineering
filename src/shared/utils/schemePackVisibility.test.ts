import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  HIDDEN_SCHEME_PACK_CODES,
  filterVisibleSchemePacks,
  isHiddenSchemePack,
} from './schemePackVisibility'
import { SCHEME_PACK_PRESETS } from '../types/schemePack'

const listed = SCHEME_PACK_PRESETS.map((pack) => ({ pack, origin: 'preset' as const }))

test('the three legacy non-engineering presets are the hidden set', () => {
  assert.deepEqual([...HIDDEN_SCHEME_PACK_CODES], [
    'BCU_SEP_2024',
    'KUD_NEP_CBAE',
    'GENERIC_NEP_2020',
  ])
  assert.equal(isHiddenSchemePack('BCU_SEP_2024'), true)
  assert.equal(isHiddenSchemePack('VTU_2022_BE_BTECH'), false)
  assert.equal(isHiddenSchemePack(null), false)
  assert.equal(isHiddenSchemePack(''), false)
})

test('the picker lists the engineering presets only', () => {
  assert.deepEqual(
    filterVisibleSchemePacks(listed).map((item) => item.pack.code),
    ['VTU_2022_BE_BTECH', 'AUTONOMOUS_ENGINEERING_5050'],
  )
})

test('college custom packs are never filtered, whatever their code', () => {
  const custom = {
    pack: { code: 'BCU_SEP_2024', id: 'college__clone' },
    origin: 'custom' as const,
  }
  assert.deepEqual(
    filterVisibleSchemePacks([...listed, custom]).map((item) => item.pack.id),
    ['VTU_2022_BE_BTECH', 'AUTONOMOUS_ENGINEERING_5050', 'college__clone'],
  )
})

test('hidden presets stay resolvable for colleges already assigned to them', () => {
  // Hiding is a picker concern only — the pack objects remain in the preset
  // index so existing assignments keep their real rules.
  for (const code of HIDDEN_SCHEME_PACK_CODES) {
    assert.ok(SCHEME_PACK_PRESETS.some((p) => p.code === code), code)
  }
})
