export type RepoInfo = {
  business: string
  repo: string
  branch: string
  dirty: number
  staged: number
  behind: number | null
  ahead: number | null
  warnings: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'repo-sentry': { info: RepoInfo | null; hiddenFor: string }
  }
}
