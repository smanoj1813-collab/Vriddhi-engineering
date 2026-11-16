// Unit tests for the result parsing in deploy-functions-batched.mjs.
// Run through the root test:unit script.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDeployOutput } from './deploy-functions-batched.mjs'

const NAMES = ['api', 'pdf', 'syncStudentsToAuth']

const successLine = (name, region = 'asia-south1', verb = 'update') =>
  `+  functions[${name}(${region})] Successful ${verb} operation.`

test('plain success lines are matched per function', () => {
  const out = [successLine('api'), successLine('pdf'), 'some other line'].join('\n')
  const { succeeded } = parseDeployOutput(out, 1, NAMES)
  assert.deepEqual([...succeeded].sort(), ['api', 'pdf'])
})

test('create operations are matched too', () => {
  const out = successLine('syncStudentsToAuth', 'asia-south1', 'create')
  const { succeeded } = parseDeployOutput(out, 1, NAMES)
  assert.deepEqual([...succeeded], ['syncStudentsToAuth'])
})

test('colour codes inside the success line do not hide the function name', () => {
  const out =
    '\x1b[32m+\x1b[39m  functions[\x1b[1mapi\x1b[22m(asia-south1)] Successful update operation.'
  const { succeeded } = parseDeployOutput(out, 1, NAMES)
  assert.deepEqual([...succeeded], ['api'])
})

test('Windows CRLF line endings are handled', () => {
  const out = `${successLine('api')}\r\n${successLine('pdf')}\r\n`
  const { succeeded } = parseDeployOutput(out, 1, NAMES)
  assert.deepEqual([...succeeded].sort(), ['api', 'pdf'])
})

test('clean exit with "Deploy complete!" counts the whole batch as deployed', () => {
  const out = [successLine('api'), 'Function URL (api(asia-south1)): https://x', '+  Deploy complete!'].join(
    '\n',
  )
  const { succeeded } = parseDeployOutput(out, 0, NAMES)
  assert.deepEqual([...succeeded].sort(), [...NAMES].sort())
})

test('non-zero exit ignores "Deploy complete!" and only trusts success lines', () => {
  const out = [successLine('api'), '+  Deploy complete!'].join('\n')
  const { succeeded } = parseDeployOutput(out, 1, NAMES)
  assert.deepEqual([...succeeded], ['api'])
})

test('clean exit without "Deploy complete!" only trusts success lines', () => {
  const out = successLine('pdf')
  const { succeeded } = parseDeployOutput(out, 0, NAMES)
  assert.deepEqual([...succeeded], ['pdf'])
})

test('quota failures with no success lines count nothing as deployed', () => {
  const out = [
    'Could not create or update Cloud Run service syncidentityclaims, Container Healthcheck failed. Quota exceeded for total allowable CPU per project per region.',
    '!  functions:  failed to update function projects/vriddhi-engineering/locations/asia-south1/functions/syncStudentsToAuth',
  ].join('\n')
  const { succeeded } = parseDeployOutput(out, 1, NAMES)
  assert.equal(succeeded.size, 0)
})

test('returned clean text has no escape codes', () => {
  const { clean } = parseDeployOutput('\x1b[31mred\x1b[0m\r\nplain', 1, NAMES)
  assert.equal(clean, 'red\nplain')
})
