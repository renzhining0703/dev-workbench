/**
 * AI 面板「最近打开」总线
 *
 * 需求抽屉打开 → 上报焦点需求；单击待办内容 → 上报焦点待办。
 * 各保留最近一条、互不覆盖，不随抽屉/Tab 切换清空；AiPanel 发送时读取。
 * 模块级单例，避免为面板单独打通 store 链路。
 */
import type { Requirement, TodoItem } from '../types'

let focusRequirement: Requirement | null = null
let focusTodo: TodoItem | null = null
const listeners = new Set<() => void>()

/** 需求抽屉打开时调用（保留最近一条，不清空） */
export function setAiFocusRequirement(r: Requirement | null) {
  if (!r) return
  focusRequirement = r
  listeners.forEach((l) => l())
}

/** 单击待办内容时调用（保留最近一条，不清空） */
export function setAiFocusTodo(t: TodoItem | null) {
  if (!t) return
  focusTodo = t
  listeners.forEach((l) => l())
}

/** 面板发送时读取当前焦点需求 / 待办 */
export function getAiFocusRequirement(): Requirement | null {
  return focusRequirement
}

export function getAiFocusTodo(): TodoItem | null {
  return focusTodo
}

/** 面板订阅焦点变化（实时刷新芯片）；返回退订函数 */
export function subscribeAiFocus(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}
