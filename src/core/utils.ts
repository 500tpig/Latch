import { existsSync, readFileSync, writeFileSync } from 'node:fs'

export function now() {
  return new Date().toISOString()
}

export function readJson<T>(path: string, fallback: T): T {
  return existsSync(path)
    ? (JSON.parse(readFileSync(path, 'utf8')) as T)
    : fallback
}

export function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

export function die(message: string): never {
  console.error(message)
  process.exit(1)
}

export function slug(title: string) {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'task'
  )
}

export function commandEnv(cwd: string) {
  return { ...process.env, PWD: cwd }
}
