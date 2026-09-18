import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

const dataDir = path.join(process.cwd(), 'data')
const locks = new Map<string, Promise<void>>()

export async function readLocalJson<T>(filename: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(path.join(dataDir, filename), 'utf8')) as T }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback
    throw new Error(`Local data store ${filename} is unreadable or malformed`, { cause: error })
  }
}

export async function writeLocalJson<T>(filename: string, value: T) {
  await mkdir(dataDir, { recursive: true })
  const target = path.join(dataDir, filename)
  const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 })
  await rename(temporary, target)
}

export async function updateLocalJson<T>(filename: string, fallback: T, update: (current: T) => T | Promise<T>): Promise<T> {
  const previous = locks.get(filename) || Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => { release = resolve })
  locks.set(filename, previous.then(() => current))
  await previous
  try {
    const next = await update(await readLocalJson(filename, fallback))
    await writeLocalJson(filename, next)
    return next
  } finally {
    release()
    if (locks.get(filename) === current) locks.delete(filename)
  }
}
