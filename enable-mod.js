// Adds one or more mods in ~/claude-mods to CLAUDE_CODE_PLUGIN_DIRS in ~/.claude/settings.json.
// Usage: node ~/claude-mods/enable-mod.js <mod-name> [more mod names]
// Backs up first (timestamped), changes nothing if every mod is already listed, prints env KEY NAMES only.
const os = require('os'), fs = require('fs'), path = require('path')
const names = process.argv.slice(2)
if (!names.length) { console.log('usage: node enable-mod.js <mod-name> [...]'); process.exit(1) }
const f = path.join(os.homedir(), '.claude', 'settings.json')
const s = JSON.parse(fs.readFileSync(f, 'utf8'))
const env = s.env || {}
const dirs = (env.CLAUDE_CODE_PLUGIN_DIRS || '').split(':').filter(Boolean)
let added = 0
for (const n of names) {
  const dir = path.join(os.homedir(), 'claude-mods', n)
  if (!fs.existsSync(path.join(dir, '.claude-plugin', 'plugin.json'))) { console.log('not a mod, skipped:', dir); continue }
  if (!dirs.includes(dir)) { dirs.push(dir); added++ }
}
if (!added) { console.log('nothing to change; mods listed:', dirs.map(d => path.basename(d)).join(', ')); process.exit(0) }
const bak = f + '.bak-' + Date.now()
fs.copyFileSync(f, bak)
s.env = { ...env, CLAUDE_CODE_PLUGIN_DIRS: dirs.join(':') }
fs.writeFileSync(f, JSON.stringify(s, null, 2) + '\n')
console.log('backup:', bak)
console.log('env keys:', Object.keys(s.env).join(', '))
console.log('mods listed:', dirs.map(d => path.basename(d)).join(', '))
