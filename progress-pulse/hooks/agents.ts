import type { Agent } from '../types'

// What a model id reads as: claude-opus-5-5 -> Opus 5.5. Anything else is shown as given.
export function modelName(id: string): string {
  const m = /(opus|sonnet|haiku)-(\d+)(?:-(\d+))?/i.exec(id || '')
  if (!m) return id || 'inherit'
  return `${m[1]![0]!.toUpperCase()}${m[1]!.slice(1).toLowerCase()} ${m[2]}${m[3] ? '.' + m[3] : ''}`
}

// The crew tier, read from the model the agent runs on: the bigger the model, the heavier the hat.
export type Tier = { label: string; color: string }
export function tier(model: string, type: string): Tier {
  const m = (model || '').toLowerCase()
  if (/explore|plan|review/i.test(type)) return { label: 'careful', color: '#e0a526' }
  if (m.includes('opus')) return { label: 'heavy', color: '#ff6b35' }
  if (m.includes('haiku')) return { label: 'light', color: '#2ec27e' }
  return { label: 'medium', color: '#5b8def' }
}

export function spawned(list: Agent[], a: { id: string; name: string; type: string; model: string; background: boolean }, now: number): Agent[] {
  if (list.some(x => x.id === a.id)) return list
  return [...list, { ...a, status: 'running' as const, startedAt: now, endedAt: null, steps: 0, stepLabel: 'Starting', tokens: 0, tasksDone: 0, tasksTotal: 0 }].slice(-40)
}

export function stepped(list: Agent[], id: string, label: string): Agent[] {
  return list.map(a => (a.id === id && a.status === 'running' ? { ...a, steps: a.steps + 1, stepLabel: label } : a))
}

export function agentTasks(list: Agent[], id: string, change: { created?: number; completed?: number; total?: number; done?: number }): Agent[] {
  return list.map(a => {
    if (a.id !== id) return a
    const tasksTotal = change.total ?? a.tasksTotal + (change.created ?? 0)
    const tasksDone = Math.min(tasksTotal, change.done ?? a.tasksDone + (change.completed ?? 0))
    return { ...a, tasksTotal, tasksDone }
  })
}

export function finished(list: Agent[], id: string, ok: boolean, tokens: number, now: number): Agent[] {
  return list.map(a => (a.id === id
    ? { ...a, status: (ok ? 'done' : 'failed') as Agent['status'], endedAt: now, tokens: a.tokens + tokens, tasksDone: ok ? a.tasksTotal : a.tasksDone, stepLabel: ok ? 'Done' : 'Stopped' }
    : a))
}

// A tool call as a few words on the agent's card.
export function stepText(tool: string, input: Record<string, unknown>): string {
  if (tool === 'TaskUpdate' && typeof input.activeForm === 'string') return input.activeForm
  if (tool === 'Bash' && typeof input.description === 'string') return input.description
  if ((tool === 'Read' || tool === 'Edit' || tool === 'Write') && typeof input.file_path === 'string') {
    return `${tool} ${String(input.file_path).split('/').pop()}`
  }
  if (tool === 'Grep' || tool === 'Glob') return 'Searching'
  if (tool.startsWith('mcp__')) return tool.split('__').slice(1).join(' ').replace(/_/g, ' ')
  return tool
}

// The batch: agents started within ten minutes of the newest, so yesterday's crew does not crowd today's.
export function currentBatch(list: Agent[]): Agent[] {
  if (!list.length) return []
  const newest = Math.max(...list.map(a => a.startedAt))
  return list.filter(a => newest - a.startedAt < 10 * 60_000 || a.status === 'running')
}

export function fraction(a: Agent): number | null {
  if (a.status !== 'running') return 1
  if (a.tasksTotal > 0) return a.tasksDone / a.tasksTotal
  return null // running with no task list: drawn as an indeterminate shimmer
}

export const compactTokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`)

// ---------- Pixel art (original sprite: a small worker bot whose hat color says its tier) ----------

const SPRITE = [
  '...hhhh...',
  '..hhhhhh..',
  '.hhhhhhhh.',
  '.bbbbbbbb.',
  '.bebbbbeb.',
  '.bbbbbbbb.',
  '.bbmmmmbb.',
  '..bbbbbb..',
  '..b.bb.b..',
]

export function botSvg(hat: string, opts: { cell?: number; bounce?: boolean } = {}): string {
  const c = opts.cell ?? 4
  const w = SPRITE[0]!.length * c, hgt = SPRITE.length * c
  const fill: Record<string, string> = { h: hat, b: '#9fb3c8', e: '#1b2430', m: '#5c6f82' }
  let rects = ''
  SPRITE.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch !== '.') rects += `<rect x="${x * c}" y="${y * c}" width="${c}" height="${c}" fill="${fill[ch]}"/>`
  }))
  const bob = opts.bounce
    ? `<animateTransform attributeName="transform" type="translate" values="0 0;0 -${c / 2};0 0" dur="0.9s" repeatCount="indefinite"/>`
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${hgt + c}" viewBox="0 -${c} ${w} ${hgt + c}" shape-rendering="crispEdges"><g>${rects}${bob}</g></svg>`
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// The band's track: a field of pixel dots that fills left to right, a shimmer running through the
// filled part while work is in flight, and a pill riding the leading edge with what is happening.
export function trackSvg(pct: number, label: string, state: 'running' | 'done', width = 300): string {
  const h = 22, dot = 3, gap = 2, rows = 3
  const cols = Math.floor((width - 8) / (dot + gap))
  const filledCols = Math.round((Math.max(0, Math.min(100, pct)) / 100) * cols)
  const color = state === 'done' ? '#2ec27e' : '#8b7cf6'
  let dots = ''
  for (let x = 0; x < cols; x++) {
    for (let y = 0; y < rows; y++) {
      const on = x < filledCols
      const op = on ? 0.95 : ((x * 7 + y * 3) % 5 === 0 ? 0.35 : 0.15)
      dots += `<rect x="${4 + x * (dot + gap)}" y="${5 + y * (dot + gap)}" width="${dot}" height="${dot}" fill="${on ? color : '#8a8f98'}" opacity="${op}"/>`
    }
  }
  const pillText = esc(label).slice(0, 24)
  const pillW = Math.max(46, pillText.length * 6.6 + 18)
  const edge = 4 + filledCols * (dot + gap)
  const pillX = state === 'done' ? width - pillW - 2 : Math.max(2, Math.min(width - pillW - 2, edge - pillW / 2))
  const shimmer = state === 'running' && filledCols > 2
    ? `<rect x="0" y="0" width="28" height="${h}" fill="url(#sh)"><animate attributeName="x" from="-28" to="${edge}" dur="1.6s" repeatCount="indefinite"/></rect>`
    : ''
  const pulse = state === 'running'
    ? `<animate attributeName="opacity" values="1;0.75;1" dur="1.4s" repeatCount="indefinite"/>`
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}">` +
    `<defs><linearGradient id="sh" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>` +
    `<clipPath id="fill"><rect x="0" y="0" width="${edge}" height="${h}"/></clipPath></defs>` +
    `<rect x="0" y="0" width="${width}" height="${h}" rx="${h / 2}" fill="#8a8f98" opacity="0.12"/>` +
    dots + `<g clip-path="url(#fill)">${shimmer}</g>` +
    `<g><rect x="${pillX}" y="1" width="${pillW}" height="${h - 2}" rx="${(h - 2) / 2}" fill="${color}"/>` +
    `<text x="${pillX + pillW / 2}" y="${h / 2 + 4}" text-anchor="middle" font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif" font-size="11.5" font-weight="600" fill="#fff">${pillText}</text>${pulse}</g></svg>`
}

// A thin per-agent bar: solid when it has a known fraction, a sliding stripe when it does not.
export function miniBarSvg(frac: number | null, color: string, width = 260): string {
  const h = 4
  const base = `<rect x="0" y="0" width="${width}" height="${h}" rx="2" fill="#8a8f98" opacity="0.2"/>`
  if (frac === null) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}">${base}<rect x="0" y="0" width="${width * 0.3}" height="${h}" rx="2" fill="${color}"><animate attributeName="x" from="-${width * 0.3}" to="${width}" dur="1.3s" repeatCount="indefinite"/></rect></svg>`
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}">${base}<rect x="0" y="0" width="${Math.round(width * Math.max(0, Math.min(1, frac)))}" height="${h}" rx="2" fill="${color}"/></svg>`
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}
export const agentClock = clock

// One line per agent of the current crew, for sessions whose screen draws no panes.
export function agentsText(crew: Agent[], now: number): string {
  if (!crew.length) return ''
  const done = crew.filter(a => a.status !== 'running').length
  const lines = [`Agents  ${done} of ${crew.length} finished`]
  for (const a of crew) {
    const mark = a.status === 'running' ? '●' : a.status === 'done' ? '✓' : '✕'
    const t = tier(a.model, a.type)
    const step = a.tasksTotal ? `${a.tasksDone}/${a.tasksTotal} · ${a.stepLabel}` : a.stepLabel
    const took = clock((a.endedAt ?? now) - a.startedAt)
    lines.push(`  ${mark} ${a.name}  (${t.label}, ${modelName(a.model)})  ${a.status === 'running' ? step : a.status === 'done' ? 'finished' : 'failed'}  ·  ${a.tokens ? compactTokens(a.tokens) + ' tokens · ' : ''}${took}`)
  }
  return lines.join('\n')
}
