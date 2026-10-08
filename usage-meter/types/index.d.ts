export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

export type Reading = {
  limits: Limit[]
  contextPercent: number | null
  contextWindow: number
  costUsd: number | null
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    'usage-meter': { reading: Reading | null; hidden: boolean }
  }
}
