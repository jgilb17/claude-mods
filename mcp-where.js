// Shows which MCP server NAMES are configured for a repo, by scope. Never prints config values.
// Usage: node ~/claude-mods/mcp-where.js <repo-dir>
const os = require('os'), fs = require('fs'), path = require('path')
const home = os.homedir()
const dir = path.resolve((process.argv[2] || '.').replace(/^~(?=$|\/)/, home))
const j = JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8'))
const names = o => Object.keys((o && o.mcpServers) || {}).join(', ') || 'none'
console.log('repo:', dir)
console.log('  is git dir/worktree:', fs.existsSync(path.join(dir, '.git')) ? (fs.statSync(path.join(dir, '.git')).isFile() ? 'worktree' : 'repo') : 'NO')
console.log('  user scope:', names(j))
console.log('  local scope:', (j.projects || {})[dir] ? names(j.projects[dir]) : 'no project entry yet')
let proj = 'no .mcp.json'
try { proj = names(JSON.parse(fs.readFileSync(path.join(dir, '.mcp.json'), 'utf8'))) } catch {}
console.log('  project scope (.mcp.json):', proj)
