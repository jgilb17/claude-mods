import type { Limit, Reading } from '../types'

export const LABEL: Record<string, string> = { five_hour: '5-hour', seven_day: 'Week', spend_limit: 'Spend' }
export const label = (kind: string) => LABEL[kind] ?? kind.replace(/_/g, ' ')

// Calm green while there is room, gold past half, orange from 80, red from 95.
export function tone(pct: number): string {
  if (pct >= 95) return '#ff4d4f'
  if (pct >= 80) return '#ff6b35'
  if (pct >= 50) return '#ffc14d'
  return '#2ed573'
}

export function meter(pct: number, width: number): { filled: string; empty: string } {
  const w = Math.max(3, width)
  const n = Math.max(0, Math.min(w, Math.round((Math.min(100, Math.max(0, pct)) / 100) * w)))
  return { filled: '█'.repeat(n), empty: '░'.repeat(w - n) }
}

// "resets 2:40 PM" when it is today, "resets Mon 9 AM" within a week, otherwise the date.
export function resetText(iso: string | undefined, now: number, timeZone?: string): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  if (t <= now) return 'resetting now'
  const opts = timeZone ? { timeZone } : {}
  const day = (ms: number) => new Intl.DateTimeFormat('en-US', { ...opts, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms)
  const time = new Intl.DateTimeFormat('en-US', { ...opts, hour: 'numeric', minute: '2-digit' }).format(t).replace(':00', '')
  if (day(t) === day(now)) return `resets ${time}`
  if (t - now < 6.5 * 864e5) return `resets ${new Intl.DateTimeFormat('en-US', { ...opts, weekday: 'short' }).format(t)} ${time}`
  return `resets ${new Intl.DateTimeFormat('en-US', { ...opts, month: 'short', day: 'numeric' }).format(t)}`
}

// The order people read them in: the short window first, the week second, anything else after.
export function ordered(limits: Limit[]): Limit[] {
  const rank = (k: string) => (k === 'five_hour' ? 0 : k === 'seven_day' ? 1 : 2)
  return [...limits].sort((a, b) => rank(a.kind) - rank(b.kind))
}

// The thresholds worth a toast, each crossed once per climb.
export function crossed(before: number | undefined, after: number): number | null {
  for (const m of [95, 90, 80]) if ((before ?? 0) < m && after >= m) return m
  return null
}

export const money = (usd: number) => (usd < 10 ? `$${usd.toFixed(2)}` : `$${Math.round(usd)}`)
export const k = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M` : `${Math.round(n / 1000)}k`)

// The reading as plain text, for /usage-meter and for screens that draw no bands.
export function textReading(r: Reading | null, now: number): string {
  if (!r) return 'No usage reading yet. It arrives with the first reply in this session.'
  const out: string[] = []
  for (const l of ordered(r.limits)) {
    const m = meter(l.percentUsed, 20)
    out.push(`${label(l.kind).padEnd(7)} ${m.filled}${m.empty}  ${l.percentUsed}%  ${resetText(l.resetsAt, now)}`.trimEnd())
  }
  if (!r.limits.length) out.push('Plan limits: no reading from Claude Code yet in this session.')
  if (r.contextPercent !== null) out.push(`Context ${r.contextPercent}% of ${k(r.contextWindow)}`)
  if (r.costUsd !== null) out.push(`${money(r.costUsd)} this session at API rates`)
  return out.join('\n')
}
