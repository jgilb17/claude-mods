// Moves a user-scoped MCP server to local scope in specific repos.
// Usage: node ~/claude-mods/move-mcp-to-repo.js <server-name> <repo-dir> [more repo dirs]
// Never prints the server's config. Adds to every repo first; removes from user scope only if all adds succeed.
const os = require('os'), fs = require('fs'), path = require('path')
const { spawnSync } = require('child_process')
const [name, ...repos] = process.argv.slice(2)
if (!name || repos.length === 0) { console.log('usage: node move-mcp-to-repo.js <server-name> <repo-dir> [...]'); process.exit(1) }
const home = os.homedir()
const cfgFile = path.join(home, '.claude.json')
const all = JSON.parse(fs.readFileSync(cfgFile, 'utf8'))
const cfg = all.mcpServers && all.mcpServers[name]
if (!cfg) { console.log(`"${name}" is not in user scope. Nothing to do.`); process.exit(1) }
const bak = cfgFile + '.bak-mcp-move-' + Date.now()
fs.copyFileSync(cfgFile, bak)
console.log('backup written:', bak)
const run = (args, cwd) => spawnSync('claude', args, { cwd, stdio: 'pipe', encoding: 'utf8' }).status
let ok = true
for (const r of repos) {
  const dir = path.resolve(r.replace(/^~(?=$|\/)/, home))
  if (!fs.existsSync(path.join(dir, '.git'))) { console.log('skip, not a repo:', dir); ok = false; continue }
  const proj = (all.projects || {})[dir] || {}
  if ((proj.mcpServers || {})[name]) { console.log('already local:', dir); continue }
  const res = spawnSync('claude', ['mcp', 'add-json', name, JSON.stringify(cfg), '-s', 'local'], { cwd: dir, stdio: 'pipe', encoding: 'utf8' })
  if (res.status === 0) { console.log('added (local):', dir); continue }
  ok = false
  // first line of the error only, cut before any JSON so no config value can print
  const why = ((res.stderr || res.stdout || '').split('\n').find(Boolean) || 'no message').split('{')[0].slice(0, 200)
  console.log(`FAILED (exit ${res.status}): ${dir}\n  reason: ${why}`)
}
if (!ok) { console.log('Not removing from user scope because an add failed or was skipped.'); process.exit(1) }
const rm = run(['mcp', 'remove', name, '-s', 'user'], home)
console.log(rm === 0 ? `removed "${name}" from user scope` : `remove from user scope FAILED (exit ${rm})`)
