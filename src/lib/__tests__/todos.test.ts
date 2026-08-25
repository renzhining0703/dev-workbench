/**
 * src/lib/todos.ts 纯函数单测 —— 固化待办排序 / 优先级 / 简报计算行为
 */
import { describe, it, expect } from 'vitest'
import {
  sortTodos,
  priorityOf,
  nextPriority,
  buildTodoSummary,
  collectTodoReqIds,
  PRIORITY_META,
} from '../todos'
import { toDateStr } from '../utils'
import type { TodoItem } from '../../types'

const today = toDateStr(new Date())
const yesterday = toDateStr(new Date(Date.now() - 86_400_000))

function makeTodo(p: Partial<TodoItem> & { id: string }): TodoItem {
  return {
    content: p.content ?? 't',
    date: p.date ?? today,
    done: p.done ?? false,
    createdAt: p.createdAt ?? '2026-01-01T00:00:00.000Z',
    ...p,
  }
}

describe('sortTodos', () => {
  it('未完成排在已完成之前', () => {
    const list = [
      makeTodo({ id: 'a', done: true }),
      makeTodo({ id: 'b', done: false }),
    ]
    expect(sortTodos(list).map((x) => x.id)).toEqual(['b', 'a'])
  })

  it('未完成组内：高 > 普通 > 低', () => {
    const list = [
      makeTodo({ id: 'low', priority: 'low' }),
      makeTodo({ id: 'high', priority: 'high' }),
      makeTodo({ id: 'normal', priority: 'normal' }),
    ]
    expect(sortTodos(list).map((x) => x.id)).toEqual(['high', 'normal', 'low'])
  })

  it('同优先级：createdAt 倒序（新在前）', () => {
    const list = [
      makeTodo({ id: 'old', createdAt: '2026-01-01T00:00:00.000Z' }),
      makeTodo({ id: 'new', createdAt: '2026-02-01T00:00:00.000Z' }),
    ]
    expect(sortTodos(list).map((x) => x.id)).toEqual(['new', 'old'])
  })

  it('已完成组沉底，按 createdAt 倒序', () => {
    const list = [
      makeTodo({ id: 'd1', done: true, createdAt: '2026-01-01T00:00:00.000Z' }),
      makeTodo({ id: 'd2', done: true, createdAt: '2026-02-01T00:00:00.000Z' }),
      makeTodo({ id: 'live', done: false }),
    ]
    expect(sortTodos(list).map((x) => x.id)).toEqual(['live', 'd2', 'd1'])
  })

  it('不修改原数组', () => {
    const list = [
      makeTodo({ id: 'a', done: true }),
      makeTodo({ id: 'b', done: false }),
    ]
    sortTodos(list)
    expect(list.map((x) => x.id)).toEqual(['a', 'b'])
  })

  it('未指定优先级视为普通', () => {
    expect(priorityOf(makeTodo({ id: 'x' }))).toBe('normal')
    expect(priorityOf(makeTodo({ id: 'y', priority: 'high' }))).toBe('high')
    expect(priorityOf(makeTodo({ id: 'z', priority: 'low' }))).toBe('low')
  })

  it('nextPriority 三态循环 low→normal→high→low', () => {
    expect(nextPriority('low')).toBe('normal')
    expect(nextPriority('normal')).toBe('high')
    expect(nextPriority('high')).toBe('low')
  })

  it('PRIORITY_META rank：high<normal<low', () => {
    expect(PRIORITY_META.high.rank).toBeLessThan(PRIORITY_META.normal.rank)
    expect(PRIORITY_META.normal.rank).toBeLessThan(PRIORITY_META.low.rank)
  })
})

describe('buildTodoSummary', () => {
  it('统计今日未完成数 / 高优先级数 / 昨日遗留数', () => {
    const todos = [
      makeTodo({ id: 't1', date: today, priority: 'high' }),
      makeTodo({ id: 't2', date: today, priority: 'normal' }),
      makeTodo({ id: 't3', date: today, priority: 'low' }),
      makeTodo({ id: 'ovd', date: yesterday, priority: 'high' }),
      makeTodo({ id: 'done', date: today, done: true, priority: 'high' }),
    ]
    expect(buildTodoSummary(todos)).toEqual({ undone: 3, high: 1, overdue: 1 })
  })

  it('忽略已完成项（既不计未完成也不计遗留）', () => {
    const todos = [
      makeTodo({ id: 'd1', date: today, done: true }),
      makeTodo({ id: 'd2', date: yesterday, done: true }),
    ]
    expect(buildTodoSummary(todos)).toEqual({ undone: 0, high: 0, overdue: 0 })
  })

  it('空列表归零', () => {
    expect(buildTodoSummary([])).toEqual({ undone: 0, high: 0, overdue: 0 })
  })
})

describe('collectTodoReqIds', () => {
  it('昨日生成、未完成的待办计入（回归：跨天不重复显示 +待办）', () => {
    const todos = [
      makeTodo({ id: 'ovd', date: yesterday, requirementId: 'r1' }),
      makeTodo({ id: 'today', date: today, requirementId: 'r2' }),
    ]
    expect(collectTodoReqIds(todos)).toEqual(new Set(['r1', 'r2']))
  })

  it('今日生成、已完成的待办仍计入（完成后不应变回 +待办）', () => {
    const todos = [makeTodo({ id: 'done-today', date: today, done: true, requirementId: 'r1' })]
    expect(collectTodoReqIds(todos)).toEqual(new Set(['r1']))
  })

  it('历史已完成（完成于今天之前）的待办也计入——已完成的需求不需要再生成待办', () => {
    const todos = [
      makeTodo({ id: 'd1', date: yesterday, done: true, completedAt: '2020-01-01T00:00:00.000Z', requirementId: 'r1' }),
      makeTodo({ id: 'd2', date: yesterday, done: true, requirementId: 'r2' }),
    ]
    expect(collectTodoReqIds(todos)).toEqual(new Set(['r1', 'r2']))
  })

  it('未来预排的待办也计入（同一需求不重复生成）', () => {
    const todos = [makeTodo({ id: 'future', date: '2099-01-01', requirementId: 'r1' })]
    expect(collectTodoReqIds(todos)).toEqual(new Set(['r1']))
  })

  it('无 requirementId 的普通待办不影响集合', () => {
    const todos = [
      makeTodo({ id: 'plain' }),
      makeTodo({ id: 'linked', date: yesterday, requirementId: 'r1' }),
    ]
    expect(collectTodoReqIds(todos)).toEqual(new Set(['r1']))
  })
})
