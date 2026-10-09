import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { lane } from '../hooks/route'

test('lanes: lookups go light, building goes to sonnet, judgment goes heavy, heavy wins ties', () => {
  expect(lane('Count agent definitions per division', 'Read-only. Count the files.').lane).toBe('light')
  expect(lane('Find where pricing is set', 'x').lane).toBe('heavy')
  expect(lane('Map the repo layout', 'x').lane).toBe('light')
  expect(lane('Write the unit tests', 'x').lane).toBe('build')
  expect(lane('Fix the date parser', 'x').lane).toBe('build')
  expect(lane('Review the migration', 'x').lane).toBe('heavy')
  expect(lane('Summarize revenue by property', 'x').lane).toBe('heavy')
  expect(lane('List files and update the index', 'x').lane).toBe('build')
  expect(lane('Draft owner statement', 'x').lane).toBe('heavy')
})

function world(on: On, seen: { model?: string }[]) {
  mock.clock(on, { now: 1_760_000_000_000 })
  mock.store(on)
  on('agent.spawn', async (_$, e) => { seen.push({ model: (e as { model?: string }).model }); return { agentId: 'a' + seen.length, model: (e as { model?: string }).model ?? 'claude-opus-5-5' } as never })
}
const spawn = (description: string, extra: object = {}) => ({ description, prompt: 'Read-only task.', subagentType: 'general-purpose', parentModel: 'claude-opus-5-5', tool_use_id: 't', provider: { plugin: 'engine', tier: 'core' }, ...extra })

test('fills in a model only when Claude left it unset on a general-purpose agent', async ($, on) => {
  const seen: { model?: string }[] = []
  world(on, seen)
  await $.agent.spawn(spawn('Count the agent files') as never)
  await $.agent.spawn(spawn('Review the auth change') as never)
  await $.agent.spawn(spawn('Build the endpoint', { prompt: 'Add it.' }) as never)
  await $.agent.spawn(spawn('Count things', { model: 'opus' }) as never)
  await $.agent.spawn(spawn('Count things', { subagentType: 'Explore' }) as never)
  expect(seen.map(s => s.model)).toEqual(['haiku', 'opus', 'sonnet', 'opus', undefined])
  const r = await $.command.run({ command: 'model-router', args: '' } as never) as { text: string }
  expect(r.text).toContain('router: "Count" is a lookup')
  expect(r.text).toContain('claude: chosen by Claude')
  expect(r.text).toContain('definition: Explore uses its own model setting')
})

test('off switch restores plain inheritance', async ($, on) => {
  const seen: { model?: string }[] = []
  world(on, seen)
  await $.command.run({ command: 'model-router', args: 'off' } as never)
  await $.agent.spawn(spawn('Count the agent files') as never)
  expect(seen[0]!.model).toBe(undefined)
})

test('the policy reaches only loops that can spawn agents', async ($, on) => {
  mock.store(on)
  on('prompt.compose', async () => ({ sections: [{ id: 'intro', text: 'hi', scope: 'shared' }] }) as never)
  const main = await $.prompt.compose({ model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: [], tools: ['Agent', 'Read'], outputStyle: null, traits: [] } as never) as unknown as { sections: { id: string }[] }
  expect(main.sections.map(s => s.id)).toContain('model-router:policy')
  const sub = await $.prompt.compose({ model: 'claude-haiku-4-5', promptModel: 'claude-haiku-4-5', surfaces: [], tools: ['Read'], outputStyle: null, traits: [] } as never) as unknown as { sections: { id: string }[] }
  expect(sub.sections.map(s => s.id)).not.toContain('model-router:policy')
})

test('routine guest and owner lookups stay cheap; money and statements go heavy', () => {
  expect(lane('List guest reservations for next week', 'Read-only.').lane).toBe('light')
  expect(lane('Draft owner statement', 'x').lane).toBe('heavy')
})
