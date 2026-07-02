import { join } from 'node:path'

const root = process.cwd()
export const latchDir = join(root, '.latch')
export const tasksDir = join(latchDir, 'tasks')
export const archiveDir = join(latchDir, 'archive')
export const knowledgeDir = join(latchDir, 'knowledge')
export const knowledgeTasksDir = join(knowledgeDir, 'tasks')
export const knowledgeModulesDir = join(knowledgeDir, 'modules')
export const statePath = join(latchDir, 'state.json')
export const lockDir = join(latchDir, '.lock')
export const repoRoot = root
