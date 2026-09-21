/**
 * 键盘快捷键清单（单一来源）
 *
 * 消费方：快捷键弹窗（ShortcutsModal，? 键与命令面板唤起）与
 * 设置中心 · 快捷键面板 —— 两处展示同一份数据，避免文案漂移。
 */

export interface ShortcutItem {
  keys: string[]
  desc: string
}

export const SHORTCUTS: ShortcutItem[] = [
  { keys: ['⌘K'], desc: '全局搜索 / 命令面板' },
  { keys: ['N'], desc: '新建需求' },
  { keys: ['/'], desc: '聚焦搜索框（需求列表页）' },
  { keys: ['Esc'], desc: '关闭弹窗 / 抽屉' },
  { keys: ['?'], desc: '打开快捷键面板' },
]

export const SHORTCUTS_FOOTNOTE = '在输入框中编辑时快捷键自动禁用。'
