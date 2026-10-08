#!/usr/bin/env node
// Makes every mod listed in this folder's marketplace installed and enabled for Claude Code.
// Runs on the Mac (at each session start, from a SessionStart hook) and in cloud containers
// (from the environment setup script). Fast path: if nothing new is listed since the last run,
// it reads two small files and exits without starting the claude CLI.
// Usage: node sync-mods.js [mods-folder] [--quiet]
// --quiet prints nothing unless it installed something, because a SessionStart hook's output
// is added to the session's context.
const fs = require('fs'), os = require('os'), path = require('path')
const { spawnSync } = require('child_process')
const args = process.argv.slice(2)
const quiet = args.includes('--quiet')
const dir = path.resolve((args.find(a => !a.startsWith('--')) || path.join(os.homedir(), 'claude-mods')).replace(/^~(?=$|\/)/, os.homedir()))
const say = (...m) => { if (!quiet) console.log(...m) }
let market
try { market = JSON.parse(fs.readFileSync(path.join(dir, '.claude-plugin', 'marketplace.json'), 'utf8')) }
catch { say('no marketplace at', dir); process.exit(0) }
const listed = market.plugins.map(p => p.name).sort()
const stamp = path.join(os.homedir(), '.claude', '.joshua-mods-synced.json')
try {
  const prev = JSON.parse(fs.readFileSync(stamp, 'utf8'))
  if (prev.dir === dir && JSON.stringify(prev.listed) === JSON.stringify(listed)) { say('mods already in sync:', listed.join(', ')); process.exit(0) }
} catch { /* first run, or the stamp is unreadable: do the full sync */ }

const claude = a => spawnSync('claude', a, { encoding: 'utf8', timeout: 60000 })
const id = n => `${n}@${market.name}`
let installed = []
const list = claude(['plugin', 'list', '--json'])
try { installed = JSON.parse(list.stdout).map(p => p.id) } catch { /* treat as none */ }
if (!installed.some(i => i.endsWith('@' + market.name))) {
  const add = claude(['plugin', 'marketplace', 'add', dir])
  if (add.status !== 0 && !/already/i.test(add.stdout + add.stderr)) { console.log('could not add the mods marketplace:', (add.stderr || add.stdout).trim().split('\n').pop()); process.exit(0) }
}
const added = [], failed = []
for (const n of listed) {
  if (installed.includes(id(n))) continue
  const r = claude(['plugin', 'install', id(n), '--scope', 'user'])
  ;(r.status === 0 ? added : failed).push(n)
}
if (!failed.length) {
  try { fs.mkdirSync(path.dirname(stamp), { recursive: true }); fs.writeFileSync(stamp, JSON.stringify({ dir, listed, at: new Date().toISOString() })) } catch {}
}
if (added.length) console.log(`Installed new Claude Code mods: ${added.join(', ')}. They load from the next session.`)
if (failed.length) console.log(`Could not install: ${failed.join(', ')}. Run node ${path.join(dir, 'sync-mods.js')} to see why.`)
if (!added.length && !failed.length) say('mods already installed:', listed.join(', '))
