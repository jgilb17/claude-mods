#!/usr/bin/env node
// Read-only. For every git repo under ~/Projects (worktrees and node_modules skipped), reports how
// big the CLAUDE.md that sessions load is: locally and on GitHub's default branch, since cloud
// sessions load GitHub's copy. Tokens are estimated at 4 characters per token and labeled as such.
// Also counts @imports (each pulls another file into every session) and how far behind origin the
// local copy is. Changes nothing except a `git fetch`.
const fs = require('fs'), path = require('path'), os = require('os'), { execFileSync } = require('child_process')
const base = path.join(os.homedir(), 'Projects')
const repos = []
;(function walk(d, depth) {
  let ents = []; try { ents = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
  if (ents.some(e => e.name === '.git')) { repos.push(d); return }
  if (depth >= 3) return
  for (const e of ents) if (e.isDirectory() && !['node_modules', 'worktrees', '.git'].includes(e.name) && !e.name.startsWith('.')) walk(path.join(d, e.name), depth + 1)
})(base, 0)
const git = (r, ...a) => { try { return execFileSync('git', ['-C', r, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30000 }) } catch { return null } }
const size = t => t == null ? null : { lines: t.split('\n').length, chars: t.length, imports: (t.match(/^\s*@[\w./~-]+/gm) || []).length }
const fmt = s => s ? `${String(s.lines).padStart(6)} lines ~${String(Math.round(s.chars / 4 / 1000)).padStart(3)}k tok  ${s.imports} @imports` : '         none'
console.log('repo'.padEnd(28) + 'local CLAUDE.md'.padEnd(40) + 'GitHub default branch'.padEnd(40) + 'behind')
for (const r of repos) {
  const local = fs.existsSync(path.join(r, 'CLAUDE.md')) ? size(fs.readFileSync(path.join(r, 'CLAUDE.md'), 'utf8')) : null
  git(r, 'fetch', '-q', 'origin')
  const head = (git(r, 'symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD') || 'origin/main').trim()
  const remote = size(git(r, 'show', `${head}:CLAUDE.md`))
  const behind = (git(r, 'rev-list', '--count', `HEAD..${head}`) || '?').trim()
  if (!local && !remote) continue
  console.log(path.relative(base, r).slice(0, 27).padEnd(28) + fmt(local).padEnd(40) + fmt(remote).padEnd(40) + behind)
}
console.log('\ntok = estimated at 4 characters per token, not measured.')
