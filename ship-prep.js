#!/usr/bin/env node
// Finishes the branch triage mechanically. For every branch the triage left in ship, review or
// decide (first-wave-dental excluded: that one is your call, and it touches patient workflows):
//   1. asks git whether the branch's changes are already on main (a merge that changes nothing),
//   2. scans what the branch adds for secret-looking lines (reports file names only, never values),
//   3. sorts it: already on main / ready for a draft PR / conflicts with main / blocked by a secret hit.
// Dry run by default. With `go` it deletes the local names of branches already on main (history is
// in the iCloud bundles), pushes each ready branch to GitHub without force, and opens it as a DRAFT
// pull request so nothing merges or deploys until you review it. It never merges, force-pushes,
// or touches branches changed in the last 2 days (live Codex work).
const fs = require('fs'), os = require('os'), path = require('path'), { execFileSync, spawnSync } = require('child_process')
const go = process.argv.includes('go')
const home = os.homedir(), dir = path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'repo-backups')
const csv = process.env.CSV || fs.readdirSync(fs.existsSync(dir) ? dir : path.join(home, 'repo-backups')).filter(f => /^branch-triage-.*\.csv$/.test(f)).sort().map(f => path.join(fs.existsSync(dir) ? dir : path.join(home, 'repo-backups'), f)).pop()
const cols = ['repo', 'bucket', 'branch', 'ahead', 'unique', 'behind', 'files', 'ageDays', 'pr', 'backedUp', 'clone', 'subject']
const rows = fs.readFileSync(csv, 'utf8').trim().split('\n').slice(1).map(l => Object.fromEntries([...l.matchAll(/"((?:[^"]|"")*)"/g)].map((m, i) => [cols[i], m[1].replace(/""/g, '"')])))
const git = (c, ...a) => { const r = spawnSync('git', ['-C', c, ...a], { encoding: 'utf8', maxBuffer: 256e6 }); return { ok: r.status === 0, out: (r.stdout || '').trim(), code: r.status } }
const SECRET = /(sk-[A-Za-z0-9_-]{20,}|sk_live_[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY|xox[baprs]-[A-Za-z0-9-]{10,}|gh[pousr]_[A-Za-z0-9]{30,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.|(api[_-]?key|secret|passw(or)?d|auth[_-]?token|service[_-]?role)["']?\s*[:=]\s*["'][^"'\s]{12,}["'])/i
const results = []
for (const r of rows) {
  if (r.bucket.startsWith('retire')) continue
  const c = path.join(home, 'Projects', r.clone), b = r.branch
  const res = { ...r, verdict: '', detail: '' }
  results.push(res)
  if (r.repo.endsWith('/first-wave-dental')) { res.verdict = 'your decision'; res.detail = 'first-wave-dental: alive or parked'; continue }
  if (!git(c, 'rev-parse', '--verify', '-q', `refs/heads/${b}`).ok) { res.verdict = 'gone'; res.detail = 'branch no longer exists locally'; continue }
  const age = (Date.now() / 1000 - +git(c, 'log', '-1', '--format=%ct', b).out) / 86400
  if (age < 2) { res.verdict = 'skipped: live'; res.detail = 'changed in the last 2 days'; continue }
  const head = git(c, 'symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD').out || 'origin/main'
  const mt = git(c, 'merge-tree', '--write-tree', '--name-only', head, b)
  if (mt.code !== 0 && mt.code !== 1) { res.verdict = 'error'; res.detail = 'git merge-tree failed (needs git 2.38 or newer)'; continue }
  if (mt.code === 1) { res.verdict = 'conflicts'; res.detail = `${mt.out.split('\n').slice(1).filter(l => l && !l.startsWith('Auto-merging') && !l.startsWith('CONFLICT')).length || '?'} files conflict with main`; continue }
  const tree = mt.out.split('\n')[0], mainTree = git(c, 'rev-parse', `${head}^{tree}`).out
  if (tree === mainTree) { res.verdict = 'already on main'; res.detail = 'merging it would change nothing'; continue }
  const changed = git(c, 'diff', '--name-only', mainTree, tree).out.split('\n').filter(Boolean)
  const added = git(c, 'diff', '-U0', `${head}...${b}`).out.split('\n')
  let file = '', hits = new Set()
  for (const l of added) { if (l.startsWith('+++ b/')) file = l.slice(6); else if (l.startsWith('+') && SECRET.test(l)) hits.add(file) }
  for (const f of changed) if (/(^|\/)\.env($|\.)|\.(pem|key|p12)$/i.test(f)) hits.add(f)
  if (hits.size) { res.verdict = 'blocked: secret-like'; res.detail = [...hits].slice(0, 4).join(', '); continue }
  res.verdict = 'ready for draft PR'; res.detail = `${changed.length} files change on main`
  res.head = head
}
const order = ['ready for draft PR', 'already on main', 'conflicts', 'blocked: secret-like', 'your decision', 'skipped: live', 'gone', 'error']
for (const v of order) {
  const rs = results.filter(r => r.verdict === v); if (!rs.length) continue
  console.log(`\n${v}: ${rs.length}`)
  for (const r of rs) console.log(`  ${r.repo.split('/')[1].padEnd(18)} ${r.branch.slice(0, 46).padEnd(46)} ${r.detail}`)
}
if (!go) { console.log(`\nDry run from ${path.basename(csv)}. Nothing changed. Run again with go to retire the "already on main" names and open the "ready" ones as draft PRs.`); process.exit(0) }
let del = 0, prs = 0, fail = []
for (const r of results) {
  const c = path.join(home, 'Projects', r.clone)
  if (r.verdict === 'already on main') { if (git(c, 'branch', '-D', r.branch).ok) del++; continue }
  if (r.verdict !== 'ready for draft PR') continue
  const push = git(c, 'push', '-q', 'origin', `refs/heads/${r.branch}:refs/heads/${r.branch}`)
  if (!push.ok) { fail.push(`${r.branch}: push refused (remote branch differs), left alone`); continue }
  const base = r.head.replace(/^origin\//, '')
  const existing = spawnSync('gh', ['pr', 'list', '-R', r.repo, '--head', r.branch, '--state', 'open', '--json', 'number', '--jq', 'length'], { encoding: 'utf8' })
  if ((existing.stdout || '').trim() !== '0') { fail.push(`${r.branch}: pushed; an open PR already exists`); continue }
  const body = `Opened as a draft by claude-mods/ship-prep.js from the branch triage of ${path.basename(csv, '.csv').slice(14)}. The branch was ${r.behind} commits behind ${base} and its changes apply cleanly (${r.detail}). Review before marking ready; nothing merges or deploys from a draft.`
  const pr = spawnSync('gh', ['pr', 'create', '-R', r.repo, '--draft', '--base', base, '--head', r.branch, '--title', r.subject || r.branch, '--body', body], { encoding: 'utf8' })
  if (pr.status === 0) { prs++; console.log(`draft PR: ${(pr.stdout || '').trim()}`) } else fail.push(`${r.branch}: pushed, PR not created (${(pr.stderr || '').trim().split('\n').pop()})`)
}
console.log(`\nretired ${del} branches already on main; opened ${prs} draft PRs.`)
for (const f of fail) console.log(`  note: ${f}`)
