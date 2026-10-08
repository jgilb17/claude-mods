// Starts one MCP server the way Claude Code would and shows why it fails, with secrets redacted.
// Usage: node ~/claude-mods/mcp-diagnose.js <server-name> [repo-dir]
// Prints: transport, command, arg count, env KEY NAMES only, exit code, and the server's own
// stderr/stdout with every env value and token-looking string replaced by [redacted].
const os = require('os'), fs = require('fs'), path = require('path')
const { spawn } = require('child_process')
const [name, repoArg] = process.argv.slice(2)
if (!name) { console.log('usage: node mcp-diagnose.js <server-name> [repo-dir]'); process.exit(1) }
const home = os.homedir()
const j = JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8'))
const repo = repoArg ? path.resolve(repoArg.replace(/^~(?=$|\/)/, home)) : process.cwd()
let cfg = ((j.projects || {})[repo] || {}).mcpServers?.[name], scope = 'local'
if (!cfg) { cfg = (j.mcpServers || {})[name]; scope = 'user' }
if (!cfg) { try { cfg = JSON.parse(fs.readFileSync(path.join(repo, '.mcp.json'), 'utf8')).mcpServers?.[name]; scope = 'project' } catch {} }
if (!cfg) { console.log(`"${name}" not found for ${repo} (local, user or project scope)`); process.exit(1) }
const env = cfg.env || {}
const secrets = Object.values(env).map(String).filter(v => v.length >= 6)
const redact = s => {
  let out = String(s)
  for (const v of secrets) out = out.split(v).join('[redacted]')
  return out.replace(/(bearer\s+|token[=:]\s*|key[=:]\s*|sk-|pk_|eyJ)[A-Za-z0-9._\-]{8,}/gi, '$1[redacted]')
}
const type = cfg.type || (cfg.url ? 'http' : 'stdio')
console.log('scope:', scope, '| transport:', type)
console.log('env keys:', Object.keys(env).join(', ') || 'none')
if (type !== 'stdio') {
  const u = new URL(cfg.url); console.log('url host+path:', u.host + u.pathname, u.search ? '(query string hidden)' : '')
  fetch(cfg.url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(cfg.headers ? Object.fromEntries(Object.keys(cfg.headers).map(k => [k, cfg.headers[k]])) : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'diag', version: '0' } } }) })
    .then(async r => console.log('HTTP', r.status, redact((await r.text()).slice(0, 400))))
    .catch(e => console.log('request failed:', redact(e.message)))
  return
}
console.log('command:', path.basename(String(cfg.command)), '| full path exists:', fs.existsSync(String(cfg.command)) || 'n/a (resolved via PATH)', '| args:', (cfg.args || []).length)
const scriptArg = (cfg.args || []).find(a => /\.(m?js|ts|py)$/.test(a))
if (scriptArg) console.log('script file:', redact(scriptArg), '| exists:', fs.existsSync(scriptArg))
const child = spawn(cfg.command, cfg.args || [], { env: { ...process.env, ...env }, cwd: repo })
let out = '', err = ''
child.stdout.on('data', d => out += d); child.stderr.on('data', d => err += d)
child.on('error', e => { console.log('could not start:', redact(e.message)); process.exit(0) })
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'diag', version: '0' } } }) + '\n')
const done = (why) => {
  console.log('result:', why)
  console.log('--- server stdout (first 600 chars) ---\n' + (redact(out.slice(0, 600)) || '(empty)'))
  console.log('--- server stderr (last 40 lines) ---\n' + (redact(err.split('\n').slice(-40).join('\n')) || '(empty)'))
  process.exit(0)
}
child.on('exit', code => done(`process EXITED with code ${code} (this is what CONNECTION_CLOSED means)`))
setTimeout(() => { child.kill(); done(out.includes('"result"') ? 'server answered initialize and stayed up (healthy)' : 'still running after 8s, no answer to initialize') }, 8000)
