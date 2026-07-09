import type { Task } from './types.js'

export function actorId() {
  if (process.env.LATCH_ACTOR) return process.env.LATCH_ACTOR
  if (process.env.CODEX_THREAD_ID)
    return `codex:default:${process.env.CODEX_THREAD_ID}`
  if (Object.keys(process.env).some((key) => key.startsWith('CLAUDE_CODE_')))
    return 'claude:default'
  if (Object.keys(process.env).some((key) => key.startsWith('OPENCODE_')))
    return 'opencode:default'
  return 'unknown:default'
}

export function taskOwnedByAnotherActor(task: Task) {
  return Boolean(task.owner && task.owner !== actorId())
}

// 接手任务：无主则认领；自己已拥有则返回 false；他人持有时仅 force 才夺过，否则抛错。
// force 由调用方传入，避免本模块依赖 CLI 的 args 闭包。
export function claimTask(task: Task, force: boolean): boolean {
  if (!task.owner) {
    task.owner = actorId()
    return true
  }
  if (task.owner === actorId()) return false
  if (force) {
    task.owner = actorId()
    return true
  }
  throw new Error(
    `Task ${task.id} is owned by ${task.owner}. Re-run with --force to take ownership.`,
  )
}

export function ensureTaskOwnedByActor(task: Task) {
  if (taskOwnedByAnotherActor(task))
    throw new Error(
      `Task ${task.id} is owned by ${task.owner}. Re-run with --force to take ownership.`,
    )
}
