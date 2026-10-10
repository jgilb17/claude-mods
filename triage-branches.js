#!/usr/bin/env node
// Read-only. Lists every local branch, in every clone under ~/Projects, that has commits not on
// GitHub's default branch, joins it with that branch's pull request (one gh call per repo), and
// sorts it into ship / review / retire buckets. Writes the full table as CSV next to your iCloud
// repo backups and prints a summary. Deletes, pushes and merges nothing.
const fs = require('fs'), path = require('path'), os = require('os'), { execFileSync } = require('child_process')
const home = os.homedir(), base = path.join(home, 'Projects'), now = Date.now(), DAY = 864e5
const run = (cmd, args, cwd) => { try { return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64e6 }).trim() } catch { return null } }
const git = (r, ...a) => run('git', ['-C', r, ...a])
const primaries = []
;(function walk(d, depth) {
  let ents = []; try { ents = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
  if (ents.some(e => e.name === '.git' && e.isDirectory())) { primaries.push(d); return }
  if (depth >= 3) return
  for (const e of ents) if (e.isDirectory() && !['node_modules', 'worktrees'].includes(e.name) && !e.name.startsWith('.')) walk(path.join(d, e.name), depth + 1)
})(base, 0)
const groups = {}
for (const p of primaries) {
  const url = git(p, 'remote', 'get-url', 'origin') || ''
  const m = url.match(/github\.com[:/]([^/]+\/[^/.]+)/)
  if (m) (groups[m[1]] = groups[m[1]] || []).push(p)
}
const rows = []
for (const [slug, clones] of Object.entries(groups)) {
  process.stderr.write(`${slug}: ${clones.length} clone(s)... `)
  for (const c of clones) git(c, 'fetch', '-q', 'origin')
  let prs = []
  try { prs = JSON.parse(run('gh', ['pr', 'list', '-R', slug, '--state', 'all', '--limit', '3000', '--json', 'number,headRefName,state,mergedAt,updatedAt,title']) || '[]') } catch { prs = [] }
  const prBy = {}
  for (const pr of prs) { const cur = prBy[pr.headRefName]; if (!cur || pr.number > cur.number) prBy[pr.headRefName] = pr }
  const seen = {}
  for (const c of clones) {
    const head = git(c, 'symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD') || 'origin/main'
    const refs = (git(c, 'for-each-ref', 'refs/heads', '--format=%(refname:short)\t%(committerdate:unix)\t%(subject)') || '').split('\n').filter(Boolean)
    for (const line of refs) {
      const [b, ts, subject] = line.split('\t')
      if (b === 'main' || b === 'master') continue
      const ahead = +(git(c, 'rev-list', '--count', `${head}..${b}`) || 0)
      if (!ahead) continue
      const unique = ((git(c, 'cherry', head, b) || '').match(/^\+/gm) || []).length
      const stat = git(c, 'diff', '--shortstat', `${head}...${b}`) || ''
      const files = +((stat.match(/(\d+) files? changed/) || [])[1] || 0)
      const onRemote = git(c, 'rev-parse', '--verify', '-q', `refs/remotes/origin/${b}`) !== null
      const remoteHasAll = onRemote && +(git(c, 'rev-list', '--count', `origin/${b}..${b}`) || 0) === 0
      const behind = +(git(c, 'rev-list', '--count', `${b}..${head}`) || 0)
      const age = Math.round((now - +ts * 1000) / DAY)
      const pr = prBy[b]
      let bucket
      if (pr && pr.state === 'MERGED') bucket = +ts * 1000 > Date.parse(pr.mergedAt) + 60e3 ? 'review: commits after merge' : 'retire: merged'
      else if (pr && pr.state === 'OPEN') bucket = 'ship: open PR'
      else if (pr && pr.state === 'CLOSED') bucket = 'retire: PR closed unmerged'
      else if (!unique) bucket = 'retire: already upstream'
      else if (age <= 14) bucket = 'ship: active, no PR'
      else bucket = 'decide: stale, no PR'
      const row = { repo: slug, clone: path.relative(base, c), branch: b, bucket, ahead, unique, behind, files, ageDays: age, pr: pr ? `#${pr.number} ${pr.state}` : '', backedUp: remoteHasAll ? 'github' : 'local only', subject: (pr ? pr.title : subject).slice(0, 90) }
      const prev = seen[b]
      if (!prev || row.ageDays < prev.ageDays) { if (prev) rows.splice(rows.indexOf(prev), 1); rows.push(row); seen[b] = row }
    }
  }
  process.stderr.write(`done (${prs.length} PRs read)\n`)
  if (!prs.length) console.log(`WARNING ${slug}: gh returned no pull requests, so merged branches will look unmerged. Check \`gh auth status\`.`)
}
const icloud = path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'repo-backups')
const outDir = fs.existsSync(icloud) ? icloud : path.join(home, 'repo-backups')
fs.mkdirSync(outDir, { recursive: true })
const out = path.join(outDir, `branch-triage-${new Date().toISOString().slice(0, 10)}.csv`)
const cols = ['repo', 'bucket', 'branch', 'ahead', 'unique', 'behind', 'files', 'ageDays', 'pr', 'backedUp', 'clone', 'subject']
fs.writeFileSync(out, [cols.join(','), ...rows.map(r => cols.map(k => `"${String(r[k]).replace(/"/g, '""')}"`).join(','))].join('\n') + '\n')
const order = ['ship: open PR', 'ship: active, no PR', 'review: commits after merge', 'decide: stale, no PR', 'retire: PR closed unmerged', 'retire: merged', 'retire: already upstream']
for (const slug of Object.keys(groups)) {
  const rs = rows.filter(r => r.repo === slug)
  if (!rs.length) continue
  console.log(`\n== ${slug}: ${rs.length} branches with commits not on the default branch`)
  for (const b of order) { const n = rs.filter(r => r.bucket === b).length; if (n) console.log(`  ${b.padEnd(30)} ${n}`) }
  for (const b of order.slice(0, 4)) {
    const top = rs.filter(r => r.bucket === b).sort((x, y) => x.ageDays - y.ageDays).slice(0, 15)
    if (!top.length) continue
    console.log(`  -- ${b}`)
    for (const r of top) console.log(`     ${r.branch.slice(0, 44).padEnd(44)} ${String(r.unique).padStart(3)} new, ${String(r.files).padStart(4)} files, ${String(r.ageDays).padStart(3)}d old, behind ${String(r.behind).padStart(4)}  ${r.pr.padEnd(12)} ${r.backedUp}`)
  }
}
console.log(`\nfull table: ${out}`)
console.log('Dates and counts are from git; PR states from gh. Nothing was changed.')
