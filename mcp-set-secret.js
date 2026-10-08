// Replaces one or more env values of a local-scope MCP server, typed in hidden (nothing echoes,
// nothing is printed, nothing lands in shell history or a chat).
// Usage: node ~/claude-mods/mcp-set-secret.js <server-name> <repo-dir> <ENV_KEY> [MORE_KEYS]
// Backs up ~/.claude.json first (timestamped). Prints key names and lengths only.
// Close every Claude Code session first: running sessions rewrite ~/.claude.json.
const os = require('os'), fs = require('fs'), path = require('path'), readline = require('readline')
const [name, repoArg, ...keys] = process.argv.slice(2)
if (!name || !repoArg || !keys.length) { console.log('usage: node mcp-set-secret.js <server> <repo-dir> <ENV_KEY> [...]'); process.exit(1) }
const home = os.homedir()
const repo = path.resolve(repoArg.replace(/^~(?=$|\/)/, home))
const file = path.join(home, '.claude.json')
const j = JSON.parse(fs.readFileSync(file, 'utf8'))
const srv = (((j.projects || {})[repo] || {}).mcpServers || {})[name]
if (!srv) { console.log(`no local-scope "${name}" for ${repo}`); process.exit(1) }
const lines = []
let rl
function ask(q) {
  return new Promise(res => {
    if (!process.stdin.isTTY) { // piped input, for tests: one value per line
      if (!rl) { rl = readline.createInterface({ input: process.stdin }); rl.on('line', l => lines.push(l)) }
      const wait = () => lines.length ? res(lines.shift()) : setTimeout(wait, 10); return wait()
    }
    process.stdout.write(q)
    const stdin = process.stdin; stdin.setRawMode(true); stdin.resume(); let v = ''
    const on = ch => {
      ch = String(ch)
      if (ch === '\r' || ch === '\n') { stdin.setRawMode(false); stdin.pause(); stdin.off('data', on); process.stdout.write('\n'); res(v) }
      else if (ch === '\u0003') process.exit(1)
      else if (ch === '\u007f') v = v.slice(0, -1)
      else v += ch
    }
    stdin.on('data', on)
  })
}
;(async () => {
  const vals = {}
  for (const k of keys) {
    const v = (await ask(`${k} (hidden, paste then Enter): `)).trim()
    if (!v) { console.log(`empty value for ${k}; nothing changed`); process.exit(1) }
    vals[k] = v
  }
  const bak = file + '.bak-secret-' + Date.now()
  fs.copyFileSync(file, bak)
  srv.env = { ...(srv.env || {}), ...vals }
  fs.writeFileSync(file, JSON.stringify(j, null, 2))
  console.log('backup:', bak)
  for (const k of keys) console.log(`set ${k} (${vals[k].length} characters)`)
  if (rl) rl.close()
})()
