import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionMeasureInput, SessionUsage } from 'claude-code'

import type { Reading } from '../types'
import { crossed, k, label, meter, money, ordered, resetText, tone } from './logic'

const readingA = atom({ plugin: 'usage-meter', key: 'reading' } as const, null as Reading | null)
const hiddenA = atom({ plugin: 'usage-meter', key: 'hidden' } as const, false)

function toReading(u: SessionUsage | SessionMeasureInput, at: number): Reading {
  return {
    limits: u.rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, ...(l.resetsAt ? { resetsAt: l.resetsAt } : {}) })),
    contextPercent: u.context.percent ?? null,
    contextWindow: u.context.window,
    costUsd: u.cost ? u.cost.usd : null,
    at,
  }
}

async function store($: EngineInterface, next: Reading): Promise<void> {
  const prev = await read($, readingA)
  await update($, readingA, () => next)
  for (const l of next.limits) {
    const before = prev?.limits.find(p => p.kind === l.kind)?.percentUsed
    const m = crossed(before, l.percentUsed)
    if (m) $.ui.toast(`${label(l.kind)} limit at ${l.percentUsed}%. ${resetText(l.resetsAt, next.at)}`.trim(), { timeoutMs: 8000 })
  }
}

export const register: Register = on => {
  // A first reading at start (free: no API call), then every change the engine measures.
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    try {
      const u = await $.session.usage()
      await store($, toReading(u, await $.clock.now()))
    } catch { /* the band waits for the first measurement instead */ }
    await $.command.register({ name: 'usage-meter', description: 'Show or hide the usage meter above the message box' })
    return r
  })

  on('session.measure', async ($, e, next) => {
    const r = await next(e)
    await store($, toReading(e, await $.clock.now()))
    return r
  })

  on('command.run', { command: 'usage-meter' }, async $ => {
    const now = await update($, hiddenA, h => !h)
    return { text: now ? 'Usage meter hidden. Run /usage-meter again to show it.' : 'Usage meter shown.' }
  })

  // Drawn below any other band, so it sits directly on top of the message box.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    const r = await read($, readingA)
    if (e.props.hasSurvey || (await read($, hiddenA))) return below
    const { Box, Text } = $.ui.resolve(e)
    const now = await $.clock.now()
    const cols = e.props.bodyColumns
    const barW = cols >= 110 ? 12 : cols >= 80 ? 8 : 5

    const limits = r ? ordered(r.limits) : []
    const pieces = limits.map(l => {
      const m = meter(l.percentUsed, barW)
      const c = tone(l.percentUsed)
      return (
        <Text>
          <Text bold>{label(l.kind) + ' '}</Text>
          <Text color={c}>{m.filled}</Text><Text dimColor>{m.empty}</Text>
          <Text bold color={c}>{` ${l.percentUsed}%`}</Text>
          <Text dimColor>{cols >= 70 && l.resetsAt ? `  ${resetText(l.resetsAt, now)}` : ''}</Text>
        </Text>
      )
    })
    const ctx = r && r.contextPercent !== null
      ? <Text>
          <Text bold>{'Context '}</Text>
          <Text bold color={tone(r.contextPercent)}>{`${r.contextPercent}%`}</Text>
          <Text dimColor>{` of ${k(r.contextWindow)}`}</Text>
        </Text>
      : null
    const cost = r && r.costUsd !== null && cols >= 100
      ? <Text dimColor>{`${money(r.costUsd)} this session at API rates`}</Text>
      : null
    const empty = !limits.length
      ? <Text dimColor>{r ? 'Plan limits appear after the first reply in this session.' : 'Usage appears after the first reply in this session.'}</Text>
      : null

    return (
      <Box flexDirection="column">
        {below}
        <Box flexDirection="row" flexWrap="wrap" columnGap={3}>
          {empty}
          {pieces}
          {ctx}
          {cost}
        </Box>
      </Box>
    )
  })
}
