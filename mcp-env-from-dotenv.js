// Copies named values from a .env file into a local-scope MCP server's env, and can drop old keys.
// Nothing is printed except key names and value lengths.
// Usage: node ~/claude-mods/mcp-env-from-dotenv.js <server> <repo-dir> <dotenv-file> KEY [KEY...] [--drop=OLD1,OLD2]
// Close every Claude Code session first: running sessions rewrite ~/.claude.json.
const os = require('os'), fs = require('fs'), path = require('path')
const home = os.homedir(), tilde = p => path.resolve(p.replace(/^~(?=$|\/)/, home))
const args = process.argv.slice(2)
const drop = (args.find(a => a.startsWith('--drop=')) || '--drop=').slice(7).split(',').filter(Boolean)
const [name, repoArg, envArg, ...keys] = args.filter(a => !a.startsWith('--drop='))
if (!name || !repoArg || !envArg || !keys.length) { console.log('usage: node mcp-env-from-dotenv.js <server> <repo-dir> <dotenv-file> KEY [...] [--drop=OLD1,OLD2]'); process.exit(1) }
const repo = tilde(repoArg), file = path.join(home, '.claude.json')
const dot = {}
for (const line of fs.readFileSync(tilde(envArg), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
  if (!m) continue
  let v = m[2]
  if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1)
  else v = v.replace(/\s+#.*$/, '')
  dot[m[1]] = v
}
const missing = keys.filter(k => !dot[k])
if (missing.length) { console.log('not found or empty in that file:', missing.join(', '), '- nothing changed'); process.exit(1) }
const j = JSON.parse(fs.readFileSync(file, 'utf8'))
const srv = (((j.projects || {})[repo] || {}).mcpServers || {})[name]
if (!srv) { console.log(`no local-scope "${name}" for ${repo}`); process.exit(1) }
const bak = file + '.bak-dotenv-' + Date.now()
fs.copyFileSync(file, bak)
const env = { ...(srv.env || {}) }
for (const k of drop) delete env[k]
for (const k of keys) env[k] = dot[k]
srv.env = env
fs.writeFileSync(file, JSON.stringify(j, null, 2))
console.log('backup:', bak)
for (const k of keys) console.log(`set ${k} (${dot[k].length} characters)`)
if (drop.length) console.log('dropped:', drop.join(', '))
console.log('env keys now:', Object.keys(env).join(', '))
