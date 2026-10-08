// Adds repo-sentry to CLAUDE_CODE_PLUGIN_DIRS in ~/.claude/settings.json.
// Backs up first. Prints env key NAMES only, never values.
const os = require('os'), fs = require('fs'), path = require('path')
const f = path.join(os.homedir(), '.claude', 'settings.json')
const mod = path.join(os.homedir(), 'claude-mods', 'repo-sentry')
const s = JSON.parse(fs.readFileSync(f, 'utf8'))
const bak = f + '.bak-' + Date.now()
fs.copyFileSync(f, bak)
const env = s.env || {}
const dirs = (env.CLAUDE_CODE_PLUGIN_DIRS || '').split(':').filter(Boolean)
if (!dirs.includes(mod)) dirs.push(mod)
s.env = { ...env, CLAUDE_CODE_PLUGIN_DIRS: dirs.join(':') }
fs.writeFileSync(f, JSON.stringify(s, null, 2) + '\n')
console.log('backup:', bak)
console.log('env keys:', Object.keys(s.env).join(', '))
console.log('plugin dirs:', dirs.length)
