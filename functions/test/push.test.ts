import test from 'node:test'
import assert from 'node:assert/strict'
import { chunk, isDeadTokenCode, MULTICAST_LIMIT } from '../src/push'

test('tokens are sent in batches of at most 500 (FCM multicast limit)', () => {
  const tokens = Array.from({ length: 1203 }, (_, i) => `t${i}`)
  const batches = chunk(tokens)
  assert.equal(MULTICAST_LIMIT, 500)
  assert.deepEqual(batches.map(b => b.length), [500, 500, 203])
  assert.deepEqual(batches.flat(), tokens)
})

test('an empty token list produces no batches', () => {
  assert.deepEqual(chunk([]), [])
})

test('only "gone" token errors cause the device record to be removed', () => {
  assert.equal(isDeadTokenCode('messaging/registration-token-not-registered'), true)
  assert.equal(isDeadTokenCode('messaging/invalid-registration-token'), true)
  // Transient errors must keep the token.
  assert.equal(isDeadTokenCode('messaging/internal-error'), false)
  assert.equal(isDeadTokenCode('messaging/server-unavailable'), false)
  assert.equal(isDeadTokenCode(undefined), false)
})
