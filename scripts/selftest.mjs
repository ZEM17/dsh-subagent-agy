#!/usr/bin/env node
/**
 * Self-test for @dsh-external/dsh-subagent-antigravity.
 *
 * Usage:
 *   node scripts/selftest.mjs          offline checks (no agy login needed)
 *   node scripts/selftest.mjs --e2e    offline checks + a real PONG round trip
 *                                      and follow-up (requires an agy login)
 *
 * Exit code 0 = all checks passed; 1 = at least one check failed.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url)) + '/..'
const E2E = process.argv.includes('--e2e')
let failures = 0

function report(name, detail) {
  failures += 1
  console.error(`  FAIL  ${name}: ${detail}`)
}
function pass(name) {
  console.log(`  PASS  ${name}`)
}

/** Run one command, capturing stdout/stderr, bounded by a kill timeout. */
function run(argv, { timeoutMs = 30_000, env = process.env } = {}) {
  return new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)
    child.stdout.on('data', (d) => {
      stdout += d
    })
    child.stderr.on('data', (d) => {
      stderr += d
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr, timedOut })
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ code: null, stdout, stderr, timedOut, error })
    })
  })
}

/** Locate the agy executable: PATH, AGY_BIN, then well-known install dirs. */
function resolveAgy() {
  const exeName = process.platform === 'win32' ? 'agy.exe' : 'agy'
  if (process.env.AGY_BIN) return process.env.AGY_BIN
  const home = process.env.USERPROFILE ?? process.env.HOME
  const candidates = []
  if (process.env.LOCALAPPDATA) candidates.push(join(process.env.LOCALAPPDATA, 'agy', 'bin', exeName))
  if (home) {
    candidates.push(join(home, '.local', 'bin', exeName))
    candidates.push(join(home, '.gemini', 'bin', exeName))
    candidates.push(join(home, 'go', 'bin', exeName))
  }
  for (const candidate of candidates) if (existsSync(candidate)) return candidate
  return undefined
}

function parseJsonReply(text) {
  for (const line of text.split(/\r?\n/)) {
    const candidate = line.trim()
    if (candidate.length === 0 || candidate[0] !== '{') continue
    try {
      const obj = JSON.parse(candidate)
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        if ('status' in obj || 'conversation_id' in obj || 'response' in obj) return obj
      }
    } catch {
      // keep scanning
    }
  }
  return undefined
}

console.log('== agy presence ==')
const agy = resolveAgy()
if (agy) {
  pass(`found agy at ${agy}`)
} else {
  report('agy presence', 'agy not found on PATH or in known install dirs (set AGY_BIN or install agy)')
}

if (agy) {
  console.log('== flag probe (agy help) ==')
  const probe = await run([agy, 'help'])
  const text = probe.stdout + probe.stderr
  const has = (flag) => new RegExp(`--${flag}(?:\\s|=)`).test(text)
  for (const flag of ['output-format', 'conversation', 'sandbox', 'prompt-file', 'print-timeout']) {
    const supported = has(flag)
    if (supported) pass(`--${flag} supported`)
    else if (flag === 'prompt-file') pass('--prompt-file absent (expected on current agy)')
    else report(`--${flag} supported`, 'flag not listed in agy help — the plugin will adapt, but verify the installed version')
  }
  if (probe.timedOut) report('flag probe', 'agy help hung')

  console.log('== registry round trip ==')
  try {
    const plugin = await import(pathToFileURL(join(ROOT, 'lib/index.js')).href)
    const dir = mkdtempSync(join(tmpdir(), 'agy-selftest-'))
    try {
      const registryPath = join(dir, 'nested', 'registry.json')
      const config = { registryPath }
      await plugin.saveTaskRegistry(config, {
        t1: { conversationId: 'conv-1', cwd: 'cwd-1', label: 'selftest', createdAt: Date.now() },
      })
      const loaded = plugin.loadTaskRegistry(config)
      if (loaded.t1?.conversationId === 'conv-1') {
        pass('save + load round trip')
      } else {
        report('registry round trip', `unexpected loaded value: ${JSON.stringify(loaded)}`)
      }
      const leftovers = readdirSync(dir, { recursive: true }).filter((f) => String(f).includes('.tmp'))
      if (leftovers.length === 0) {
        pass('no temp files left behind (atomic write)')
      } else {
        report('registry atomic write', `temp files remain: ${leftovers.join(', ')}`)
      }

      // Corrupt registry: backed up once (mtime-guarded) and reset — the
      // next save must never silently overwrite the damaged history.
      const corruptDir = join(dir, 'corrupt')
      const corruptPath = join(corruptDir, 'registry.json')
      mkdirSync(corruptDir, { recursive: true })
      const corruptText = '{ this is not valid json !!!'
      writeFileSync(corruptPath, corruptText, 'utf8')
      const corruptConfig = { registryPath: corruptPath }
      const warnings = []
      const warnSink = { warn: (m) => warnings.push(m) }
      const firstLoad = plugin.loadTaskRegistry(corruptConfig, warnSink)
      const backupPath = `${corruptPath}.corrupt`
      if (Object.keys(firstLoad).length === 0 && existsSync(backupPath) && readFileSync(backupPath, 'utf8') === corruptText) {
        pass('corrupt registry backed up once and reset')
      } else {
        report('corrupt registry self-heal', `expected {} + .corrupt backup, got ${JSON.stringify(firstLoad)}`)
      }
      plugin.loadTaskRegistry(corruptConfig, warnSink)
      if (warnings.length >= 2 && readFileSync(backupPath, 'utf8') === corruptText) {
        pass('corrupt registry warns on repeat loads without clobbering the backup')
      } else {
        report('corrupt registry repeat', `expected >= 2 warnings, got ${warnings.length}`)
      }

      // Malformed entries are dropped with a warning; valid entries survive.
      const mixedPath = join(dir, 'mixed', 'registry.json')
      mkdirSync(dirname(mixedPath), { recursive: true })
      const mixedConfig = { registryPath: mixedPath }
      await plugin.saveTaskRegistry(mixedConfig, {
        good: { conversationId: 'conv-good', cwd: 'cwd-good', label: 'x', createdAt: 1 },
        bad1: { conversationId: 42, cwd: 'c', createdAt: 1 },
        bad2: 'nope',
      })
      const mixed = plugin.loadTaskRegistry(mixedConfig, { warn: () => {} })
      if (mixed.good?.conversationId === 'conv-good' && !mixed.bad1 && !mixed.bad2) {
        pass('malformed registry entries dropped, valid entries kept')
      } else {
        report('registry entry validation', JSON.stringify(mixed))
      }

      // Concurrent read-modify-write cycles serialize: no lost record.
      const racePath = join(dir, 'race', 'registry.json')
      mkdirSync(dirname(racePath), { recursive: true })
      const raceConfig = { registryPath: racePath }
      await Promise.all([
        plugin.updateTaskRegistry(raceConfig, (r) => {
          r.a = { conversationId: 'ca', cwd: 'c', createdAt: 1 }
        }),
        plugin.updateTaskRegistry(raceConfig, (r) => {
          r.b = { conversationId: 'cb', cwd: 'c', createdAt: 2 }
        }),
      ])
      const raced = plugin.loadTaskRegistry(raceConfig)
      if (raced.a?.conversationId === 'ca' && raced.b?.conversationId === 'cb') {
        pass('concurrent registry updates serialize (no lost record)')
      } else {
        report('concurrent registry updates', JSON.stringify(raced))
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  } catch (error) {
    report('registry round trip', `module/round trip failed: ${error instanceof Error ? error.stack : String(error)}`)
  }
}

if (E2E && agy) {
  console.log('== e2e: PONG round trip + follow-up ==')
  const first = await run([agy, '-p', 'Reply with the single word: PONG', '--output-format', 'json', '--print-timeout', '120s'], {
    timeoutMs: 180_000,
  })
  const reply = parseJsonReply(first.stdout)
  if (!reply || reply.status !== 'SUCCESS' || !/PONG/i.test(String(reply.response ?? ''))) {
    report(
      'e2e round 1',
      `unexpected reply: code=${String(first.code)} status=${String(reply?.status)} response=${JSON.stringify(reply?.response)} stderr=${first.stderr.trim().slice(0, 300)}`,
    )
  } else {
    pass(`round 1 answered PONG (conversation_id: ${reply.conversation_id ?? 'none'})`)
    const conversationId = reply.conversation_id
    if (conversationId) {
      const second = await run(
        [agy, '-p', 'What was the exact word you replied in the previous turn? Reply with only that word.', '--conversation', conversationId, '--output-format', 'json', '--print-timeout', '120s'],
        { timeoutMs: 180_000 },
      )
      const secondReply = parseJsonReply(second.stdout)
      if (!secondReply || secondReply.status !== 'SUCCESS' || !/PONG/i.test(String(secondReply.response ?? ''))) {
        report('e2e follow-up', `unexpected reply: code=${String(second.code)} status=${String(secondReply?.status)} response=${JSON.stringify(secondReply?.response)} stderr=${second.stderr.trim().slice(0, 300)}`)
      } else {
        pass('follow-up resumed the same conversation and remembered PONG')
      }
    } else {
      report('e2e follow-up', 'round 1 carried no conversation_id (json mode not available?)')
    }
  }
} else if (E2E) {
  report('e2e', 'skipped: no agy executable')
} else {
  console.log('\n(offline checks only — rerun with --e2e for a live PONG round trip)')
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
