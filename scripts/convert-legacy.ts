/**
 * 旧版需求记录 → 系统导入数据（public/import-data.json）
 * 运行：node --experimental-strip-types scripts/convert-legacy.ts <旧JSON路径>
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseImportData } from '../src/lib/migrate.ts'

const input = resolve(process.argv[2] ?? '')
if (!input.endsWith('.json')) {
  console.error('用法: node --experimental-strip-types scripts/convert-legacy.ts <旧JSON路径>')
  process.exit(1)
}

const raw = JSON.parse(readFileSync(input, 'utf-8'))
const items = parseImportData(raw)

const outDir = resolve('public')
mkdirSync(outDir, { recursive: true })
const output = resolve('public/import-data.json')
writeFileSync(output, JSON.stringify(items, null, 2))

console.log(`✅ 转换完成: ${items.length} 条需求 -> ${output}`)
if (items.length === 0) {
  console.warn('⚠️  未能识别输入格式，请确认文件为旧版需求记录导出。')
}
