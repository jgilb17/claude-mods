import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { buildInfo, businessFor, statusText } from '../hooks/logic'

test('behind origin is a warning, and worse with uncommitted work', () => {
  const stale = buildInfo('/Users/j/df-correspondence', 'main', ' M a.js\n M b.js\n', '', '0\t89')
  expect(stale.behind).toBe(89)
  expect(stale.warnings.some(w => w.includes('89 commits behind origin with 2 uncommitted files'))).toBe(true)
  expect(statusText(stale)).toContain('| 89 behind, 0 ahead |')
  const clean = buildInfo('/Users/j/apek-hub', 'feat/x', '', '', '0\t0')
  expect(clean.warnings.length).toBe(0)
  expect(statusText(clean)).toContain('| in sync |')
  const ahead = buildInfo('/Users/j/apek-hub', 'feat/x', '', '', '3\t0')
  expect(ahead.warnings.length).toBe(0)
  expect(statusText(ahead)).toContain('| 0 behind, 3 ahead |')
})

test('maps repos to businesses', () => {
  expect(businessFor('apek-hub')).toBe('APEK')
  expect(businessFor('df-correspondence')).toBe('Desert Fire')
  expect(businessFor('fwd-hub')).toBe('First Wave Dental')
  expect(businessFor('first-wave-dental')).toBe('First Wave Dental')
  expect(businessFor('apek-hub-guesty-write')).toBe('APEK')
  expect(businessFor('jpg-projreg')).toBe('JPG')
  expect(businessFor('random')).toBe('random')
})

test('warns on main and staged secrets, quiet on a feature branch', () => {
  const bad = buildInfo('/Users/j/apek-hub\n', 'main\n', ' M a.ts\n?? b.ts\n', '.env\nsrc/x.ts\n')
  expect(bad.warnings.length).toBe(2)
  expect(bad.dirty).toBe(2)
  expect(bad.staged).toBe(2)
  const cleanMain = buildInfo('/Users/j/apek-hub', 'main', '', '', '0\t0')
  expect(cleanMain.warnings.length).toBe(0)
  const ok = buildInfo('/Users/j/apek-hub', 'feat/x', '', 'src/x.ts')
  expect(ok.warnings.length).toBe(0)
  expect(statusText(ok)).toBe('APEK | apek-hub@feat/x | no upstream | 0 dirty, 1 staged')
  expect(statusText(null)).toBe(undefined)
})

function fakeGit(on: On, branch: string, staged: string, statuses: (string | undefined)[]) {
  on('process.run', async (_$, e) => {
    const a = e.argv.join(' ')
    const out =
      a === 'git rev-parse --show-toplevel' ? '/Users/j/df-correspondence\n'
      : a === 'git rev-parse --abbrev-ref HEAD' ? `${branch}\n`
      : a === 'git status --porcelain' ? ' M server.js\n'
      : a === 'git diff --cached --name-only' ? staged
      : a === 'git rev-list --left-right --count HEAD...@{u}' ? '0\t0\n'
      : ''
    return { value: { exitCode: 0, stdout: out, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.status', async (_$, e) => { statuses.push(e.text); return { value: undefined } })
  on('tool.call', async () => ({ result: { stdout: '', stderr: '', interrupted: false }, text: 'ok' }) as never)
}

const PROPS = {
  hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 9 }, view: {},
}

test('quiet on a clean feature branch', async ($, on) => {
  const statuses: (string | undefined)[] = []
  fakeGit(on, 'feat/invoices', 'server.js\n', statuses)
  on('ui.render', async ($, e) => { const { Text } = $.ui.resolve(e as never) as never as { Text: (p: object) => never }; return h(Text as never, null, 'engine band') as never })
  await $.tool.call({ tool: 'Bash', command: 'git status' } as never)
  expect(statuses.at(-1)).toBe('Desert Fire | df-correspondence@feat/invoices | in sync | 1 dirty, 1 staged')
  const ui = await $.ui.mount({ plugin: 'repo-sentry', surface: 'terminal', component: 'AbovePrompt', props: PROPS as never })
  expect(await ui.find({ key: 'hide' })).toBeUndefined()
})

test('a git Bash call refreshes the status line and raises the band', async ($, on) => {
  const statuses: (string | undefined)[] = []
  fakeGit(on, 'main', 'config/.env.production\n', statuses)
  on('ui.render', async ($, e) => { const { Text } = $.ui.resolve(e as never) as never as { Text: (p: object) => never }; return h(Text as never, null, 'engine band') as never })
  await $.tool.call({ tool: 'Bash', command: 'git add -A' } as never)
  expect(statuses.at(-1)).toBe('Desert Fire | df-correspondence@main | in sync | 1 dirty, 1 staged | !')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'repo-sentry', surface, component: 'AbovePrompt', props: PROPS as never })
    const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text).join(' / ')
    expect(texts).toContain('changes on main. Branch before committing.')
    expect(texts).toContain('Secret file staged: config/.env.production')
    expect(await ui.find({ key: 'hide' })).toBeDefined()
    expect(texts).toContain('engine band')
  }
})
