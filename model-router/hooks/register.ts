import type { Register } from 'claude-code'
import { lane, LANE_MODEL, POLICY } from './route'

type Decision = { at: number; task: string; type: string; model: string; source: 'claude' | 'router' | 'definition'; why: string }
const LOG = 'decisions', OFF = 'off'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'model-router', description: 'Show which model each subagent got and why (on, off)' })
    return r
  })

  // Tell the main loop the policy, so it chooses explicitly. Only loops that can spawn agents get it.
  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    if (!e.tools.includes('Agent')) return r
    try { if (await $.store.get(OFF)) return r } catch { /* store unavailable: keep routing on */ }
    return { sections: [...r.sections, { id: 'model-router:policy', text: POLICY, scope: 'session' as const }] }
  }).catch(($, e, next) => next(e))

  on('agent.spawn', async ($, e, next) => {
    let off = false
    try { off = Boolean(await $.store.get(OFF)) } catch { /* keep routing on */ }
    let input = e, source: Decision['source'] = 'claude', why = 'chosen by Claude'
    if (e.model) {
      // Claude chose: respect it.
    } else if (e.subagentType !== 'general-purpose') {
      // A named agent type carries its own model setting, or deliberately inherits. Leave it alone.
      source = 'definition'; why = `${e.subagentType} uses its own model setting`
    } else if (!off) {
      const pick = lane(e.description, e.prompt)
      input = { ...e, model: LANE_MODEL[pick.lane] }
      source = 'router'; why = pick.why
    }
    const r = await next(input)
    if (r.deny === undefined) {
      try {
        const log = ((await $.store.get(LOG)) ?? []) as Decision[]
        log.push({ at: await $.clock.now(), task: e.description.slice(0, 80), type: e.subagentType, model: r.model, source, why })
        await $.store.set(LOG, log.slice(-25))
      } catch { /* the log is a nicety */ }
    }
    return r
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'model-router' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'off' || arg === 'on') {
      await $.store.set(OFF, arg === 'off')
      return { text: arg === 'off' ? 'Model routing off: subagents without a model inherit the session model again.' : 'Model routing on.' }
    }
    const off = Boolean(await $.store.get(OFF))
    const log = ((await $.store.get(LOG)) ?? []) as Decision[]
    const lines = [`Model routing is ${off ? 'OFF' : 'on'}. Last ${Math.min(10, log.length)} of ${log.length} subagents logged:`]
    for (const d of log.slice(-10).reverse()) lines.push(`  ${d.model.padEnd(18)} ${d.task}  (${d.source}: ${d.why})`)
    if (!log.length) lines.push('  none yet')
    return { text: lines.join('\n') }
  })
}
