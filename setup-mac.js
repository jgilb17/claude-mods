#!/usr/bin/env node
// One-time Mac setup: mods load in every Claude Code session (terminal and the desktop app's
// Code tab) with no commands, and any mod added to ~/claude-mods later installs itself.
//  1. Backs up ~/.claude/settings.json (timestamped).
//  2. Removes the ~/claude-mods folders from CLAUDE_CODE_PLUGIN_DIRS, since the mods are now
//     installed plugins; loading both ways would load each mod twice.
//  3. Adds one SessionStart hook that runs sync-mods.js --quiet (about 0.1 s when nothing is new).
//  4. Runs sync-mods.js now, so everything is installed before the next session.
// Prints key names and counts only. Safe to run twice.
const fs = require('fs'), os = require('os'), path = require('path')
const { spawnSync } = require('child_process')
const home = os.homedir(), mods = path.join(home, 'claude-mods')
const f = path.join(home, '.claude', 'settings.json')
const s = JSON.parse(fs.readFileSync(f, 'utf8'))
const countHooks = o => Object.values(o.hooks || {}).reduce((n, groups) => n + groups.reduce((m, g) => m + (g.hooks || []).length, 0), 0)
const before = countHooks(s)
const bak = f + '.bak-setup-' + Date.now()
fs.copyFileSync(f, bak)

const env = s.env || {}
const dirs = (env.CLAUDE_CODE_PLUGIN_DIRS || '').split(':').filter(Boolean)
const keep = dirs.filter(d => !path.resolve(d.replace(/^~(?=$|\/)/, home)).startsWith(mods + path.sep))
if (keep.length) env.CLAUDE_CODE_PLUGIN_DIRS = keep.join(':'); else delete env.CLAUDE_CODE_PLUGIN_DIRS
s.env = env

const cmd = `node ${path.join(mods, 'sync-mods.js')} --quiet`
s.hooks = s.hooks || {}
s.hooks.SessionStart = s.hooks.SessionStart || []
const has = s.hooks.SessionStart.some(g => (g.hooks || []).some(h => String(h.command || '').includes('claude-mods/sync-mods.js')))
if (!has) s.hooks.SessionStart.push({ matcher: 'startup', hooks: [{ type: 'command', command: cmd, timeout: 120 }] })
const after = countHooks(s)
fs.writeFileSync(f, JSON.stringify(s, null, 2) + '\n')

console.log('backup:', bak)
console.log(`plugin folders removed from CLAUDE_CODE_PLUGIN_DIRS: ${dirs.length - keep.length}`)
console.log(`settings hooks: ${before} before, ${after} after${has ? ' (sync hook was already there)' : ' (added the mods sync hook)'}`)
console.log('env keys:', Object.keys(s.env).join(', ') || 'none')
const r = spawnSync('node', [path.join(mods, 'sync-mods.js'), mods], { encoding: 'utf8' })
process.stdout.write(r.stdout || ''); process.stderr.write(r.stderr || '')
const list = spawnSync('claude', ['plugin', 'list', '--json'], { encoding: 'utf8' })
try {
  const mine = JSON.parse(list.stdout).filter(p => p.id.endsWith('@joshua-mods'))
  console.log('mods installed and enabled:', mine.filter(p => p.enabled).map(p => p.id.split('@')[0]).join(', ') || 'none')
} catch { console.log('could not read the plugin list; run: claude plugin list') }
