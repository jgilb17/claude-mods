import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Celebration, Task } from '../types'
import { bar, counts, duration, eta, fromTodos, gradient, milestonesCrossed, runs, textReport, today, upsert } from './logic'

const tasksA = atom({ plugin: 'progress-pulse', key: 'tasks' } as const, [] as Task[])
const startA = atom({ plugin: 'progress-pulse', key: 'sessionStart' } as const, 0)
const cheerA = atom({ plugin: 'progress-pulse', key: 'celebration' } as const, null as Celebration | null)
const projectA = atom({ plugin: 'progress-pulse', key: 'project' } as const, '')
const hiddenA = atom({ plugin: 'progress-pulse', key: 'bandHidden' } as const, false)

const PANE = 'progress-pulse'
const CHEER_MS = 8000
const QUIET_AFTER_DONE_MS = 15 * 60_000

async function projectName($: EngineInterface): Promise<string> {
  try {
    const r = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { timeoutMs: 3000 })
    if (r.exitCode === 0) return r.stdout.trim().split('/').filter(Boolean).pop() ?? ''
  } catch { /* not a repo, or git missing */ }
  const cwd = await $.session.cwd()
  return cwd.split('/').filter(Boolean).pop() ?? 'this session'
}

// Everything that happens when the task list changes: store it, and cheer what just finished.
async function apply($: EngineInterface, change: (prev: Task[], now: number) => Task[]): Promise<void> {
  const now = await $.clock.now()
  const stored = await read($, tasksA)
  const isDemo = (t: Task) => t.id.startsWith('demo-')
  const before = stored
  let after = change(before, now)
  if (after.some(t => !isDemo(t)) && after.some(isDemo)) after = after.filter(t => !isDemo(t))
  await update($, tasksA, () => after)

  const was = new Set(before.filter(t => t.status === 'completed').map(t => t.id))
  const landed = after.filter(t => t.status === 'completed' && !was.has(t.id))
  if (!landed.length) return

  const b = counts(before), a = counts(after)
  const all = a.total > 0 && a.done === a.total
  const last = landed[landed.length - 1]!
  const startedAt = await read($, startA)
  const text = all
    ? `ALL ${a.total} DONE in ${duration(now - (startedAt || now))}. Shipped.`
    : `Done: ${last.subject}   ${a.done} of ${a.total}`
  await update($, cheerA, () => ({ text, big: all, until: now + CHEER_MS }))
  $.clock.after(CHEER_MS + 50, () => {
    void (async () => {
      const t = await $.clock.now()
      await update($, cheerA, c => (c && c.until <= t ? null : c))
    })().catch(() => {})
  })

  for (const m of milestonesCrossed(b.total ? b.pct : 0, a.pct)) {
    if (m < 100) $.ui.toast(`${m}% of the way there: ${a.done} of ${a.total} done`)
  }
  if (all) $.ui.toast(`Every task done: ${a.total} of ${a.total}. Nice work.`, { timeoutMs: 8000 })

  // A running tally per project per day, kept across sessions, for the pane's Today section.
  if (landed.every(isDemo)) return
  try {
    const project = (await read($, projectA)) || 'this session'
    const key = `day:${today(now)}`
    const tally = ((await $.store.get(key)) ?? {}) as Record<string, number>
    tally[project] = (tally[project] ?? 0) + landed.filter(t => !isDemo(t)).length
    await $.store.set(key, tally)
  } catch { /* the tally is a nicety; never let it break a tool call */ }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    if (!(await read($, startA))) {
      const now = await $.clock.now()
      await update($, startA, () => now)
    }
    const name = await projectName($)
    await update($, projectA, () => name)
    await $.command.register({ name: 'progress', description: 'Show live progress on what this session is working on' })
    return r
  })

  on('command.run', { command: 'progress' }, async ($, e) => {
    await update($, hiddenA, () => false)
    if (e.args.trim() === 'demo') {
      // A 12-second show of what a session looks like as it works through a list. Demo tasks
      // carry a demo- id, are never tallied, and vanish the moment a real task arrives.
      const steps = ['Read the brief', 'Pull the live numbers', 'Build the change', 'Run the test suite', 'Check it on real data', 'Ship it']
      await apply($, (_prev, now) => steps.reduce((ts, s, i) => upsert(ts, `demo-${i}`, { subject: s }, now), [] as Task[]))
      let i = 0
      const tick = $.clock.every(1000, () => {
        const k = Math.floor(i / 2), starting = i % 2 === 0
        i++
        if (k >= steps.length) { tick.cancel(); return }
        void apply($, (prev, now) => upsert(prev, `demo-${k}`, starting
          ? { status: 'in_progress', activeForm: steps[k] + '...' }
          : { status: 'completed' }, now)).catch(() => {})
      })
      return { text: 'Running a 12 second demo in the band above the prompt.' }
    }
    try { await $.ui.open({ id: PANE, title: 'Progress' }) } catch { /* a screen with no panes: the text below still answers */ }
    // Also answer in text: sessions whose screen does not draw mod bands or panes (a cloud
    // session viewed from the app) still get the picture as a transcript line.
    const tasks = await read($, tasksA)
    const now = await $.clock.now()
    const started = await read($, startA)
    return { text: textReport(tasks, (await read($, projectA)) || 'this session', now - (started || now)) }
  })

  // The session's own task list is the source of truth: every TaskCreate, TaskUpdate and
  // TodoWrite the model makes passes through here, and only a call that succeeded is counted.
  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const r = await next(e)
    const id = r.deny === undefined && !r.isError ? r.result?.task?.id : undefined
    if (id) await apply($, (prev, now) => upsert(prev, String(id), { subject: e.subject, activeForm: e.activeForm ?? null }, now))
    return r
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const r = await next(e)
    if (r.deny !== undefined || r.isError || r.result?.success === false) return r
    const id = String(e.taskId)
    if (e.status === 'deleted') {
      await apply($, prev => prev.filter(t => t.id !== id))
    } else {
      await apply($, (prev, now) => upsert(prev, id, {
        ...(e.subject ? { subject: e.subject } : {}),
        ...(e.activeForm ? { activeForm: e.activeForm } : {}),
        ...(e.status && e.status !== 'deleted' ? { status: e.status } : {}),
      }, now))
    }
    return r
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const r = await next(e)
    if (r.deny === undefined && !r.isError) await apply($, (prev, now) => fromTodos(prev, e.todos, now))
    return r
  }).catch(($, e, next) => next(e))

  // The band above the prompt: one glance, always there while there is work on the list.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    const tasks = await read($, tasksA)
    if (e.props.hasSurvey || !tasks.length || (await read($, hiddenA))) return below
    const now = await $.clock.now()
    const c = counts(tasks)
    const lastDone = Math.max(0, ...tasks.map(t => t.doneAt ?? 0))
    const cheer = await read($, cheerA)
    const cheering = cheer && cheer.until > now
    if (c.done === c.total && now - lastDone > QUIET_AFTER_DONE_MS && !cheering) return below

    const { Box, Text, Button } = $.ui.resolve(e)
    const project = await read($, projectA)
    const started = await read($, startA)
    // Size the bar to what is left of the line after the fixed text, so the band never wraps,
    // including when the /progress pane is docked beside the transcript and narrows it.
    const name = (project || 'session').slice(0, 24)
    const tail = ` ${c.pct}%  ${c.done} of ${c.total} · ${duration(now - (started || now))}`
    const width = Math.max(6, Math.min(40, e.props.bodyColumns - (2 + name.length + 1) - tail.length - 7))
    const active = tasks.find(t => t.status === 'in_progress')
    const upNext = tasks.find(t => t.status === 'pending')

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" flexWrap="nowrap">
          <Text wrap="truncate-end">
            <Text bold color={gradient(c.pct / 100)}>{'◆ '}</Text>
            <Text bold>{name + ' '}</Text>
            {runs(bar(c, width)).map(r => (r.color ? <Text color={r.color}>{r.text}</Text> : <Text dimColor>{r.text}</Text>))}
            <Text bold color={gradient(c.pct / 100)}>{` ${c.pct}%`}</Text>
            <Text dimColor>{`  ${c.done} of ${c.total} · ${duration(now - (started || now))}`}</Text>
          </Text>
          <Box marginLeft={2}>
            <Button key="hide" plain label="hide" onPress={() => update($, hiddenA, () => true)} />
          </Box>
        </Box>
        {cheering
          ? <Text bold color={cheer!.big ? '#2ed573' : 'success'}>{(cheer!.big ? '★ ★ ★  ' : '✦  ') + cheer!.text + (cheer!.big ? '  ★ ★ ★' : '  ✦')}</Text>
          : active
            ? <Text>
                <Text color={gradient(c.pct / 100)}>{'▶ '}</Text>
                <Text>{active.activeForm || active.subject}</Text>
                {upNext ? <Text dimColor>{'   next: ' + upNext.subject}</Text> : null}
              </Text>
            : upNext ? <Text dimColor>{'○ up next: ' + upNext.subject}</Text> : null}
        {below}
      </Box>
    )
  })

  // The full view: /progress opens it.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const tasks = await read($, tasksA)
    const project = await read($, projectA)
    const started = await read($, startA)
    const now = await $.clock.now()
    const c = counts(tasks)
    const cols = e.props.bodyColumns
    const width = Math.max(10, Math.min(60, cols - 4))
    const big = runs(bar(c, width))
    const left = eta(tasks)
    const doneTimes = tasks.filter(t => t.status === 'completed' && t.doneAt).map(t => (t.doneAt as number) - (t.startedAt ?? t.createdAt))
    const avg = doneTimes.length ? doneTimes.reduce((x, y) => x + y, 0) / doneTimes.length : null

    let tally: Record<string, number> = {}
    try { tally = ((await $.store.get(`day:${today(now)}`)) ?? {}) as Record<string, number> } catch { /* empty */ }
    const most = Math.max(1, ...Object.values(tally))
    const barRow = (key: string) => (
      <Box key={key} flexDirection="row">
        {big.map(r => (r.color ? <Text color={r.color}>{r.text}</Text> : <Text dimColor>{r.text}</Text>))}
      </Box>
    )

    return (
      <Box flexDirection="column">
        <Text bold>{`${project || 'This session'}`}</Text>
        <Text> </Text>
        {tasks.length === 0
          ? <Text dimColor>No task list yet. Progress appears as soon as the session breaks the work into tasks.</Text>
          : <Box flexDirection="column">
              {barRow('b1')}{barRow('b2')}
              <Text> </Text>
              <Text>
                <Text bold color={gradient(c.pct / 100)}>{`${c.pct}%`}</Text>
                <Text>{`  ${c.done} of ${c.total} done`}</Text>
                <Text dimColor>{c.active ? `  ·  ${c.active} in progress` : ''}</Text>
              </Text>
              <Text> </Text>
              {tasks.map(t => {
                const took = t.status === 'completed' && t.doneAt ? duration(t.doneAt - (t.startedAt ?? t.createdAt))
                  : t.status === 'in_progress' && t.startedAt ? `${duration(now - t.startedAt)} so far` : ''
                return t.status === 'completed'
                  ? <Text><Text color="#2ed573">{'✓ '}</Text><Text dimColor>{t.subject}</Text><Text dimColor>{took ? `  ${took}` : ''}</Text></Text>
                  : t.status === 'in_progress'
                    ? <Text><Text bold color={gradient(c.pct / 100)}>{'▶ '}</Text><Text bold>{t.activeForm || t.subject}</Text><Text dimColor>{took ? `  ${took}` : ''}</Text></Text>
                    : <Text dimColor>{'○ ' + t.subject}</Text>
              })}
              <Text> </Text>
              <Text dimColor>
                {`Elapsed ${duration(now - (started || now))}`}
                {avg !== null ? `  ·  ${duration(avg)} per task (measured)` : ''}
                {left !== null && left > 0 ? `  ·  about ${duration(left)} left (estimate from that average)` : ''}
              </Text>
            </Box>}
        {Object.keys(tally).length
          ? <Box flexDirection="column">
              <Text> </Text>
              <Text bold>Today across projects</Text>
              {Object.entries(tally).sort((x, y) => y[1] - x[1]).map(([name, n], i) => (
                <Text>
                  <Text>{name.padEnd(22).slice(0, 22)}</Text>
                  <Text color={gradient(n / most)}>{'█'.repeat(Math.max(1, Math.round((n / most) * 24)))}</Text>
                  <Text bold>{`  ${n}`}</Text>
                </Text>
              ))}
            </Box>
          : null}
      </Box>
    )
  })
}
