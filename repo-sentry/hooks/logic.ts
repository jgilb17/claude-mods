import type { RepoInfo } from '../types'

// Repo folder name -> business label. Edit this map as repos are added.
export const BUSINESS: Record<string, string> = {
  'apek-hub': 'APEK',
  'df-correspondence': 'Desert Fire',
  jpg: 'JPG',
  'claude-guard': 'Shared',
}

const PROTECTED_BRANCHES = new Set(['main', 'master', 'production', 'prod'])
const SECRET = /(^|\/)(\.env(\..+)?|secrets?\/.*|.*\.pem|.*\.key|credentials\.json|service-account.*\.json)$/i

export function businessFor(repo: string): string {
  const name = repo.toLowerCase()
  if (BUSINESS[name]) return BUSINESS[name]
  if (name.startsWith('apek')) return 'APEK'
  if (name.startsWith('df-') || name.includes('desert-fire')) return 'Desert Fire'
  if (name.startsWith('fwd') || name.includes('first-wave')) return 'First Wave Dental'
  if (name.startsWith('jpg')) return 'JPG'
  return repo
}

const lines = (s: string) => s.split('\n').map(l => l.trim()).filter(Boolean)

// aheadBehind is the output of `git rev-list --left-right --count HEAD...@{u}`: "<ahead>\t<behind>",
// or null when the branch has no upstream.
export function parseAheadBehind(out: string | null): { ahead: number | null; behind: number | null } {
  const m = (out ?? '').trim().match(/^(\d+)\s+(\d+)$/)
  return m ? { ahead: Number(m[1]), behind: Number(m[2]) } : { ahead: null, behind: null }
}

export function buildInfo(toplevel: string, branch: string, porcelain: string, stagedNames: string, aheadBehind: string | null = null): RepoInfo {
  const repo = toplevel.trim().split('/').filter(Boolean).pop() ?? toplevel.trim()
  const b = branch.trim() || 'detached'
  const staged = lines(stagedNames)
  const warnings: string[] = []
  // On a clean main there is nothing to protect yet, and every session opens there, so the
  // warning only appears once there is work that would land on it.
  const dirtyCount = lines(porcelain).length
  if (PROTECTED_BRANCHES.has(b) && (dirtyCount > 0 || staged.length > 0)) warnings.push(`${dirtyCount + staged.length} changes on ${b}. Branch before committing.`)
  if (b === 'HEAD') warnings.push('Detached HEAD.')
  const { ahead, behind } = parseAheadBehind(aheadBehind)
  const dirty = lines(porcelain).length
  if (behind && behind > 0) {
    warnings.push(dirty > 0
      ? `${behind} commits behind origin with ${dirty} uncommitted files. Park them on a branch, then pull.`
      : `${behind} commits behind origin. Pull before working.`)
  }
  const secrets = staged.filter(f => SECRET.test(f))
  if (secrets.length) warnings.push(`Secret file staged: ${secrets.slice(0, 3).join(', ')}${secrets.length > 3 ? ` (+${secrets.length - 3})` : ''}. Unstage it.`)
  return {
    business: businessFor(repo),
    repo,
    branch: b,
    dirty,
    staged: staged.length,
    behind,
    ahead,
    warnings,
  }
}

export function statusText(info: RepoInfo | null): string | undefined {
  if (!info) return undefined
  const flag = info.warnings.length ? ' | !' : ''
  const sync = info.behind === null ? ' | no upstream'
    : info.behind || info.ahead ? ` | ${info.behind} behind, ${info.ahead} ahead` : ' | in sync'
  return `${info.business} | ${info.repo}@${info.branch}${sync} | ${info.dirty} dirty, ${info.staged} staged${flag}`
}
