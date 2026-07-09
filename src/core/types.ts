export type Stage =
  | 'triage'
  | 'brainstorm'
  | 'grill'
  | 'plan'
  | 'dev'
  | 'check'
  | 'finish'
  | 'done'
  | 'blocked'
  | 'abandoned'

export type Verify = {
  command: string
  status: 'pass' | 'fail'
  exit_code: number
  created_at: string
  kind?: 'gate' | 'diagnostic'
}

export type Artifact = { kind: string; path: string }

export type Task = {
  id: string
  title: string
  status: 'active' | 'done' | 'blocked' | 'abandoned'
  stage: Stage
  owner?: string
  goal?: string
  scope?: string
  acceptance?: string
  next?: string
  knowledge_decision?: 'generate' | 'skip'
  knowledge_reason?: string
  knowledge_decided_at?: string
  // task 指向 .latch/ 外部产物的统一指针；吃掉了旧的 knowledge_card_path，
  // 改由 kind="knowledge_card" 的一项表达。kind 开放字符串，推荐值见 docs/ARTIFACTS.md。
  artifacts?: Artifact[]
  // finish closure 的结构化真源：最后一次 latch finish 覆盖整个对象。
  // notes.md 的 Finish closure scaffold 是人读副本，AI 默认只读这里。
  closure?: {
    changes: string
    verified: string
    unverified: string
    followup: string
    updated_at: string
  }
  latest_verify?: Verify
  latest_gate_verify?: Verify
  latest_diagnostic_verify?: Verify
  created_at: string
  updated_at: string
}

export type State = {
  current_task_id?: string
  active_task_id?: string
  actors?: Record<string, { current_task_id?: string }>
}

export type Citation = {
  path: string
  symbol: string
  line?: number
  source_task: string
  unverified?: boolean
}

export type KnowledgeCardMeta = {
  title: string
  source_task: string
  source_task_path: string
  source_notes_path: string
  modules: string[]
  keywords: string[]
  citations: Citation[]
  created_at: string
  draft: boolean
}

export type KnowledgeCard = {
  meta: KnowledgeCardMeta
  body: string
  path: string
}

export type ModuleCardMeta = {
  module: string
  task_cards: string[]
  source_tasks: string[]
  updated_at: string
}
