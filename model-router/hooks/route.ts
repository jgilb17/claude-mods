// The routing policy, kept pure so it is tested without an engine.
// Three lanes. When a task matches both a heavy and a light word, heavy wins: when in doubt, go up.
export type Lane = 'light' | 'build' | 'heavy'
export const LANE_MODEL: Record<Lane, string> = { light: 'haiku', build: 'sonnet', heavy: 'opus' }

// Judgment work, and anything touching money, compliance, legal or patient data.
const HEAVY = /\b(review|audit|architect\w*|design|plan|planning|security|secur\w*|debug\w*|root[- ]cause|investigat\w*|diagnos\w*|refactor\w*|migrat\w*|schema|reconcil\w*|financ\w*|revenue|pricing|payroll|tax\w*|invoice\w*|payment\w*|compliance|legal|contract\w*|regulat\w*|patient\w*|hipaa|statement\w*|decide|decision|tradeoff|trade-off|strategy|verify|verification|prove)\b/i
// Read-only lookups and mechanical summaries.
const LIGHT = /\b(find|search|list|count|grep|locate|look ?up|scan|map|inventory|collect|gather|fetch|read|summari[sz]e|survey|check (if|whether|that)|which files|where is|print|show)\b/i
const READ_ONLY = /\bread[- ]only\b|\bdo not (edit|modify|change|write)\b|\bdon'?t (edit|modify|change|write)\b|\bno (edits|changes)\b/i

export function lane(description: string, prompt: string): { lane: Lane; why: string } {
  const head = prompt.slice(0, 600)
  const heavy = description.match(HEAVY) ?? head.match(HEAVY)
  if (heavy) return { lane: 'heavy', why: `"${heavy[0]}" is judgment work` }
  const light = description.match(LIGHT)
  if (light && (READ_ONLY.test(head) || !/\b(write|edit|fix|build|implement|create|add|change|update|delete|remove)\b/i.test(description))) {
    return { lane: 'light', why: `"${light[0]}" is a lookup` }
  }
  return { lane: 'build', why: 'default for building and editing' }
}

// The general rule the main model follows when it chooses for itself. Its explicit choice always wins.
export const POLICY = [
  'Model routing for subagents (set by the model-router mod): pick the model on every Agent call yourself, by the work, not by habit.',
  '- haiku: read-only lookups, searches, counts, listing files, mechanical summaries.',
  '- sonnet: writing and editing code, tests, docs, routine data work.',
  '- opus: reviews, debugging, architecture and planning, migrations, and anything touching money, compliance, legal or patient data. When unsure, go one tier up.',
  'If you leave model unset on a general-purpose agent, the mod picks by these rules instead of letting it inherit the most expensive model.',
].join('\n')
