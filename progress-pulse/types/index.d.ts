export type TaskStatus = 'pending' | 'in_progress' | 'completed'

export type Task = {
  id: string
  subject: string
  activeForm: string | null
  status: TaskStatus
  createdAt: number
  startedAt: number | null
  doneAt: number | null
}

export type Celebration = { text: string; big: boolean; until: number }

declare module 'claude-code' {
  interface PluginState {
    'progress-pulse': {
      tasks: Task[]
      sessionStart: number
      celebration: Celebration | null
      project: string
      bandHidden: boolean
    }
  }
}
