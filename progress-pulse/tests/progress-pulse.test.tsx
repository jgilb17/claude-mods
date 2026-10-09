import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { agentsText, botSvg, currentBatch, finished, fraction, modelName, spawned, stepped, stepText, tier, trackSvg } from '../hooks/agents'
import { bar, counts, eta, fromTodos, gradient, milestonesCrossed, runs, textReport, upsert } from '../hooks/logic'
import type { Task } from '../types'

const T = (id: string, status: Task['status'], extra: Partial<Task> = {}): Task =>
  ({ id, subject: 'Task ' + id, activeForm: null, status, createdAt: 0, startedAt: null, doneAt: null, ...extra })

test('counts and percent', () => {
  const c = counts([T('1', 'completed'), T('2', 'completed'), T('3', 'in_progress'), T('4', 'pending')])
  expect(c).toEqual({ total: 4, done: 2, active: 1, pending: 1, pct: 50 })
  expect(counts([]).pct).toBe(0)
})

test('the bar fills with a gradient, shows work in flight, and turns all green at 100%', () => {
  const half = bar(counts([T('1', 'completed'), T('2', 'in_progress'), T('3', 'pending'), T('4', 'pending')]), 20)
  expect(half.length).toBe(20)
  expect(half.filter(c => c.ch === '█').length).toBe(5)
  expect(half.filter(c => c.ch === '▓').length).toBe(5)
  expect(half[0]!.color).toBe(gradient(0))
  const full = bar(counts([T('1', 'completed'), T('2', 'completed')]), 10)
  expect(full.every(c => c.color === '#2ed573')).toBe(true)
  expect(runs(full).length).toBe(1)
})

test('gradient runs orange to green', () => {
  expect(gradient(0)).toBe('#ff6b35')
  expect(gradient(1)).toBe('#2ed573')
  expect(gradient(0.5)).toBe('#ffc14d')
})

test('each quarter mark is cheered once', () => {
  expect(milestonesCrossed(20, 55)).toEqual([25, 50])
  expect(milestonesCrossed(50, 50)).toEqual([])
  expect(milestonesCrossed(75, 100)).toEqual([100])
})

test('the estimate needs two measured tasks and is average times what is left', () => {
  expect(eta([T('1', 'completed', { startedAt: 0, doneAt: 60_000 }), T('2', 'pending')])).toBe(null)
  const tasks = [T('1', 'completed', { startedAt: 0, doneAt: 60_000 }), T('2', 'completed', { startedAt: 0, doneAt: 180_000 }), T('3', 'pending'), T('4', 'in_progress')]
  expect(eta(tasks)).toBe(240_000)
})

test('task timings: started and finished are stamped once', () => {
  let ts = upsert([], '1', { subject: 'Ship it' }, 1000)
  ts = upsert(ts, '1', { status: 'in_progress' }, 2000)
  ts = upsert(ts, '1', { status: 'completed' }, 5000)
  expect(ts[0]).toMatchObject({ subject: 'Ship it', startedAt: 2000, doneAt: 5000, status: 'completed' })
})

test('TodoWrite rewrites keep a task timings by its text', () => {
  const a = fromTodos([], [{ content: 'A', status: 'in_progress', activeForm: 'Doing A' }, { content: 'B', status: 'pending' }], 1000)
  const b = fromTodos(a, [{ content: 'A', status: 'completed', activeForm: 'Doing A' }, { content: 'B', status: 'in_progress' }], 4000)
  expect(b[0]).toMatchObject({ status: 'completed', startedAt: 1000, doneAt: 4000 })
  expect(b[1]).toMatchObject({ status: 'in_progress', startedAt: 4000 })
})

function world(on: On, toasts: string[]) {
  let n = 0
  const clock = mock.clock(on, { now: 1_760_000_000_000 })
  mock.store(on)
  on('tool.call', async (_$, e) => {
    if (e.tool === 'TaskCreate') return { result: { task: { id: String(++n), subject: (e as { subject: string }).subject } }, text: 'ok' } as never
    if (e.tool === 'TaskUpdate') return { result: { success: true, taskId: (e as { taskId: string }).taskId, updatedFields: ['status'] }, text: 'ok' } as never
    return { result: {}, text: 'ok' } as never
  })
  on('ui.toast', async (_$, e) => { toasts.push((e as { text: string }).text); return { value: undefined } as never })
  on('ui.render', async ($, e) => {
    const { Text } = $.ui.resolve(e as never) as never as { Text: (p: object) => never }
    return h(Text as never, null, 'engine band') as never
  })
  return clock
}

const PROPS = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 9 }, view: {} }

test('the band tracks the real task list, cheers a finish, and keeps the band below it', async ($, on) => {
  const toasts: string[] = []
  world(on, toasts)
  for (const s of ['Write the fix', 'Test it', 'Ship it', 'Tell Joshua']) {
    await $.tool.call({ tool: 'TaskCreate', subject: s, description: s } as never)
  }
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'in_progress', activeForm: 'Writing the fix' } as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'progress-pulse', surface, component: 'AbovePrompt', props: PROPS as never })
    const text = (await ui.findAll({ type: 'Text' })).map(t => t.text).join(' | ')
    expect(text).toContain('0%')
    expect(text).toContain(surface === 'terminal' ? '0 of 4' : '0%')
    expect(text).toContain('Writing the fix')
    expect(text).toContain('next: Test it')
    expect(text).toContain('engine band')
  }

  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' } as never)
  const ui = await $.ui.mount({ plugin: 'progress-pulse', surface: 'terminal', component: 'AbovePrompt', props: PROPS as never })
  const text = (await ui.findAll({ type: 'Text' })).map(t => t.text).join(' | ')
  expect(text).toContain('25%')
  expect(text).toContain('Done: Write the fix   1 of 4')
  expect(toasts.some(t => t.startsWith('25% of the way there'))).toBe(true)
})

test('finishing everything is a big moment', async ($, on) => {
  const toasts: string[] = []
  world(on, toasts)
  await $.tool.call({ tool: 'TaskCreate', subject: 'One', description: 'x' } as never)
  await $.tool.call({ tool: 'TaskCreate', subject: 'Two', description: 'x' } as never)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' } as never)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '2', status: 'completed' } as never)
  const ui = await $.ui.mount({ plugin: 'progress-pulse', surface: 'terminal', component: 'AbovePrompt', props: PROPS as never })
  const text = (await ui.findAll({ type: 'Text' })).map(t => t.text).join(' | ')
  expect(text).toContain('100%')
  expect(text).toContain('ALL 2 DONE')
  expect(toasts.some(t => t.startsWith('Every task done'))).toBe(true)
})

test('a failed tool call is not counted', async ($, on) => {
  mock.clock(on, { now: 1_760_000_000_000 })
  mock.store(on)
  on('tool.call', async () => ({ deny: 'nope' }) as never)
  on('ui.render', async ($, e) => {
    const { Text } = $.ui.resolve(e as never) as never as { Text: (p: object) => never }
    return h(Text as never, null, 'engine band') as never
  })
  await $.tool.call({ tool: 'TaskCreate', subject: 'Ghost', description: 'x' } as never)
  const ui = await $.ui.mount({ plugin: 'progress-pulse', surface: 'terminal', component: 'AbovePrompt', props: PROPS as never })
  const text = (await ui.findAll({ type: 'Text' })).map(t => t.text).join(' | ')
  expect(text).toBe('engine band')
})

test('the pane lists every task with its state', async ($, on) => {
  const toasts: string[] = []
  world(on, toasts)
  await $.tool.call({ tool: 'TaskCreate', subject: 'Alpha', description: 'x' } as never)
  await $.tool.call({ tool: 'TaskCreate', subject: 'Beta', description: 'x' } as never)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' } as never)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '2', status: 'in_progress', activeForm: 'Building Beta' } as never)
  const PANE = { bodyColumns: 80, bodyRows: 30, holdToasts: false, title: 'Progress' }
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'progress-pulse', surface, component: 'Pane', requestId: 'progress-pulse', props: PANE as never } as never)
    const text = (await ui.findAll({ type: 'Text' })).map(t => t.text).join(' | ')
    expect(text).toContain('50%')
    expect(text).toContain('Alpha')
    expect(text).toContain('Building Beta')
  }
})

test('the cheer fades after eight seconds and the bar stays', async ($, on) => {
  const clock = world(on, [])
  await $.tool.call({ tool: 'TaskCreate', subject: 'One', description: 'x' } as never)
  await $.tool.call({ tool: 'TaskCreate', subject: 'Two', description: 'x' } as never)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' } as never)
  await clock.advance(9000)
  const ui = await $.ui.mount({ plugin: 'progress-pulse', surface: 'terminal', component: 'AbovePrompt', props: PROPS as never })
  const text = (await ui.findAll({ type: 'Text' })).map(t => t.text).join(' | ')
  expect(text).toContain('50%')
  expect(text).not.toContain('Done: One')
  expect(text).toContain('up next: Two')
})

test('/progress demo plays a full run, then a real task replaces it', async ($, on) => {
  const clock = world(on, [])
  const r = await $.command.run({ command: 'progress', args: 'demo' } as never)
  expect(String((r as { text?: string }).text)).toContain('demo')
  await clock.advance(13_000)
  let ui = await $.ui.mount({ plugin: 'progress-pulse', surface: 'terminal', component: 'AbovePrompt', props: PROPS as never })
  let text = (await ui.findAll({ type: 'Text' })).map(t => t.text).join(' | ')
  expect(text).toContain('100%')
  expect(text).toContain('6 of 6')
  await $.tool.call({ tool: 'TaskCreate', subject: 'Real work', description: 'x' } as never)
  ui = await $.ui.mount({ plugin: 'progress-pulse', surface: 'terminal', component: 'AbovePrompt', props: PROPS as never })
  text = (await ui.findAll({ type: 'Text' })).map(t => t.text).join(' | ')
  expect(text).toContain('0 of 1')
})

test('the band line fits a narrow column without wrapping', async ($, on) => {
  world(on, [])
  for (let i = 0; i < 6; i++) await $.tool.call({ tool: 'TaskCreate', subject: 'T' + i, description: 'x' } as never)
  for (let i = 1; i <= 6; i++) await $.tool.call({ tool: 'TaskUpdate', taskId: String(i), status: 'completed' } as never)
  const narrow = { ...PROPS, bodyColumns: 60 }
  const ui = await $.ui.mount({ plugin: 'progress-pulse', surface: 'terminal', component: 'AbovePrompt', props: narrow as never })
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  const line = texts.find(t => t.includes('100%'))!
  expect(line.length + 2 + 4).toBeLessThanOrEqual(60)
  expect(line).toContain('session ')
  expect(line).toContain(' 100%')
})

test('/progress also answers in text, for screens that draw no bands', async ($, on) => {
  world(on, [])
  await $.tool.call({ tool: 'TaskCreate', subject: 'Alpha', description: 'x' } as never)
  await $.tool.call({ tool: 'TaskCreate', subject: 'Beta', description: 'x' } as never)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' } as never)
  const r = await $.command.run({ command: 'progress', args: '' } as never) as { text?: string }
  expect(r.text).toContain('50%')
  expect(r.text).toContain('✓ Alpha')
  expect(r.text).toContain('○ Beta')
  expect(textReport([], 'x', 0)).toContain('no task list yet')
})

test('agents: model names, tiers and the step a subagent is on', () => {
  expect(modelName('claude-opus-5-5')).toBe('Opus 5.5')
  expect(tier('claude-opus-5-5', 'general-purpose').label).toBe('heavy')
  expect(tier('claude-haiku-4-5', 'general-purpose').label).toBe('light')
  expect(tier('claude-opus-5-5', 'Explore').label).toBe('careful')
  expect(stepText('Read', { file_path: '/a/b/register.tsx' })).toContain('register.tsx')
  let crew = spawned([], { id: 'a1', name: 'Audit hooks', type: 'Explore', model: 'claude-sonnet-4-6', background: false }, 1000)
  crew = stepped(crew, 'a1', 'Reading files')
  expect(crew[0]).toMatchObject({ steps: 1, stepLabel: 'Reading files', status: 'running' })
  expect(fraction(crew[0]!)).toBe(null)
  crew = finished(crew, 'a1', true, 12_000, 61_000)
  expect(crew[0]).toMatchObject({ status: 'done', tokens: 12_000, endedAt: 61_000 })
  expect(currentBatch(crew).length).toBe(1)
  expect(agentsText(crew, 61_000)).toContain('✓ Audit hooks')
  expect(trackSvg(40, 'Review 3/4', 'running')).toContain('Review 3/4')
  expect(botSvg('#ff6b35', { bounce: true })).toContain('animateTransform')
})

function crewWorld(on: On) {
  world(on, [])
  let n = 0
  on('agent.spawn', async (_$, e) => ({ agentId: 'ag' + (++n), model: (e as { model?: string }).model ?? 'claude-opus-5-5' }) as never)
  on('turn.complete', async (_$, e) => ({ text: (e as { answer: string }).answer }) as never)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('session.usage', async () => ({ value: { startedAt: 0, context: {}, rateLimits: {}, cost: { usd: 4.25 } } }) as never)
}

test('a crew of subagents shows in the band, the pane and the text report', async ($, on) => {
  crewWorld(on)
  const a = await $.agent.spawn({ description: 'Audit the hooks', prompt: 'x', subagentType: 'Explore', model: 'claude-sonnet-4-6' } as never) as { agentId: string }
  const b = await $.agent.spawn({ description: 'Write the tests', prompt: 'x', subagentType: 'general-purpose', model: 'claude-opus-5-5' } as never) as { agentId: string }
  await $.tool.call({ tool: 'Bash', command: 'ls', description: 'Listing hook files', agentId: a.agentId } as never)
  await $.turn.complete({ agentId: b.agentId, answer: 'done', isAborted: false, turnId: 't1', reason: 'answer', usage: { input_tokens: 9000, output_tokens: 3000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, durationMs: 1000 } as never)

  const band = await $.ui.mount({ plugin: 'progress-pulse', surface: 'desktop', component: 'AbovePrompt', props: PROPS as never })
  const bandText = (await band.findAll({ type: 'Text' })).map(t => t.text).join(' | ')
  expect(bandText).toContain('50%')
  expect(bandText).toContain('×2')
  expect((await band.findAll({ type: 'Svg' })).length).toBe(2)

  const PANE = { bodyColumns: 80, bodyRows: 40, holdToasts: false, title: 'Progress' }
  const pane = await $.ui.mount({ plugin: 'progress-pulse', surface: 'desktop', component: 'Pane', requestId: 'progress-pulse', props: PANE as never } as never)
  const paneText = (await pane.findAll({ type: 'Text' })).map(t => t.text).join(' | ')
  expect(paneText).toContain('Agents  1 of 2 finished')
  expect(paneText).toContain('$4.25')
  expect(paneText).toContain('12k')
  expect(paneText).toContain('Running · 1')
  expect(paneText).toContain('Listing hook files')
  expect(paneText).toContain('Finished · 1')
  expect(paneText).toContain('careful')
  expect(paneText).toContain('heavy')

  const term = await $.ui.mount({ plugin: 'progress-pulse', surface: 'terminal', component: 'Pane', requestId: 'progress-pulse', props: PANE as never } as never)
  expect((await term.findAll({ type: 'Text' })).map(t => t.text).join(' | ')).toContain('Running · 1')

  const r = await $.command.run({ command: 'progress', args: '' } as never) as { text?: string }
  expect(r.text).toContain('Agents  1 of 2 finished')
  expect(r.text).toContain('● Audit the hooks')
})
