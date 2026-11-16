#!/usr/bin/env node
// Deploys every Cloud Function in small batches and retries only the ones that
// failed. Use it instead of `npm run deploy:functions` when the project's
// regional Cloud Run CPU quota is tight: a full deploy updates all ~138
// functions at once, and each update starts a new Cloud Run revision that
// needs CPU while the old one is still serving. When the quota is hit, Firebase
// reports "Quota exceeded for total allowable CPU per project per region" and
// leaves those functions un-deployed.
//
// This script does not change any function code or runtime settings. It only
// changes how many functions each `firebase deploy` call touches.
//
// Usage (from the repo root):
//   node scripts/deploy-functions-batched.mjs [options]
//
// Options:
//   --project=<id>      Firebase project (default: vriddhi-engineering)
//   --batch-size=<n>    Functions per `firebase deploy` call (default: 10)
//   --wait=<seconds>    Pause between batches. Retry round N waits wait*N first
//                       (default: 120)
//   --retries=<n>       Retry rounds for functions that failed (default: 4)
//   --skip-build        Do not run `npm --prefix functions run build` first
//   --dry-run           Build and list the batches, but do not deploy
//
// Exit code is 0 only when every function reports a successful create/update.

import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FUNCTIONS_DIR = path.join(ROOT, 'functions')
const SUCCESS_RE = /functions\[([A-Za-z0-9_]+)\([^)]*\)\] Successful (?:update|create) operation/g
const NAMES_MARKER = '__VRIDDHI_FUNCTION_NAMES__'
const AUTH_ERROR_RE = /not logged in|Failed to authenticate|Please run firebase login|Error: HTTP Error: 401|HTTP Error: 403/i

function parseArgs(argv) {
  const opts = {
    project: 'vriddhi-engineering',
    batchSize: 10,
    wait: 120,
    retries: 4,
    skipBuild: false,
    dryRun: false,
  }
  for (const arg of argv) {
    if (arg === '--skip-build') {
      opts.skipBuild = true
      continue
    }
    if (arg === '--dry-run') {
      opts.dryRun = true
      continue
    }
    const match = arg.match(/^--(project|batch-size|wait|retries)=(.+)$/)
    if (!match) throw new Error(`Unknown argument: ${arg}`)
    const [, key, value] = match
    if (key === 'project') opts.project = value
    if (key === 'batch-size') opts.batchSize = Number(value)
    if (key === 'wait') opts.wait = Number(value)
    if (key === 'retries') opts.retries = Number(value)
  }
  if (!Number.isInteger(opts.batchSize) || opts.batchSize < 1) {
    throw new Error('--batch-size must be a positive integer')
  }
  if (!Number.isFinite(opts.wait) || opts.wait < 0) {
    throw new Error('--wait must be a number of seconds, 0 or more')
  }
  if (!Number.isInteger(opts.retries) || opts.retries < 0) {
    throw new Error('--retries must be a whole number, 0 or more')
  }
  return opts
}

function chunk(items, size) {
  const out = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function sleep(seconds) {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000))
}

function buildFunctions() {
  const res = spawnSync('npm --prefix functions run build', {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
  })
  if (res.status !== 0) throw new Error('functions build failed; nothing was deployed')
}

// Loads the compiled functions/lib/index.js and returns the names of every
// export that is a Cloud Function. This matches what `firebase deploy` sees.
function discoverFunctionNames() {
  const script =
    `const m = require('./lib/index.js');` +
    `const names = Object.keys(m).filter((k) => m[k] && typeof m[k] === 'function' && m[k].__endpoint);` +
    `console.log('${NAMES_MARKER}' + JSON.stringify(names));` +
    `process.exit(0);`
  const res = spawnSync(process.execPath, ['-e', script], {
    cwd: FUNCTIONS_DIR,
    encoding: 'utf8',
  })
  if (res.status !== 0) {
    throw new Error(`Could not load functions/lib/index.js:\n${res.stderr}`)
  }
  const line = res.stdout.split('\n').find((l) => l.startsWith(NAMES_MARKER))
  if (!line) throw new Error('Function name discovery printed no names')
  return JSON.parse(line.slice(NAMES_MARKER.length))
}

// Runs one `firebase deploy --only functions:a,functions:b` call. Streams the
// output to the console and returns the names that reported success.
// Firebase prompts are not expected for --only deploys, since nothing is
// deleted, so stdin is inherited but the output is piped for parsing.
function deployBatch(names, opts) {
  const only = names.map((n) => `functions:${n}`).join(',')
  const cmd = `npx firebase deploy --only ${only} --project ${opts.project}`
  return new Promise((resolve) => {
    let output = ''
    const onData = (chunkBuf) => {
      const text = chunkBuf.toString()
      output += text
      process.stdout.write(text)
    }
    const child = spawn(cmd, { cwd: ROOT, shell: true, stdio: ['inherit', 'pipe', 'pipe'] })
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('close', (exitCode) => {
      const succeeded = new Set([...output.matchAll(SUCCESS_RE)].map((m) => m[1]))
      resolve({ exitCode, succeeded, output })
    })
  })
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))

  if (!opts.skipBuild) buildFunctions()
  const all = discoverFunctionNames()
  const firstPass = chunk(all, opts.batchSize)
  console.log(
    `\nFound ${all.length} functions. ${firstPass.length} batch(es) of up to ${opts.batchSize}, ` +
      `project ${opts.project}.`,
  )

  if (opts.dryRun) {
    firstPass.forEach((batch, i) => {
      console.log(`\nBatch ${i + 1}/${firstPass.length} (${batch.length}):`)
      console.log(`  ${batch.join(', ')}`)
    })
    console.log('\nDry run: nothing deployed.')
    return
  }

  let pending = all
  for (let round = 0; round <= opts.retries && pending.length > 0; round++) {
    if (round > 0) {
      const waitSeconds = opts.wait * round
      console.log(
        `\nRetry round ${round}: ${pending.length} function(s) did not deploy. ` +
          `Waiting ${waitSeconds}s for the CPU quota to free up...`,
      )
      await sleep(waitSeconds)
    }

    const batches = chunk(pending, opts.batchSize)
    const stillFailing = []
    for (let i = 0; i < batches.length; i++) {
      const label = round === 0 ? 'Batch' : 'Retry batch'
      console.log(`\n=== ${label} ${i + 1}/${batches.length} (${batches[i].length} functions) ===`)
      const { exitCode, succeeded, output } = await deployBatch(batches[i], opts)

      if (AUTH_ERROR_RE.test(output)) {
        console.error('\nFirebase reported an authentication error. Fix the login, then re-run.')
        process.exitCode = 1
        return
      }

      const failed = batches[i].filter((n) => !succeeded.has(n))
      console.log(
        `→ ${batches[i].length - failed.length} ok, ${failed.length} failed (firebase exit ${exitCode})`,
      )
      stillFailing.push(...failed)

      if (i < batches.length - 1) await sleep(opts.wait)
    }
    pending = stillFailing
  }

  if (pending.length === 0) {
    console.log(`\n✔ All ${all.length} functions deployed.`)
    return
  }

  console.log(`\n✖ ${pending.length} function(s) still not deployed:`)
  console.log(`  ${pending.join(', ')}`)
  console.log('Wait a few minutes and re-run: node scripts/deploy-functions-batched.mjs')
  process.exitCode = 1
}

main().catch((err) => {
  console.error(`\n${err.message || err}`)
  process.exitCode = 1
})
