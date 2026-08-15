/**
 * 从需求数据中提取项目名，生成种子项目库 src/data/seedProjects.ts。
 * 提取规则见 src/lib/projects.ts（浏览器与脚本共用，保证逻辑唯一）。
 *
 * 用法：node --experimental-strip-types scripts/extract-projects.ts <import-data.json> [out.ts]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { extractProjectNames } from '../src/lib/projects.ts'

const inputPath = process.argv[2] ?? './public/import-data.json'
const outPath = process.argv[3] ?? './src/data/seedProjects.ts'

interface RawRequirement {
  project?: string
}

const data = JSON.parse(readFileSync(inputPath, 'utf-8')) as RawRequirement[]

const all = new Set<string>()
for (const r of data) {
  for (const name of extractProjectNames(r.project)) all.add(name)
}

const names = [...all].sort((a, b) => a.localeCompare(b))

const ts = `// 由 scripts/extract-projects.ts 生成，请勿手改（如需更新重新运行脚本）
// 首次启动时写入项目库，之后由「项目管理」维护
export const seedProjects: { name: string }[] = [
${names.map((n) => `  { name: '${n}' },`).join('\n')}
]
`

writeFileSync(outPath, ts, 'utf-8')
console.log(`提取到 ${names.length} 个项目 → ${outPath}`)
console.log(names.join(', '))
