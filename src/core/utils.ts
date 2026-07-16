import {
  closeSync,
  fsyncSync,
  openSync,
  renameSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, dirname, join } from 'node:path'

export function now() {
  return new Date().toISOString()
}

export function readJsonFile<T>(path: string): T {
  try {
    return JSON.parse(requireRead(path)) as T
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Cannot read JSON ${path}: ${message}`)
  }
}

function requireRead(path: string) {
  return readFileSync(path, 'utf8')
}

// 同目录临时文件写完并 fsync 后再 rename，保证读者只会看到旧文件或完整新文件。
export function writeTextAtomic(path: string, content: string) {
  const temporaryPath = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`,
  )
  let fileDescriptor: number | undefined
  try {
    fileDescriptor = openSync(temporaryPath, 'wx', 0o600)
    writeFileSync(fileDescriptor, content)
    fsyncSync(fileDescriptor)
    const descriptor = fileDescriptor
    fileDescriptor = undefined
    closeSync(descriptor)
    renameSync(temporaryPath, path)
    const directoryDescriptor = openSync(dirname(path), 'r')
    try { fsyncSync(directoryDescriptor) } finally { closeSync(directoryDescriptor) }
  } catch (error) {
    if (fileDescriptor !== undefined) closeSync(fileDescriptor)
    rmSync(temporaryPath, { force: true })
    throw error
  }
}

export function writeJsonAtomic(path: string, value: unknown) {
  writeTextAtomic(path, `${JSON.stringify(value, null, 2)}\n`)
}

export function slug(title: string) {
  return title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'task'
}
