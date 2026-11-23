/**
 * AI 面板（小朵）—— 工作台内嵌对话入口
 *
 * - 自动携带最近需求、待办与打开面板时的页面选区
 * - 聊天通过后台任务 + 短轮询完成，关闭面板不会中断回复
 * - 消息支持常用 Markdown 排版，历史项 memo 避免输入时重复渲染
 */
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Requirement, TodoItem } from '../types'
import { useAuth } from '../store/AuthContext'
import {
  cancelAiChat,
  createAiContext,
  sendAiChat,
  snapshotFromRequirement,
  snapshotFromTodo,
  AiPanelError,
  type AiContextSnapshot,
} from '../lib/aiClient'
import { getAiFocusRequirement, getAiFocusTodo, subscribeAiFocus } from '../lib/aiFocus'

/** 页面选中内容上限（与服务端裁剪一致） */
const SELECTION_MAX = 4000
/** 面板消息本地保留条数（超出后只留最近 N 条） */
const MESSAGE_LIMIT = 20
/** 按用户名隔离的面板消息存储键 */
const aiMessagesKey = (username: string) => `dev-workbench:ai-panel-messages:${username}`

/** 服务端执行阶段 → 面板状态文案 */
const PHASE_LABELS: Record<string, string> = {
  waiting: '正在等待模型回复',
  tooling: '正在查看数据/文件',
  composing: '正在生成回复',
}

/** 等待时长格式化：60 秒内显示 Ns，超过显示 Nm Ns */
function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest ? `${minutes}m${rest}s` : `${minutes}m`
}

interface ChatMsg {
  id: number
  role: 'user' | 'assistant'
  text: string
  ctxLabel?: string
  error?: boolean
  retryText?: string
}

/** 抓取当前页面文字选区（面板打开瞬间快照） */
function captureSelection(): string {
  const sel = window.getSelection()
  const text = (sel?.toString() ?? '').trim()
  return text.slice(0, SELECTION_MAX)
}

/** 选中内容芯片摘要（首行 + 省略） */
function selectionLabel(text: string): string {
  const first = text.split('\n')[0]
  return first.length > 24 ? `${first.slice(0, 24)}…` : first
}

/** 渲染行内代码与加粗，不使用 HTML 注入 */
function renderInline(text: string): ReactNode[] {
  return text
    .split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g)
    .filter(Boolean)
    .map((part, index) => {
      if (part.startsWith('`') && part.endsWith('`')) {
        return (
          <code key={index} className="rounded bg-black/10 px-1 py-0.5 font-mono text-[0.92em]">
            {part.slice(1, -1)}
          </code>
        )
      }
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={index} className="font-semibold">{part.slice(2, -2)}</strong>
      }
      return <span key={index}>{part}</span>
    })
}

/** 将回复按段落、列表和代码块安全渲染为 React 节点 */
function MessageBody({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) {
      index += 1
      continue
    }

    if (/^```/.test(line)) {
      const code: string[] = []
      index += 1
      while (index < lines.length && !/^```/.test(lines[index])) {
        code.push(lines[index])
        index += 1
      }
      if (index < lines.length) index += 1
      blocks.push(
        <pre
          key={blocks.length}
          className="max-w-full overflow-x-auto rounded-lg border border-black/10 bg-black/10 p-3 font-mono text-xs leading-5"
        >
          <code>{code.join('\n')}</code>
        </pre>,
      )
      continue
    }

    const unordered = line.match(/^\s*[-*]\s+(.+)/)
    if (unordered) {
      const items: string[] = []
      while (index < lines.length) {
        const match = lines[index].match(/^\s*[-*]\s+(.+)/)
        if (!match) break
        items.push(match[1])
        index += 1
      }
      blocks.push(
        <ul key={blocks.length} className="list-disc space-y-1 pl-5">
          {items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item)}</li>)}
        </ul>,
      )
      continue
    }

    const ordered = line.match(/^\s*\d+[.)]\s+(.+)/)
    if (ordered) {
      const items: string[] = []
      while (index < lines.length) {
        const match = lines[index].match(/^\s*\d+[.)]\s+(.+)/)
        if (!match) break
        items.push(match[1])
        index += 1
      }
      blocks.push(
        <ol key={blocks.length} className="list-decimal space-y-1 pl-5">
          {items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item)}</li>)}
        </ol>,
      )
      continue
    }

    const paragraph = [line]
    index += 1
    while (
      index < lines.length
      && lines[index].trim()
      && !/^```/.test(lines[index])
      && !/^\s*[-*]\s+/.test(lines[index])
      && !/^\s*\d+[.)]\s+/.test(lines[index])
    ) {
      paragraph.push(lines[index])
      index += 1
    }
    blocks.push(
      <p key={blocks.length} className="whitespace-pre-wrap">
        {renderInline(paragraph.join('\n'))}
      </p>,
    )
  }

  return <div className="space-y-2 break-words [overflow-wrap:anywhere]">{blocks}</div>
}

/** 单条消息，独立 memo 避免输入和等待计时触发历史消息重渲染 */
const ChatMessage = memo(function ChatMessage({
  message,
  onRetry,
  onEdit,
  onCopy,
  copied,
  editing,
  onEditSubmit,
  onEditCancel,
}: {
  message: ChatMsg
  onRetry: (text: string) => void
  onEdit?: (id: number) => void
  onCopy?: (id: number) => void
  copied?: boolean
  editing?: boolean
  onEditSubmit?: (id: number, text: string) => void
  onEditCancel?: () => void
}) {
  const isUser = message.role === 'user'
  // 原地编辑草稿只在进入编辑态时初始化，编辑期间不回传父组件
  const [draft, setDraft] = useState(message.text)
  const editRef = useRef<HTMLTextAreaElement | null>(null)
  useEffect(() => {
    if (editing) setDraft(message.text)
  }, [editing, message.text])
  // 进入编辑态时聚焦并把光标移到文本末尾（autofocus 在部分浏览器会落在开头）
  useEffect(() => {
    if (!editing) return
    const frame = requestAnimationFrame(() => {
      const el = editRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    })
    return () => cancelAnimationFrame(frame)
  }, [editing])

  if (isUser && editing) {
    const rows = Math.min(Math.max(draft.split('\n').length, 2), 8)
    return (
      <article className="flex max-w-[85%] flex-col items-end self-end">
        <textarea
          ref={editRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              const text = draft.trim()
              if (text) onEditSubmit?.(message.id, text)
            } else if (event.key === 'Escape') {
              onEditCancel?.()
            }
          }}
          rows={rows}
          className="max-h-48 w-full resize-none overflow-y-auto rounded-xl px-3 py-2 text-[13px] leading-6 outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/30"
          style={{ background: 'var(--wb-surface-2)', color: 'var(--wb-ink)', border: '1px solid var(--wb-brand-600)' }}
          aria-label="编辑消息"
        />
        <p className="mt-0.5 text-[10px]" style={{ color: 'var(--wb-ink-3)' }}>Enter 重新发送 · Esc 取消</p>
      </article>
    )
  }

  return (
    <article className={`flex flex-col ${isUser ? 'items-end group' : 'items-start'}`}>
      {message.ctxLabel && (
        <p className="mb-1 max-w-full truncate text-right text-[10px]" style={{ color: 'var(--wb-ink-3)' }}>
          携带 · {message.ctxLabel}
        </p>
      )}
      <div
        className={`${isUser ? 'max-w-[85%]' : 'max-w-[92%]'} rounded-xl px-3 py-2 text-[13px] leading-6`}
        style={
          message.error
            ? { background: 'var(--wb-danger-soft)', color: 'var(--wb-danger)', border: '1px solid var(--wb-danger)' }
            : isUser
              ? { background: 'var(--wb-brand-600)', color: '#fff' }
              : { background: 'var(--wb-surface-2)', color: 'var(--wb-ink)', border: '1px solid var(--wb-line)' }
        }
      >
        {message.error ? <p>{message.text}</p> : <MessageBody text={message.text} />}
      </div>
      {message.error && message.retryText && (
        <button
          onClick={() => onRetry(message.retryText!)}
          className="mt-1 rounded px-2 py-1 text-xs font-medium transition hover:opacity-70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          style={{ color: 'var(--wb-danger)' }}
        >
          重新发送
        </button>
      )}
      {isUser && (onCopy || onEdit) && (
        <div className="msg-actions mt-0.5 flex items-center gap-0.5">
          {onCopy && (
            <button
              onClick={() => onCopy(message.id)}
              className="rounded p-1 transition hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              style={{ color: 'var(--wb-ink-3)', opacity: copied ? 1 : 0.55 }}
              title={copied ? '已复制' : '复制'}
              aria-label="复制消息"
            >
              {copied ? (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="11" height="11" rx="2" />
                  <path d="M5 15V5a2 2 0 0 1 2-2h10" />
                </svg>
              )}
            </button>
          )}
          {onEdit && (
            <button
              onClick={() => onEdit(message.id)}
              className="rounded p-1 transition hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              style={{ color: 'var(--wb-ink-3)', opacity: 0.55 }}
              title="编辑并回退到此消息前"
              aria-label="编辑此消息"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
              </svg>
            </button>
          )}
        </div>
      )}
    </article>
  )
})

/** 移动端视口检测：≤767px 用全屏独立页面，PC 用居中弹框 */
function useIsMobileViewport() {
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 767px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const onChange = (event: MediaQueryListEvent) => setMobile(event.matches)
    if (mq.addEventListener) mq.addEventListener('change', onChange)
    else mq.addListener(onChange)
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange)
      else mq.removeListener(onChange)
    }
  }, [])
  return mobile
}

/** 工作台内嵌 AI 对话面板 */
export function AiPanel() {
  const { session } = useAuth()
  const token = session?.token
  const username = session?.user.username ?? ''
  const storageKey = username ? aiMessagesKey(username) : null
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [phase, setPhase] = useState('waiting')
  const [focusReq, setFocusReq] = useState<Requirement | null>(() => getAiFocusRequirement())
  const [focusTodo, setFocusTodo] = useState<TodoItem | null>(() => getAiFocusTodo())
  const [selection, setSelection] = useState('')
  const [useReq, setUseReq] = useState(true)
  const [useTodo, setUseTodo] = useState(true)
  const [useSelection, setUseSelection] = useState(true)
  /** 最近一次复制成功的消息 id，用于图标短暂反馈 */
  const [copiedId, setCopiedId] = useState<number | null>(null)
  /** 当前原地编辑中的用户消息 id */
  const [editingId, setEditingId] = useState<number | null>(null)
  /** 移动端视口：面板以全屏独立页面呈现，不做居中弹框 */
  const isMobile = useIsMobileViewport()
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const sendingRef = useRef(false)
  /** 消息列表镜像，供稳定回调读取最新内容而不触发 memo 重渲染 */
  const messagesRef = useRef<ChatMsg[]>([])
  const abortRef = useRef<AbortController | null>(null)
  /** 当前运行中任务 id，用于取消；发送结束即清空 */
  const jobIdRef = useRef<string | null>(null)
  /** 标记本次中止来自「停止」按钮，用于区分主动取消与组件卸载 */
  const cancelRequestedRef = useRef(false)
  const nextMessageId = useRef(1)
  const stickToBottom = useRef(true)
  const sendRef = useRef<(text: string) => Promise<void>>(async () => {})

  // 刷新后恢复当前用户最近 20 条面板消息
  useEffect(() => {
    if (!storageKey) {
      setMessages([])
      return
    }
    const raw = localStorage.getItem(storageKey)
    if (!raw) {
      setMessages([])
      return
    }
    try {
      const parsed = JSON.parse(raw) as ChatMsg[]
      const list = Array.isArray(parsed) ? parsed.slice(-MESSAGE_LIMIT) : []
      setMessages(list)
      nextMessageId.current = list.reduce((max, m) => Math.max(max, m.id), 0) + 1
    } catch {
      setMessages([])
      nextMessageId.current = 1
    }
  }, [storageKey])

  // 消息变化时写回本地，只保留最近 20 条
  useEffect(() => {
    if (!storageKey) return
    if (messages.length === 0) {
      localStorage.removeItem(storageKey)
      return
    }
    localStorage.setItem(storageKey, JSON.stringify(messages.slice(-MESSAGE_LIMIT)))
  }, [messages, storageKey])

  // 仅打开时订阅焦点变化，关闭后面板不响应工作台更新
  useEffect(() => {
    if (!open) return
    const syncFocus = () => {
      setFocusReq(getAiFocusRequirement())
      setFocusTodo(getAiFocusTodo())
    }
    syncFocus()
    return subscribeAiFocus(syncFocus)
  }, [open])

  // 打开时先快照选区，再聚焦输入框
  useEffect(() => {
    if (!open) return
    setSelection(captureSelection())
    const frame = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [open])

  // ESC 关闭面板
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // 全局快捷键 ⌘J / Ctrl+J：开关 AI 面板（输入框内也生效，与 ⌘K 同风格）
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'j') {
        event.preventDefault()
        stickToBottom.current = true
        setOpen((value) => !value)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 等待计时仅更新轻量状态，历史消息由 memo 隔离
  useEffect(() => {
    if (!sending) return
    const startedAt = Date.now()
    setElapsed(0)
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [sending])

  // 输入框随内容增高，最高 96px；发送按钮保持原尺寸
  useEffect(() => {
    if (!open || !inputRef.current) return
    inputRef.current.style.height = 'auto'
    inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 96)}px`
  }, [input, open])

  // 用户原本位于底部时才自动跟随新消息；打开面板时强制贴底，恢复的历史消息直接落在最新一条
  useEffect(() => {
    if (!open || !stickToBottom.current || !scrollRef.current) return
    const frame = requestAnimationFrame(() => {
      const el = scrollRef.current
      if (el) el.scrollTop = el.scrollHeight
    })
    return () => cancelAnimationFrame(frame)
  }, [open, messages, sending])

  // 组件卸载时中止前端轮询；单纯关闭面板不会中止
  useEffect(() => () => abortRef.current?.abort(), [])

  /** 切换面板显隐；打开时强制贴底 */
  const toggleOpen = useCallback(() => {
    stickToBottom.current = true
    setOpen((value) => !value)
  }, [])

  /** 清空当前显示的前端会话并同步清掉本地存储，不影响 agent 服务端历史 */
  const clearConversation = useCallback(() => {
    if (sendingRef.current) return
    setMessages([])
    setInput('')
    nextMessageId.current = 1
    if (storageKey) localStorage.removeItem(storageKey)
  }, [storageKey])

  /** 组装本轮最小化快照与展示标签 */
  const buildSnapshot = useCallback((): { snapshot: AiContextSnapshot; label: string } | null => {
    const snapshot: AiContextSnapshot = {}
    const parts: string[] = []
    if (useReq && focusReq) {
      snapshot.requirement = snapshotFromRequirement(focusReq)
      parts.push(`需求：${focusReq.name}`)
    }
    if (useTodo && focusTodo) {
      snapshot.todo = snapshotFromTodo(focusTodo)
      parts.push(`待办：${focusTodo.content}`)
    }
    if (useSelection && selection) {
      snapshot.selection = selection
      parts.push(`选中：${selectionLabel(selection)}`)
    }
    if (parts.length === 0) return null
    return { snapshot, label: parts.join(' · ') }
  }, [focusReq, focusTodo, selection, useReq, useTodo, useSelection])

  /** 发送指定文本并等待后台任务完成，可复用于失败重试 */
  const sendMessage = useCallback(async (text: string) => {
    if (!text || sendingRef.current) return
    if (!token) {
      setMessages((items) => [...items, {
        id: nextMessageId.current++,
        role: 'assistant',
        text: '本地模式或未登录，AI 面板不可用',
        error: true,
      }])
      return
    }

    const ctx = buildSnapshot()
    const controller = new AbortController()
    abortRef.current = controller
    sendingRef.current = true
    cancelRequestedRef.current = false
    jobIdRef.current = null
    stickToBottom.current = true
    setSending(true)
    setPhase('waiting')
    setMessages((items) => [...items, {
      id: nextMessageId.current++,
      role: 'user',
      text,
      ctxLabel: ctx?.label,
    }])

    try {
      const created = await createAiContext(token, ctx?.snapshot ?? {}, controller.signal)
      const { reply } = await sendAiChat(token, {
        message: text,
        contextId: created?.contextId,
      }, controller.signal, {
        onJobId: (id) => { jobIdRef.current = id },
        onPhase: setPhase,
      })
      setMessages((items) => [...items, { id: nextMessageId.current++, role: 'assistant', text: reply }])
    } catch (error) {
      // 主动取消（含服务端已标记取消）→ 记录一条中性提示；组件卸载等被动中止保持静默
      const cancelledByUser =
        (error instanceof DOMException && error.name === 'AbortError' && cancelRequestedRef.current) ||
        (error instanceof AiPanelError && error.message === '用户已取消')
      if (cancelledByUser) {
        setMessages((items) => [...items, {
          id: nextMessageId.current++,
          role: 'assistant',
          text: '已取消本次回复（用户已取消）',
        }])
      } else if (error instanceof DOMException && error.name === 'AbortError') {
        return
      } else {
        const message = error instanceof AiPanelError ? error.message : '网络错误，请检查连接后重试'
        setMessages((items) => [...items, {
          id: nextMessageId.current++,
          role: 'assistant',
          text: message,
          error: true,
          retryText: text,
        }])
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      cancelRequestedRef.current = false
      jobIdRef.current = null
      sendingRef.current = false
      setSending(false)
      setPhase('waiting')
    }
  }, [buildSnapshot, token])

  sendRef.current = sendMessage

  /** 用户主动取消：通知服务端终止 agent 进程，再停止本地轮询 */
  const handleCancel = useCallback(() => {
    if (!sendingRef.current || !token) return
    cancelRequestedRef.current = true
    const jobId = jobIdRef.current
    if (!jobId) {
      // 任务尚未创建（上下文签发阶段）：直接中止本地等待
      abortRef.current?.abort()
      return
    }
    void cancelAiChat(token, jobId)
      .then((status) => {
        // 服务端显示已完成 → 不中止轮询，让正常回复落库
        if (status === 'done') {
          cancelRequestedRef.current = false
          return
        }
        abortRef.current?.abort()
      })
      .catch(() => abortRef.current?.abort())
  }, [token])

  /** 复制用户消息原文，图标短暂打勾反馈 */
  const handleCopy = useCallback((id: number) => {
    const target = messagesRef.current.find((m) => m.id === id)
    if (!target) return
    void navigator.clipboard
      ?.writeText(target.text)
      .then(() => {
        setCopiedId(id)
        window.setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 1500)
      })
      .catch(() => {})
  }, [])

  /** 小铅笔：进入该消息的原地编辑态 */
  const handleEdit = useCallback((id: number) => {
    if (sendingRef.current) return
    const target = messagesRef.current.find((m) => m.id === id)
    if (target?.role !== 'user') return
    setEditingId(id)
  }, [])

  /** 原地编辑确认：回退到该消息之前，用编辑后的文本重新发送 */
  const handleEditSubmit = useCallback((id: number, text: string) => {
    if (sendingRef.current) return
    const index = messagesRef.current.findIndex((m) => m.id === id)
    if (index < 0) return
    setEditingId(null)
    setMessages(messagesRef.current.slice(0, index))
    void sendRef.current(text)
  }, [])

  /** 原地编辑取消：恢复原气泡 */
  const handleEditCancel = useCallback(() => setEditingId(null), [])

  /** 通过 ref 稳定重试回调，避免历史消息随输入变化重渲染 */
  const handleRetry = useCallback((text: string) => void sendRef.current(text), [])

  messagesRef.current = messages

  /** 清空草稿并发送当前输入 */
  const handleSend = useCallback(() => {
    const text = input.trim()
    if (!text || sendingRef.current) return
    setInput('')
    void sendMessage(text)
  }, [input, sendMessage])

  if (!token) return null

  /** 面板主体（上下文芯片 + 消息区 + 输入区）：移动端全屏页与 PC 弹框共用 */
  const panelBody = (
    <>
      {(focusReq || focusTodo || selection) && (
        <div className="px-3 py-2.5" style={{ borderBottom: '1px solid var(--wb-line)' }}>
          <p className="mb-1.5 text-[10px]" style={{ color: 'var(--wb-ink-3)' }}>发送时携带 · 点击芯片可排除</p>
          <div className="flex flex-wrap gap-1.5">
            {focusReq && (
              <button
                onClick={() => setUseReq((value) => !value)}
                className="max-w-full truncate rounded-full px-2.5 py-1 text-xs transition"
                style={{
                  background: useReq ? 'var(--wb-success-soft)' : 'var(--wb-surface-2)',
                  color: useReq ? 'var(--wb-success)' : 'var(--wb-ink-3)',
                  textDecoration: useReq ? 'none' : 'line-through',
                }}
                title="最近打开的需求，点击切换是否携带"
              >
                需求 · {focusReq.name}{focusReq.branch ? ` · ${focusReq.branch}` : ''}
              </button>
            )}
            {focusTodo && (
              <button
                onClick={() => setUseTodo((value) => !value)}
                className="max-w-full truncate rounded-full px-2.5 py-1 text-xs transition"
                style={{
                  background: useTodo ? 'var(--wb-warn-soft)' : 'var(--wb-surface-2)',
                  color: useTodo ? 'var(--wb-warn)' : 'var(--wb-ink-3)',
                  textDecoration: useTodo ? 'none' : 'line-through',
                }}
                title="最近单击的待办，点击切换是否携带"
              >
                待办 · {focusTodo.content}{focusTodo.date ? ` · ${focusTodo.date}` : ''}
              </button>
            )}
            {selection && (
              <button
                onClick={() => setUseSelection((value) => !value)}
                className="max-w-full truncate rounded-full px-2.5 py-1 text-xs transition"
                style={{
                  background: useSelection ? 'var(--wb-accent-soft)' : 'var(--wb-surface-2)',
                  color: useSelection ? 'var(--wb-accent-600)' : 'var(--wb-ink-3)',
                  textDecoration: useSelection ? 'none' : 'line-through',
                }}
                title={`点击切换是否携带选中内容：${selectionLabel(selection)}`}
              >
                选中 · {selectionLabel(selection)}
              </button>
            )}
          </div>
        </div>
      )}

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto overscroll-contain px-3 py-3"
        aria-label="对话消息"
        onScroll={() => {
          const el = scrollRef.current
          if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
        }}
      >
        {messages.length === 0 && (
          <div className="flex h-full min-h-40 flex-col items-center justify-center text-center">
            <p className="text-sm font-medium" style={{ color: 'var(--wb-ink-2)' }}>带着当前上下文，直接问</p>
            <p className="mt-1.5 text-xs" style={{ color: 'var(--wb-ink-3)' }}>例如：这个需求当前进展、上线时间和待办风险</p>
          </div>
        )}
        <div className="flex flex-col gap-3">
          {messages.map((message) => (
            <ChatMessage
              key={message.id}
              message={message}
              onRetry={handleRetry}
              onEdit={handleEdit}
              onCopy={handleCopy}
              copied={copiedId === message.id}
              editing={editingId === message.id}
              onEditSubmit={handleEditSubmit}
              onEditCancel={handleEditCancel}
            />
          ))}
          {sending && (
            <div
              className="max-w-[92%] rounded-xl px-3 py-2.5 text-xs"
              style={{ background: 'var(--wb-surface-2)', color: 'var(--wb-ink-2)', border: '1px solid var(--wb-line)' }}
              aria-live="polite"
            >
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1" aria-hidden="true">
                  <i className="ai-thinking-dot" />
                  <i className="ai-thinking-dot" />
                  <i className="ai-thinking-dot" />
                </span>
                <span>{PHASE_LABELS[phase] ?? PHASE_LABELS.waiting} · {formatElapsed(elapsed)}</span>
              </div>
              <p className="mt-1 text-[10px]" style={{ color: 'var(--wb-ink-3)' }}>
                {elapsed >= 30
                  ? '代码审查等复杂任务可能需要几分钟，可关闭面板稍后查看'
                  : '可关闭面板，回复会继续保留在当前会话'}
              </p>
            </div>
          )}
        </div>
      </div>

      <footer className="flex items-end gap-2 px-3 py-2.5" style={{ borderTop: '1px solid var(--wb-line)' }}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              handleSend()
            }
          }}
          placeholder="输入消息，Enter 发送；Shift + Enter 换行"
          rows={1}
          className="max-h-24 min-h-[2.25rem] flex-1 resize-none overflow-y-auto rounded-lg px-2.5 py-2 text-xs leading-4 outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/30"
          style={{ background: 'var(--wb-surface-2)', color: 'var(--wb-ink)', border: '1px solid var(--wb-line)' }}
        />
        <button
          onClick={sending ? handleCancel : handleSend}
          disabled={!sending && !input.trim()}
          className="inline-flex min-w-[3.25rem] shrink-0 items-center justify-center rounded-lg px-3 py-2 text-xs font-medium text-white transition disabled:opacity-40"
          style={{ background: 'var(--wb-brand-600)' }}
          title={sending ? '停止' : '发送'}
          aria-label={sending ? '停止生成' : '发送'}
        >
          {sending ? (
            <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
              <rect x="1" y="1" width="10" height="10" rx="2" fill="currentColor" />
            </svg>
          ) : (
            '发送'
          )}
        </button>
      </footer>
    </>
  )

  return (
    <>
      <button
        onClick={toggleOpen}
        className="fixed bottom-20 right-4 z-[60] flex h-12 w-12 items-center justify-center rounded-full text-lg shadow-lg transition hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 md:bottom-6"
        style={{ background: 'var(--wb-brand-600)', color: '#fff' }}
        aria-label="AI 助手"
        aria-expanded={open}
        title="小朵 · AI 助手"
      >
        {open ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        ) : (
          <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="6" width="16" height="13" rx="4" />
            <path d="M12 3v3M8 11h.01M16 11h.01M9 15h6" />
          </svg>
        )}
      </button>

      {/* 移动端：全屏独立页面，不做居中弹框 */}
      {open && isMobile && (
        <section
          className="fixed inset-0 z-[70] flex flex-col"
          style={{ background: 'var(--wb-surface)' }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="ai-panel-title"
        >
          <header
            className="flex items-center justify-between px-2 py-2"
            style={{ borderBottom: '1px solid var(--wb-line)', paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}
          >
            <div className="flex min-w-0 items-center gap-1">
              <button
                onClick={() => setOpen(false)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition hover:bg-black/5 focus-visible:outline focus-visible:outline-2"
                style={{ color: 'var(--wb-ink-2)' }}
                aria-label="返回"
                title="返回"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m15 18-6-6 6-6" />
                </svg>
              </button>
              <h2 id="ai-panel-title" className="text-sm font-semibold" style={{ color: 'var(--wb-ink)' }}>小朵</h2>
              <span className="rounded-full px-2 py-0.5 text-[10px]" style={{ background: 'var(--wb-success-soft)', color: 'var(--wb-success)' }}>
                已连接工作台
              </span>
            </div>
            <button
              onClick={clearConversation}
              disabled={sending}
              className="shrink-0 rounded px-2 py-1 text-xs transition hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-30"
              style={{ color: 'var(--wb-ink-2)' }}
              title="清空当前会话显示"
            >
              清空
            </button>
          </header>
          {panelBody}
        </section>
      )}

      {/* PC：居中弹框 */}
      {open && !isMobile && (
        <>
          <div className="ai-panel-overlay fixed inset-0 z-[59] bg-black/40" onClick={() => setOpen(false)} />
          <section
            className="ai-panel-dialog fixed left-1/2 top-1/2 z-[60] flex h-[80dvh] max-h-[640px] w-[calc(100vw-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl"
            style={{ background: 'var(--wb-surface)', border: '1px solid var(--wb-line)' }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="ai-panel-title"
          >
            <header
              className="flex items-center justify-between px-4 py-3"
              style={{ borderBottom: '1px solid var(--wb-line)' }}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 id="ai-panel-title" className="text-sm font-semibold" style={{ color: 'var(--wb-ink)' }}>小朵</h2>
                  <span className="hidden rounded-full px-2 py-0.5 text-[10px] sm:inline" style={{ background: 'var(--wb-success-soft)', color: 'var(--wb-success)' }}>
                    已连接工作台
                  </span>
                </div>
                <p className="mt-0.5 hidden truncate text-xs sm:block" style={{ color: 'var(--wb-ink-3)' }}>
                  需求、待办与选中内容随消息发送
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  onClick={clearConversation}
                  disabled={sending}
                  className="rounded px-2 py-1 text-xs transition hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-30"
                  style={{ color: 'var(--wb-ink-2)' }}
                  title="清空当前会话显示"
                >
                  清空
                </button>
                <button
                  onClick={() => setOpen(false)}
                  className="flex h-9 w-9 items-center justify-center rounded-lg transition hover:bg-black/5 focus-visible:outline focus-visible:outline-2"
                  style={{ color: 'var(--wb-ink-2)' }}
                  aria-label="关闭 AI 面板"
                  title="关闭"
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </header>
            {panelBody}
          </section>
        </>
      )}
    </>
  )
}
