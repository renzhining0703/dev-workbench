/**
 * 项目名解析：从需求记录的 project 字段（可能是历史遗留的脏数据）中提取规范项目名。
 * 浏览器运行时（筛选匹配）与 Node 种子脚本共用，单一逻辑来源。
 *
 * 规则：
 * 1. 按 , ; ，； 拆分（一条需求可能对应多个项目）
 * 2. 去掉括号说明（如 "icare-zfl-febase (ks)" 中 (ks) 是发布模块，不是项目）
 * 3. 提取英文项目 token：`[a-zA-Z][a-zA-Z0-9]*(?:\s*-\s*[a-zA-Z0-9]+)+`
 *    - 至少含一个连字符（避开 "C端:" 的 C），连字符两侧允许空格（"icare- yecai" / "icare- magi - git"）
 *    - 中文自然截断 token（"后台: icare-forms C端: ..." 只取 icare-forms）
 * 4. 去内部空格统一格式（"icare- company" → "icare-company"），去重
 */
export function extractProjectNames(project: string | undefined | null): string[] {
  if (!project) return []
  const out = new Set<string>()
  const segments = project.split(/[;,，；]/)
  for (let seg of segments) {
    seg = seg.replace(/[（(][^（）()]*[）)]/g, ' ')
    const matches = seg.matchAll(/[a-zA-Z][a-zA-Z0-9]*(?:\s*-\s*[a-zA-Z0-9]+)+/g)
    for (const m of matches) {
      const name = m[0].replace(/\s+/g, '').toLowerCase()
      if (name) out.add(name)
    }
  }
  return [...out]
}
