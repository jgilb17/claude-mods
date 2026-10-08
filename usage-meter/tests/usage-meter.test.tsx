import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { crossed, label, meter, ordered, resetText, tone } from '../hooks/logic'

const NOW = Date.parse('2026-10-08T16:00:00Z') // 9:00 AM in Los Angeles
const TZ = 'America/Los_Angeles'

test('labels, colors and the meter', () => {
  expect(label('five_hour')).toBe('5-hour')
  expect(label('seven_day')).toBe('Week')
  expect(tone(20)).toBe('#2ed573'); expect(tone(60)).toBe('#ffc14d'); expect(tone(85)).toBe('#ff6b35'); expect(tone(97)).toBe('#ff4d4f')
  expect(meter(50, 10)).toEqual({ filled: '█████', empty: '░░░░░' })
  expect(meter(130, 4).filled).toBe('████')
})

test('reset times read like a person would say them', () => {
  expect(resetText('2026-10-08T21:40:00Z', NOW, TZ)).toBe('resets 2:40 PM')
  expect(resetText('2026-10-08T22:00:00Z', NOW, TZ)).toBe('resets 3 PM')
  expect(resetText('2026-10-12T16:00:00Z', NOW, TZ)).toBe('resets Mon 9 AM')
  expect(resetText('2026-10-30T16:00:00Z', NOW, TZ)).toBe('resets Oct 30')
  expect(resetText('2026-10-08T15:00:00Z', NOW, TZ)).toBe('resetting now')
  expect(resetText(undefined, NOW, TZ)).toBe('')
})

test('the short window comes first, and each threshold is announced once', () => {
  expect(ordered([{ kind: 'seven_day', percentUsed: 1 }, { kind: 'five_hour', percentUsed: 2 }]).map(l => l.kind)).toEqual(['five_hour', 'seven_day'])
  expect(crossed(70, 82)).toBe(80)
  expect(crossed(82, 85)).toBe(null)
  expect(crossed(79, 96)).toBe(95)
})

function world(on: On, toasts: string[]) {
  mock.clock(on, { now: NOW })
  on('ui.toast', async (_$, e) => { toasts.push((e as { text: string }).text); return { value: undefined } as never })
  on('session.measure', async (_$, e) => ({ changed: (e as { changed: unknown }).changed }) as never)
  on('ui.render', async ($, e) => {
    const { Text } = $.ui.resolve(e as never) as never as { Text: (p: object) => never }
    return h(Text as never, null, 'band above') as never
  })
}
const PROPS = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 9 }, view: {} }
const measure = (five: number, week: number, ctx: number) => ({
  context: { tokens: ctx * 2000, window: 200000, percent: ctx },
  rateLimits: [
    { kind: 'seven_day', percentUsed: week, resetsAt: '2026-10-12T16:00:00Z' },
    { kind: 'five_hour', percentUsed: five, resetsAt: '2026-10-08T21:40:00Z' },
  ],
  cost: { usd: 4.2 },
  changed: ['context', 'rateLimits', 'cost'],
})

test('a measurement draws both limits, context and cost, under any other band', async ($, on) => {
  const toasts: string[] = []
  world(on, toasts)
  await $.session.measure(measure(38, 22, 61) as never)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'usage-meter', surface, component: 'AbovePrompt', props: PROPS as never })
    const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
    const all = texts.join(' | ')
    expect(all).toContain('5-hour')
    expect(all).toContain('38%')
    expect(all).toContain('Week')
    expect(all).toContain('22%')
    expect(all).toContain('resets Mon')
    expect(all).toContain('Context')
    expect(all).toContain('61%')
    expect(all).toContain('$4.20 this session at API rates')
    expect(texts.indexOf('band above')).toBe(0)
  }
  expect(toasts.length).toBe(0)
})

test('crossing 80% on the 5-hour window raises one toast', async ($, on) => {
  const toasts: string[] = []
  world(on, toasts)
  await $.session.measure(measure(70, 22, 40) as never)
  await $.session.measure(measure(83, 22, 45) as never)
  await $.session.measure(measure(86, 22, 50) as never)
  expect(toasts.length).toBe(1)
  expect(toasts[0]).toContain('5-hour limit at 83%')
})

test('before any reading it says what will appear', async ($, on) => {
  world(on, [])
  const ui = await $.ui.mount({ plugin: 'usage-meter', surface: 'terminal', component: 'AbovePrompt', props: PROPS as never })
  const all = (await ui.findAll({ type: 'Text' })).map(t => t.text).join(' | ')
  expect(all).toContain('Usage appears after the first reply')
})

test('/usage-meter hides and shows it', async ($, on) => {
  world(on, [])
  await $.session.measure(measure(38, 22, 61) as never)
  await $.command.run({ command: 'usage-meter', args: '' } as never)
  let ui = await $.ui.mount({ plugin: 'usage-meter', surface: 'terminal', component: 'AbovePrompt', props: PROPS as never })
  expect((await ui.findAll({ type: 'Text' })).map(t => t.text).join('|')).toBe('band above')
  await $.command.run({ command: 'usage-meter', args: '' } as never)
  ui = await $.ui.mount({ plugin: 'usage-meter', surface: 'terminal', component: 'AbovePrompt', props: PROPS as never })
  expect((await ui.findAll({ type: 'Text' })).map(t => t.text).join('|')).toContain('38%')
})
