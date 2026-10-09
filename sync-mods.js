#!/usr/bin/env node
// Makes every mod listed in this folder's marketplace installed and enabled for Claude Code.
// Runs on the Mac (at each session start, from a SessionStart hook) and in cloud containers
// (from the environment setup script). Fast path: if nothing new is listed since the last run,
// it reads two small files and exits without starting the claude CLI.
// Usage: node sync-mods.js [mods-folder] [--quiet]
// --quiet prints nothing unless it installed or updated something, because a SessionStart hook's output
// is added to the session's context.
const fs = require('fs'), os = require('os'), path = require('path')
const { spawnSync } = require('child_process')
const args = process.argv.slice(2)
const quiet = args.includes('--quiet')
const dir = path.resolve((args.find(a => !a.startsWith('--')) || path.join(os.homedir(), 'claude-mods')).replace(/^~(?=$|\/)/, os.homedir()))
// Every run leaves one line in ~/claude-mods-sync.log (last 200 kept), so "mods missing in this
// session" is answered by reading one file instead of guessing.
const logFile = path.join(os.homedir(), 'claude-mods-sync.log')
function log(msg) {
  try {
    const line = `${new Date().toISOString()} ${msg}`
    let prev = []
    try { prev = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean) } catch {}
    fs.writeFileSync(logFile, [...prev, line].slice(-200).join('\n') + '\n')
  } catch { /* logging must never break a session start */ }
}
const say = (...m) => { if (!quiet) console.log(...m) }
let market
try { market = JSON.parse(fs.readFileSync(path.join(dir, '.claude-plugin', 'marketplace.json'), 'utf8')) }
catch { say('no marketplace at', dir); log(`no marketplace at ${dir}`); process.exit(0) }
const listed = market.plugins.map(p => p.name).sort()
// Each mod's version as this folder has it. A version bump (a git pull of a new release) changes
// this, which forces the full sync below, which updates the installed copy. Without it a pulled
// release sat unused: installs are versioned copies, so the folder changing is not enough.
const versions = {}
for (const p of market.plugins) {
  try { versions[p.name] = JSON.parse(fs.readFileSync(path.join(dir, p.source || p.name, '.claude-plugin', 'plugin.json'), 'utf8')).version || '' }
  catch { versions[p.name] = '' }
}
const wanted = listed.map(n => `${n}@${versions[n]}`)
const stamp = path.join(os.homedir(), '.claude', '.joshua-mods-synced.json')
try {
  const prev = JSON.parse(fs.readFileSync(stamp, 'utf8'))
  if (prev.dir === dir && JSON.stringify(prev.wanted) === JSON.stringify(wanted)) { say('mods already in sync:', wanted.join(', ')); log(`in sync: ${wanted.join(', ')}`); process.exit(0) }
} catch { /* first run, or the stamp is unreadable: do the full sync */ }

const claude = a => spawnSync('claude', a, { encoding: 'utf8', timeout: 60000 })
const id = n => `${n}@${market.name}`
let installed = [], have = {}
const list = claude(['plugin', 'list', '--json'])
try { const rows = JSON.parse(list.stdout); installed = rows.map(p => p.id); for (const p of rows) have[p.id] = p.version || '' } catch { /* treat as none */ }
if (!installed.some(i => i.endsWith('@' + market.name))) {
  const add = claude(['plugin', 'marketplace', 'add', dir])
  if (add.status !== 0 && !/already/i.test(add.stdout + add.stderr)) {
    const why = add.error ? add.error.message : (add.stderr || add.stdout).trim().split('\n').pop()
    console.log('could not add the mods marketplace:', why); log(`FAILED marketplace add: ${why}`); process.exit(0)
  }
}
const added = [], updated = [], failed = []
const stale = listed.filter(n => installed.includes(id(n)) && versions[n] && have[id(n)] !== versions[n])
// The marketplace keeps its own catalog of what this folder offers: refresh it once before
// updating, or the update compares against the catalog of the last add and finds nothing new.
if (stale.length) claude(['plugin', 'marketplace', 'update', market.name])
for (const n of listed) {
  if (!installed.includes(id(n))) {
    const r = claude(['plugin', 'install', id(n), '--scope', 'user'])
    ;(r.status === 0 ? added : failed).push(n)
  } else if (stale.includes(n)) {
    const r = claude(['plugin', 'update', id(n)])
    ;(r.status === 0 ? updated : failed).push(`${n} ${have[id(n)] || '?'} to ${versions[n]}`)
  }
}
if (!failed.length) {
  try { fs.mkdirSync(path.dirname(stamp), { recursive: true }); fs.writeFileSync(stamp, JSON.stringify({ dir, listed, wanted, at: new Date().toISOString() })) } catch {}
}
log(`installed: ${added.join(', ') || 'none new'}; updated: ${updated.join(', ') || 'none'}; failed: ${failed.join(', ') || 'none'}; wanted: ${wanted.join(', ')}`)
if (added.length) console.log(`Installed new Claude Code mods: ${added.join(', ')}. They load from the next session.`)
if (updated.length) console.log(`Updated Claude Code mods: ${updated.join(', ')}. The new versions load from the next session.`)
if (failed.length) console.log(`Could not install or update: ${failed.join(', ')}. Run node ${path.join(dir, 'sync-mods.js')} to see why.`)
if (!added.length && !updated.length && !failed.length) say('mods already installed:', wanted.join(', '))
