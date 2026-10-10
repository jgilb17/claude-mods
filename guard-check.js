#!/usr/bin/env node
// Read-only. Checks whether claude-guard is actually in force in every checkout of every repo under
// ~/Projects: each primary clone plus every worktree that still exists on disk. Prints only states,
// never file contents. A hook whose file is missing does not block anything, so "configured but
// file missing" means sessions there run unguarded.
const fs = require('fs'), path = require('path'), os = require('os'), { execFileSync } = require('child_process')
const home = os.homedir(), base = path.join(home, 'Projects')
const git = (r, ...a) => { try { return execFileSync('git', ['-C', r, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return null } }
const primaries = []
;(function walk(d, depth) {
  let ents = []; try { ents = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
  if (ents.some(e => e.name === '.git' && e.isDirectory())) { primaries.push(d); return }
  if (depth >= 3) return
  for (const e of ents) if (e.isDirectory() && !['node_modules', 'worktrees'].includes(e.name) && !e.name.startsWith('.')) walk(path.join(d, e.name), depth + 1)
})(base, 0)
const read = p => { try { return fs.readFileSync(p, 'utf8') } catch { return null } }
const user = read(path.join(home, '.claude', 'settings.json'))
console.log(`user-level settings: ${user == null ? 'none' : /guard\.mjs/.test(user) ? 'references guard.mjs' : 'no guard reference'}`)
const rows = []
for (const p of primaries) {
  const list = (git(p, 'worktree', 'list', '--porcelain') || '').split('\n').filter(l => l.startsWith('worktree ')).map(l => l.slice(9))
  const head = (git(p, 'symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD') || 'origin/main')
  const upstream = git(p, 'cat-file', '-e', `${head}:.claude/hooks/guard.mjs`) !== null
  for (const w of list) {
    if (!fs.existsSync(w)) continue
    const settings = [read(path.join(w, '.claude', 'settings.json')), read(path.join(w, '.claude', 'settings.local.json'))].filter(Boolean).join('\n')
    const configured = /guard\.mjs/.test(settings)
    const file = fs.existsSync(path.join(w, '.claude', 'hooks', 'guard.mjs'))
    const state = configured && file ? 'OK' : configured ? 'UNGUARDED: hook configured, guard.mjs missing' : file ? 'UNGUARDED: guard.mjs present, not in settings' : 'no guard'
    rows.push({ repo: path.relative(base, p), w: w.replace(home, '~'), state, branch: git(w, 'branch', '--show-current') || 'detached', upstream })
  }
}
const byRepo = rows.reduce((o, r) => ((o[r.repo] = o[r.repo] || []).push(r), o), {})
for (const [repo, rs] of Object.entries(byRepo)) {
  const ok = rs.filter(r => r.state === 'OK').length
  console.log(`\n== ${repo}: ${rs.length} checkouts on disk, ${ok} guarded, guard on GitHub default branch: ${rs[0].upstream ? 'yes' : 'NO'}`)
  for (const r of rs.filter(r => r.state !== 'OK')) console.log(`  ${r.state.padEnd(46)} ${r.w}  [${r.branch}]`)
}
console.log(`\ntotal: ${rows.length} checkouts, ${rows.filter(r => r.state === 'OK').length} guarded, ${rows.filter(r => r.state.startsWith('UNGUARDED')).length} unguarded, ${rows.filter(r => r.state === 'no guard').length} without guard`)
