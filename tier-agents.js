#!/usr/bin/env node
// Gives every agent definition in a repo's .claude/agents a model tier, so named agents stop
// silently inheriting the session model (Opus). Same lanes as the model-router mod:
// haiku for lookups, sonnet for building, opus for judgment, money, compliance and leads.
// Usage:
//   node tier-agents.js <repo>            dry run: prints the proposed tiers, changes nothing
//   node tier-agents.js <repo> --apply    new branch from origin/main, adds model lines, commits (no push)
//   node tier-agents.js <repo> --retier [--apply]   on that branch, re-decide the lines it added
// Files that already have a model line are never touched.
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process')
const args = process.argv.slice(2)
const apply = args.includes('--apply')
const retier = args.includes('--retier')
const repo = path.resolve((args.find(a => !a.startsWith('--')) || '.').replace(/^~(?=$|\/)/, process.env.HOME))
const root = path.join(repo, '.claude', 'agents')
if (!fs.existsSync(root)) { console.log('no .claude/agents in', repo); process.exit(1) }

// Tier by the agent's role (its name and division), not by words in its description: a first
// pass on descriptions put 180 of 270 jpg agents on Opus because words like "design" and "lead"
// show up in almost every description. Most specialists build things, so the default is Sonnet.
const HEAVY_ROLE = /(review|audit|architect|security|secur|penetration|pentest|threat|compliance|legal|counsel|lawyer|paralegal|financ|accountant|bookkeep|\btax|\bcfo\b|\bcto\b|\bceo\b|\bcoo\b|chief|director|\blead\b|head of|strateg|planner|orchestrat|coordinator|incident|forensic|\brisk\b|gatekeeper|finish-gate|guardian)/i
const HEAVY_DIVISION = /^(finance|legal|security|compliance|strategy)(\/|$)/i
const LIGHT_ROLE = /\b(finder|searcher|indexer|formatter|scanner|collector|scraper|fetcher|lister|counter|tagger|classifier|summari[sz]er|transcriber|note-?taker|librarian)/i
function tierFor(name, division) {
  const h = name.match(HEAVY_ROLE); if (h) return ['opus', `role "${h[0]}"`]
  if (HEAVY_DIVISION.test(division)) return ['opus', `division ${division}`]
  const l = name.match(LIGHT_ROLE); if (l) return ['haiku', `role "${l[0]}"`]
  return ['sonnet', 'default: builds things']
}
const files = []
;(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.md')) files.push(p) } })(root)

const plan = [], skipped = []
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8')
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!m) { skipped.push([f, 'no frontmatter']); continue }
  if (/^model:/m.test(m[1]) && !retier) { skipped.push([f, 'already has a model']); continue }
  const name = (m[1].match(/^name:\s*(.*)$/m) || [])[1] || path.basename(f, '.md')
  const desc = (m[1].match(/^description:\s*(.*)$/m) || [])[1] || ''
  const division = path.relative(root, f).split(path.sep).slice(0, -1).join('/') || '(top)'
  const [tier, why] = tierFor(name, division)
  plan.push({ f, rel: path.relative(root, f), division, name, tier, why, src, fm: m })
}
const by = (k) => plan.reduce((o, p) => ((o[p[k]] = o[p[k]] || []).push(p), o), {})
console.log(`${files.length} agent files: ${plan.length} to tier, ${skipped.length} skipped`)
for (const [t, ps] of Object.entries(by('tier'))) console.log(`  ${t.padEnd(7)} ${ps.length}`)
console.log('\nby division (opus / sonnet / haiku):')
for (const [d, ps] of Object.entries(by('division')).sort()) {
  const c = t => ps.filter(p => p.tier === t).length
  console.log(`  ${d.padEnd(34).slice(0, 34)} ${String(c('opus')).padStart(3)} / ${String(c('sonnet')).padStart(3)} / ${String(c('haiku')).padStart(3)}`)
}
for (const t of ['opus', 'sonnet', 'haiku']) {
  const ps = plan.filter(p => p.tier === t).slice(0, 12)
  if (ps.length) { console.log(`\nsample ${t}:`); for (const p of ps) console.log(`  ${p.name.slice(0, 40).padEnd(40)} ${p.why}`) }
}
if (skipped.length) { console.log('\nskipped:'); for (const [f, why] of skipped.slice(0, 10)) console.log(`  ${path.relative(root, f)}  (${why})`) }
if (!apply) { console.log(retier ? '\nDry run of a re-tier. Nothing changed. Add --apply to rewrite the lines on the tiers branch.' : '\nDry run. Nothing changed. Add --apply to write the model lines on a new branch.'); process.exit(0) }

const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' }).trim()
if (git('status', '--porcelain')) { console.log('\nThe repo has uncommitted changes. Commit or stash them first; nothing was changed.'); process.exit(1) }
const branch = 'claude/agent-model-tiers'
if (retier) {
  // Only on the tiers branch, and only model lines that branch added: never an original one.
  if (git('branch', '--show-current') !== branch) { console.log(`\n--retier runs only on ${branch}. Nothing changed.`); process.exit(1) }
  const added = new Set(git('diff', '--name-only', 'origin/main', 'HEAD', '--', '.claude/agents').split('\n').filter(Boolean).map(x => path.join(repo, x)))
  let n = 0
  for (const p of plan) {
    if (!added.has(p.f)) continue
    const src = fs.readFileSync(p.f, 'utf8')
    const next = src.replace(/^model: .*$/m, `model: ${p.tier}`)
    if (next !== src) { fs.writeFileSync(p.f, next); n++ }
  }
  if (!n) { console.log('\nNo tiers changed.'); process.exit(0) }
  git('add', '-A', '.claude/agents')
  git('commit', '-q', '-m', `Re-tier agents by role: ${n} files changed`)
  console.log(`\nRe-tiered ${n} files on ${branch} and committed. Not pushed.`)
  console.log(`Branch vs origin/main: ${git('diff', '--stat', 'origin/main', 'HEAD', '--', '.claude/agents').split('\n').pop()}`)
  process.exit(0)
}
git('fetch', '-q', 'origin')
git('switch', '-q', '-c', branch, 'origin/main')
let n = 0
for (const p of plan) {
  const src = fs.readFileSync(p.f, 'utf8') // re-read on the new branch
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!m || /^model:/m.test(m[1])) continue
  const nl = src.includes('\r\n') ? '\r\n' : '\n'
  fs.writeFileSync(p.f, src.replace(m[0], `---${nl}${m[1]}${nl}model: ${p.tier}${nl}---`))
  n++
}
git('add', '-A', '.claude/agents')
git('commit', '-q', '-m', `Give every agent a model tier (${n} files): haiku for lookups, sonnet for building, opus for judgment`)
console.log(`\nWrote model lines into ${n} files on branch ${branch} and committed. Not pushed.`)
console.log(`Diff check: ${git('diff', '--stat', 'HEAD~1', 'HEAD').split('\n').pop()}`)
