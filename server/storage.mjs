/**
 * JSON 文件存储：loadSnapshot / saveSnapshot + atomicWriteJson
 *
 * - 写时先写 .tmp 再 rename（POSIX rename 原子），避免并发写坏文件
 * - single-process Node 足够；多 worker 需切 SQLite
 */
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

export function emptySnapshot() {
  return {
    version: 1,
    serverTs: new Date(0).toISOString(),
    requirements: [],
    todos: [],
    projects: [],
    settings: { autoArchiveMonths: 3 },
  }
}

export async function loadSnapshot(file) {
  try {
    const raw = await readFile(file, 'utf8')
    const parsed = JSON.parse(raw)
    // 缺字段时补默认值（向前兼容老版本文件）
    return {
      ...emptySnapshot(),
      ...parsed,
      settings: { ...emptySnapshot().settings, ...(parsed.settings ?? {}) },
    }
  } catch (e) {
    if (e.code === 'ENOENT') return emptySnapshot()
    throw e
  }
}

/**
 * 原子写 JSON：写 .tmp + rename(2)
 * users.json 和 per-user snapshot 共用此函数
 */
export async function atomicWriteJson(file, data) {
  await mkdir(dirname(file), { recursive: true })
  const tmp = file + '.tmp'
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
  await rename(tmp, file)
}

export async function saveSnapshot(file, data) {
  await atomicWriteJson(file, data)
}