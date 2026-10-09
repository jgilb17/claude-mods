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

export type AgentStatus = 'running' | 'done' | 'failed'

export type Agent = {
  id: string
  name: string
  type: string
  model: string
  background: boolean
  status: AgentStatus
  startedAt: number
  endedAt: number | null
  steps: number
  stepLabel: string
  tokens: number
  tasksDone: number
  tasksTotal: number
}

declare module 'claude-code' {
  interface PluginState {
    'progress-pulse': {
      tasks: Task[]
      sessionStart: number
      celebration: Celebration | null
      project: string
      bandHidden: boolean
      agents: Agent[]
      paneOpened: boolean
    }
  }
}
