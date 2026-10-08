import type { Task, TaskStatus } from '../types'

// Orange to gold to green as the bar fills. At 100% the whole bar turns green.
const STOPS: [number, number, number][] = [[0xff, 0x6b, 0x35], [0xff, 0xc1, 0x4d], [0x2e, 0xd5, 0x73]]
const hex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')

export function gradient(t: number): string {
  const x = Math.min(1, Math.max(0, t)) * (STOPS.length - 1)
  const i = Math.min(STOPS.length - 2, Math.floor(x))
  const f = x - i
  const a = STOPS[i]!, b = STOPS[i + 1]!
  return hex(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f)
}

export type Counts = { total: number; done: number; active: number; pending: number; pct: number }

export function counts(tasks: Task[]): Counts {
  const total = tasks.length
  const done = tasks.filter(t => t.status === 'completed').length
  const active = tasks.filter(t => t.status === 'in_progress').length
  return { total, done, active, pending: total - done - active, pct: total ? Math.round((done / total) * 100) : 0 }
}

// One cell per entry: filled cells carry their gradient color; an in-progress task shows as a
// half-lit cell after the filled run so the bar visibly moves as work starts, not only as it ends.
export type Cell = { ch: string; color: string | null }

export function bar(c: Counts, width: number): Cell[] {
  const w = Math.max(4, width)
  const filled = c.total ? Math.round((c.done / c.total) * w) : 0
  const activeCells = c.total && c.active ? Math.max(1, Math.round((c.active / c.total) * w)) : 0
  const cells: Cell[] = []
  for (let i = 0; i < w; i++) {
    if (i < filled) cells.push({ ch: '█', color: c.done === c.total ? '#2ed573' : gradient(i / Math.max(1, w - 1)) })
    else if (i < filled + activeCells) cells.push({ ch: '▓', color: gradient(i / Math.max(1, w - 1)) })
    else cells.push({ ch: '░', color: null })
  }
  return cells
}

// Collapse runs of the same color so a 40-cell bar is a handful of Text elements, not 40.
export function runs(cells: Cell[]): { text: string; color: string | null }[] {
  const out: { text: string; color: string | null }[] = []
  for (const cell of cells) {
    const last = out[out.length - 1]
    if (last && last.color === cell.color) last.text += cell.ch
    else out.push({ text: cell.ch, color: cell.color })
  }
  return out
}

export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

// Estimate of time left: the average of the measured durations of tasks finished this session,
// times what is left. Labelled an estimate wherever it is shown; null until two tasks have
// finished with a measured duration, because one sample is not an average.
export function eta(tasks: Task[]): number | null {
  const measured = tasks
    .filter(t => t.status === 'completed' && t.doneAt !== null && (t.startedAt ?? t.createdAt) !== null)
    .map(t => (t.doneAt as number) - (t.startedAt ?? t.createdAt))
    .filter(ms => ms > 0)
  if (measured.length < 2) return null
  const avg = measured.reduce((a, b) => a + b, 0) / measured.length
  const left = tasks.filter(t => t.status !== 'completed').length
  return left ? avg * left : 0
}

// The quarter marks a run of completions crossed, so each gets one cheer and only one.
export function milestonesCrossed(before: number, after: number): number[] {
  return [25, 50, 75, 100].filter(m => before < m && after >= m)
}

export function upsert(tasks: Task[], id: string, patch: Partial<Task> & { subject?: string }, now: number): Task[] {
  const i = tasks.findIndex(t => t.id === id)
  if (i === -1) {
    return [...tasks, {
      id, subject: patch.subject ?? `Task ${id}`, activeForm: patch.activeForm ?? null,
      status: (patch.status as TaskStatus) ?? 'pending', createdAt: now,
      startedAt: patch.status === 'in_progress' ? now : null, doneAt: patch.status === 'completed' ? now : null,
    }]
  }
  const prev = tasks[i]!
  const next: Task = { ...prev, ...patch }
  if (patch.status === 'in_progress' && prev.status !== 'in_progress') next.startedAt = now
  if (patch.status === 'completed' && prev.status !== 'completed') next.doneAt = now
  if (patch.status && patch.status !== 'completed') next.doneAt = null
  return tasks.map((t, j) => (j === i ? next : t))
}

// TodoWrite hands over the whole list every time. Match by content so a task keeps its timings
// across rewrites; anything not in the new list is gone.
export function fromTodos(prev: Task[], todos: { content: string; status: TaskStatus; activeForm?: string }[], now: number): Task[] {
  return todos.map((todo, i) => {
    const old = prev.find(t => t.subject === todo.content)
    const base: Task = old ?? { id: `todo-${i}-${todo.content.slice(0, 24)}`, subject: todo.content, activeForm: todo.activeForm ?? null, status: 'pending', createdAt: now, startedAt: null, doneAt: null }
    return upsert([base], base.id, { status: todo.status, activeForm: todo.activeForm ?? base.activeForm }, now)[0]!
  })
}

export const today = (now: number) => new Date(now).toISOString().slice(0, 10)
