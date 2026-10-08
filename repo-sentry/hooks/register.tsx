import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { RepoInfo } from '../types'
import { buildInfo, statusText } from './logic'

const info = atom({ plugin: 'repo-sentry', key: 'info' } as const, null)
const hiddenFor = atom({ plugin: 'repo-sentry', key: 'hiddenFor' } as const, '')

async function git($: EngineInterface, args: string[], timeoutMs = 5000): Promise<string | null> {
  try {
    const r = await $.process.run(['git', ...args], { timeoutMs })
    return r.exitCode === 0 ? r.stdout : null
  } catch {
    return null
  }
}

async function refresh($: EngineInterface): Promise<void> {
  const top = await git($, ['rev-parse', '--show-toplevel'])
  let next: RepoInfo | null = null
  if (top !== null) {
    const [branch, porcelain, staged, aheadBehind] = await Promise.all([
      git($, ['rev-parse', '--abbrev-ref', 'HEAD']),
      git($, ['status', '--porcelain']),
      git($, ['diff', '--cached', '--name-only']),
      git($, ['rev-list', '--left-right', '--count', 'HEAD...@{u}']),
    ])
    next = buildInfo(top, branch ?? '', porcelain ?? '', staged ?? '', aheadBehind)
  }
  await update($, info, () => next)
  $.ui.status(statusText(next))
}

export const register: Register = on => {
  // Behind-origin is only as fresh as the last fetch, and both stale repos found on 8 Oct had
  // not been fetched in weeks. So: draw from local state at once, then fetch quietly (refs only,
  // repo hooks off, 15 s cap) and redraw, again every 10 minutes for long sessions. The fetch
  // runs on a $.clock timer because work that outlives the session.start dispatch belongs there.
  // A failed fetch (offline, no remote) changes nothing.
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await refresh($)
    const fetchAndRefresh = () => {
      void git($, ['fetch', '--quiet', '--no-tags'], 15000).then(() => refresh($)).catch(() => {})
    }
    $.clock.after(1000, fetchAndRefresh)
    $.clock.every(10 * 60_000, fetchAndRefresh)
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    await refresh($)
    return r
  })

  // Git commands the model runs can change branch or staging mid-turn.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const r = await next(e)
    if (/\bgit\b/.test(e.command)) await refresh($)
    return r
  }).catch(($, e, next) => next(e))

  // Draws above whatever is beneath (another mod's band, the engine's own) rather than in its
  // place, so two mods on the band both show.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    const now = await read($, info)
    if (e.props.hasSurvey || !now || now.warnings.length === 0) return below
    const sig = now.warnings.join('|')
    if ((await read($, hiddenFor)) === sig) return below

    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {now.warnings.map(w => (
          <Text color="warning">{now.repo}: {w}</Text>
        ))}
        <Button key="hide" label="Hide" onPress={() => update($, hiddenFor, () => sig)} />
        {below}
      </Box>
    )
  })
}
