/**
 * 密码管理视图（从顶栏「更多操作 → 密码管理」进入）
 *
 * 安全模型：
 *   - 主密码只在内存 / sessionStorage（当前标签页生命周期）中存在，不落 localStorage
 *   - 敏感字段（用户名/密码/备注）AES-GCM 加密为 enc 存储与同步，服务器只见密文
 *   - 解锁 = 用主密码成功解开任一条 enc（无条目时直接接受，首条保存后自动可校验）
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GeneratorOptions, PasswordEntry, PasswordSecret } from '../types'
import { CipherError, decryptJson, encryptJson } from '../lib/cipher'
import { assessStrength, DEFAULT_GENERATOR_OPTIONS, generatePassword } from '../lib/passgen'
import { uid, nowISO } from '../lib/storage'
import { useStore } from '../store/StoreContext'
import { Modal } from './ui'

const SESSION_KEY = 'dev-workbench:pass-master'

/** 剪贴板写入（clipboard API 失败时回退 execCommand） */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      return ok
    } catch {
      return false
    }
  }
}

/* ---------------- 锁屏 ---------------- */

function LockScreen({ error, onUnlock }: { error: string; onUnlock: (master: string) => void }) {
  const [pwd, setPwd] = useState('')
  return (
    <div className="wb-view active">
      <div className="wb-card mx-auto mt-10 max-w-sm p-8 text-center">
        <div
          className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full"
          style={{ background: 'var(--wb-accent-soft, rgba(211,156,59,.15))' }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--wb-accent)' }}>
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <h3 style={{ fontSize: 17, fontWeight: 600, color: 'var(--wb-ink)' }}>密码库已锁定</h3>
        <p className="mt-1 mb-5 text-xs" style={{ color: 'var(--wb-ink-3)' }}>
          输入主密码解锁 · 忘记主密码将无法找回数据
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (!pwd) return
            onUnlock(pwd)
          }}
        >
          <input
            type="password"
            className="wb-input w-full"
            placeholder="主密码"
            value={pwd}
            autoFocus
            onChange={(e) => setPwd(e.target.value)}
          />
          {error && (
            <p className="mt-2 text-xs" style={{ color: '#EF4444' }}>{error}</p>
          )}
          <button type="submit" className="wb-btn-primary mt-4 w-full" style={{ borderRadius: 10 }}>
            解锁
          </button>
        </form>
      </div>
    </div>
  )
}

/* ---------------- 生成器面板 ---------------- */

function GeneratorPanel({ onUse }: { onUse: (pwd: string) => void }) {
  const [opts, setOpts] = useState<GeneratorOptions>(DEFAULT_GENERATOR_OPTIONS)
  const [value, setValue] = useState('')
  const strength = assessStrength(value)

  return (
    <div className="rounded-xl border p-4" style={{ borderColor: 'var(--wb-line)', background: 'var(--wb-surface-2)' }}>
      <div className="flex items-center gap-2">
        <input className="wb-input flex-1 font-mono" readOnly value={value} placeholder="点「生成」产出密码" />
        <button type="button" className="wb-icon-btn" title="重新生成" onClick={() => setValue(generatePassword(opts))}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16" />
          </svg>
        </button>
        <button
          type="button"
          className="wb-btn-primary"
          style={{ borderRadius: 10, padding: '8px 14px' }}
          disabled={!value}
          onClick={() => onUse(value)}
        >
          使用
        </button>
      </div>
      {value && (
        <div className="mt-2 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ background: 'var(--wb-line)' }}>
            <div className="h-full rounded-full transition-all" style={{ width: `${(strength.score / 7) * 100}%`, background: strength.color }} />
          </div>
          <span className="text-xs" style={{ color: strength.color }}>{strength.label}</span>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs" style={{ color: 'var(--wb-ink-2)' }}>
        <label className="flex items-center gap-1.5">
          长度
          <input
            type="range" min={8} max={64} value={opts.length}
            onChange={(e) => setOpts({ ...opts, length: Number(e.target.value) })}
            className="w-28"
          />
          <span className="font-mono">{opts.length}</span>
        </label>
        {([
          ['uppercase', 'A-Z'],
          ['lowercase', 'a-z'],
          ['numbers', '0-9'],
          ['symbols', '!@#'],
        ] as [keyof GeneratorOptions, string][]).map(([key, label]) => (
          <label key={key} className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={opts[key] as boolean}
              onChange={(e) => setOpts({ ...opts, [key]: e.target.checked })}
            />
            {label}
          </label>
        ))}
      </div>
    </div>
  )
}

/* ---------------- 编辑表单弹窗 ---------------- */

interface FormState {
  id: string
  title: string
  url: string
  tags: string
  username: string
  password: string
  notes: string
}

function PasswordFormModal({
  open,
  initial,
  master,
  onClose,
  onSubmit,
}: {
  open: boolean
  /** null = 新建 */
  initial: (PasswordEntry & { secret?: PasswordSecret }) | null
  master: string
  onClose: () => void
  /** 保存成功回调：带回落库的条目（调用方据此刷新解密缓存） */
  onSubmit: (saved?: PasswordEntry) => void
}) {
  const store = useStore()
  const [form, setForm] = useState<FormState>({
    id: '', title: '', url: '', tags: '', username: '', password: '', notes: '',
  })
  const [showGen, setShowGen] = useState(false)
  const [showPwd, setShowPwd] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!open) return
    // 弹窗打开时装载初值；解密失败按空敏感字段处理（容错，不让整表单不可用）
    setForm(
      initial
        ? {
            id: initial.id,
            title: initial.title,
            url: initial.url ?? '',
            tags: (initial.tags ?? []).join(','),
            username: initial.secret?.username ?? '',
            password: initial.secret?.password ?? '',
            notes: initial.secret?.notes ?? '',
          }
        : { id: '', title: '', url: '', tags: '', username: '', password: '', notes: '' },
    )
    setErr('')
    setShowGen(false)
    setShowPwd(false)
  }, [open, initial])

  const submit = async () => {
    if (!form.title.trim()) { setErr('名称不能为空'); return }
    setSaving(true)
    try {
      const enc = await encryptJson(master, {
        username: form.username,
        password: form.password,
        notes: form.notes,
      })
      const prev = initial
      const entry: PasswordEntry = {
        id: form.id || uid(),
        title: form.title.trim(),
        url: form.url.trim() || undefined,
        tags: form.tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean),
        enc,
        createdAt: prev?.createdAt ?? nowISO(),
        updatedAt: nowISO(),
      }
      const res = store.upsertPassword(entry)
      if (!res.ok) setErr(res.error ?? '保存失败')
      else onSubmit(entry)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '加密失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={initial ? '编辑密码' : '新增密码'} width="max-w-lg">
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs" style={{ color: 'var(--wb-ink-2)' }}>名称 *</label>
          <input className="wb-input w-full" value={form.title} autoFocus
            onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="如：GitHub / 腾讯云控制台" />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs" style={{ color: 'var(--wb-ink-2)' }}>网址</label>
            <input className="wb-input w-full" value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://…" />
          </div>
          <div>
            <label className="mb-1 block text-xs" style={{ color: 'var(--wb-ink-2)' }}>标签（逗号分隔）</label>
            <input className="wb-input w-full" value={form.tags}
              onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="工作,服务器" />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs" style={{ color: 'var(--wb-ink-2)' }}>用户名</label>
          <input className="wb-input w-full" value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })} />
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-xs" style={{ color: 'var(--wb-ink-2)' }}>密码</label>
            <button type="button" className="text-xs transition hover:opacity-70"
              style={{ color: 'var(--wb-accent)' }}
              onClick={() => setShowGen((v) => !v)}>
              {showGen ? '收起生成器' : '🎲 生成器'}
            </button>
          </div>
          <div className="relative">
            <input
              className="wb-input w-full pr-16 font-mono"
              type={showPwd ? 'text' : 'password'}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
            <button type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs transition hover:bg-black/5"
              style={{ color: 'var(--wb-ink-3)' }}
              onClick={() => setShowPwd((v) => !v)}>
              {showPwd ? '隐藏' : '显示'}
            </button>
          </div>
        </div>
        {showGen && (
          <GeneratorPanel onUse={(pwd) => { setForm((f) => ({ ...f, password: pwd })); setShowGen(false) }} />
        )}
        <div>
          <label className="mb-1 block text-xs" style={{ color: 'var(--wb-ink-2)' }}>备注</label>
          <textarea className="wb-input w-full" rows={3} value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
        {err && <p className="text-xs" style={{ color: '#EF4444' }}>{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="rounded-lg px-4 py-2 text-sm transition"
            style={{ border: '1px solid var(--wb-line)', color: 'var(--wb-ink-2)' }}
            onClick={onClose}>
            取消
          </button>
          <button type="button" className="wb-btn-primary" style={{ borderRadius: 10 }}
            disabled={saving} onClick={() => void submit()}>
            {saving ? '加密保存中…' : '保存'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/* ---------------- 主视图 ---------------- */

export function PasswordView() {
  const store = useStore()
  const [master, setMaster] = useState<string | null>(() => sessionStorage.getItem(SESSION_KEY))
  const [lockErr, setLockErr] = useState('')
  const [keyword, setKeyword] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<(PasswordEntry & { secret?: PasswordSecret }) | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [secrets, setSecrets] = useState<Record<string, PasswordSecret>>({})
  const confirmId = useRef<string | null>(null)

  /** 解锁：有密文条目时先试解一条验证主密码；空库直接接受 */
  const tryUnlock = useCallback(
    async (pwd: string, remember: boolean) => {
      const anyEnc = store.passwords.find((p) => p.enc)
      if (anyEnc?.enc) {
        try {
          await decryptJson(pwd, anyEnc.enc)
        } catch (e) {
          if (e instanceof CipherError) {
            setLockErr('主密码不正确')
            return false
          }
          throw e
        }
      }
      // 批量解密当前所有条目
      const map: Record<string, PasswordSecret> = {}
      for (const p of store.passwords) {
        if (!p.enc) continue
        try {
          map[p.id] = await decryptJson(pwd, p.enc)
        } catch { /* 单条损坏跳过，不影响其余 */ }
      }
      setSecrets(map)
      setMaster(pwd)
      setLockErr('')
      if (remember) sessionStorage.setItem(SESSION_KEY, pwd)
      return true
    },
    [store.passwords],
  )

  // 挂载时若 sessionStorage 有主密码 → 静默解锁；失效则清除
  useEffect(() => {
    const cached = sessionStorage.getItem(SESSION_KEY)
    if (!cached) return
    void tryUnlock(cached, true).then((ok) => {
      if (!ok) sessionStorage.removeItem(SESSION_KEY)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 新设备同步来的条目 → 用已解锁的主密码补解密
  useEffect(() => {
    if (!master) return
    setSecrets((prev) => {
      const next = { ...prev }
      let changed = false
      for (const p of store.passwords) {
        if (p.enc && !next[p.id]) {
          void decryptJson(master, p.enc).then(
            (s) => { setSecrets((cur) => ({ ...cur, [p.id]: s as PasswordSecret })) },
            () => {},
          )
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [store.passwords, master])

  const lock = useCallback(() => {
    setMaster(null)
    setSecrets({})
    sessionStorage.removeItem(SESSION_KEY)
  }, [])

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    const list = [...store.passwords].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    if (!kw) return list
    return list.filter((p) => {
      const hay = [p.title, p.url ?? '', ...(p.tags ?? [])].join(' ').toLowerCase()
      if (hay.includes(kw)) return true
      const s = secrets[p.id]
      return Boolean(
        s &&
          (s.username.toLowerCase().includes(kw) ||
            (s.notes ?? '').toLowerCase().includes(kw)),
      )
    })
  }, [store.passwords, keyword, secrets])

  const handleUnlock = (pwd: string) => void tryUnlock(pwd, true)

  if (!master) return <LockScreen error={lockErr} onUnlock={handleUnlock} />

  return (
    <div className="wb-view active">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="wb-search min-w-0 flex-1">
          <input
            className="wb-input"
            placeholder="搜索名称 / 网址 / 标签 / 用户名…"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>
        <button
          className="wb-btn-primary"
          style={{ borderRadius: 10 }}
          onClick={() => { setEditing(null); setFormOpen(true) }}
        >
          ＋ 新增
        </button>
        <button
          className="rounded-lg px-3 py-2 text-xs transition"
          style={{ border: '1px solid var(--wb-line)', color: 'var(--wb-ink-3)' }}
          onClick={lock}
          title="清除本页记忆的主密码"
        >
          🔒 锁定
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="wb-card p-10 text-center text-sm" style={{ color: 'var(--wb-ink-3)' }}>
          {keyword ? '没有匹配的条目' : '还没有密码条目，点「＋ 新增」开始'}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((p) => {
            const s = secrets[p.id]
            const expanded = expandedId === p.id
            return (
              <div key={p.id} className="wb-card overflow-hidden p-0">
                <button
                  type="button"
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-[var(--wb-surface-2)]"
                  onClick={() => setExpandedId(expanded ? null : p.id)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium" style={{ color: 'var(--wb-ink)' }}>{p.title}</span>
                      {(p.tags ?? []).slice(0, 3).map((t) => (
                        <span key={t} className="rounded-full px-2 py-0.5 text-[10px]"
                          style={{ background: 'var(--wb-surface-2)', color: 'var(--wb-ink-3)' }}>
                          {t}
                        </span>
                      ))}
                    </div>
                    <div className="mt-0.5 truncate text-xs" style={{ color: 'var(--wb-ink-3)' }}>
                      {s?.username ? `${s.username} · ` : ''}{p.url ?? ''}
                    </div>
                  </div>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                    style={{ color: 'var(--wb-ink-3)', transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}>
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>

                {expanded && (
                  <div className="border-t px-4 py-3" style={{ borderColor: 'var(--wb-line)' }}>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <div className="mb-1 text-[10px] uppercase tracking-wider" style={{ color: 'var(--wb-ink-3)' }}>用户名</div>
                        <div className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate font-mono text-sm" style={{ color: 'var(--wb-ink)' }}>
                            {s?.username || '—'}
                          </span>
                          {s?.username && (
                            <button type="button" className="wb-icon-btn" title="复制用户名"
                              onClick={() => { void copyText(s.username); setCopiedId(`${p.id}:u`) }}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="9" y="9" width="13" height="13" rx="2" />
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                              </svg>
                            </button>
                          )}
                        </div>
                      </div>
                      <div>
                        <div className="mb-1 text-[10px] uppercase tracking-wider" style={{ color: 'var(--wb-ink-3)' }}>密码</div>
                        <div className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate font-mono text-sm" style={{ color: 'var(--wb-ink)' }}>
                            {s ? '••••••••••••' : '（解密失败）'}
                          </span>
                          {s && (
                            <>
                              <button type="button" className="wb-icon-btn" title="复制密码"
                                onClick={() => { void copyText(s.password); setCopiedId(`${p.id}:p`) }}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <rect x="9" y="9" width="13" height="13" rx="2" />
                                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                </svg>
                              </button>
                              <button type="button" className="wb-icon-btn" title="明文显示（5 秒）"
                                onClick={() => {
                                  setCopiedId(`${p.id}:show`)
                                  setTimeout(() => setCopiedId((c) => (c === `${p.id}:show` ? null : c)), 5000)
                                }}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                  <circle cx="12" cy="12" r="3" />
                                </svg>
                              </button>
                            </>
                          )}
                        </div>
                        {copiedId === `${p.id}:show` && s && (
                          <div className="mt-1 break-all font-mono text-xs" style={{ color: 'var(--wb-accent)' }}>{s.password}</div>
                        )}
                      </div>
                    </div>
                    {s?.notes && (
                      <div className="mt-3">
                        <div className="mb-1 text-[10px] uppercase tracking-wider" style={{ color: 'var(--wb-ink-3)' }}>备注</div>
                        <div className="whitespace-pre-wrap text-xs" style={{ color: 'var(--wb-ink-2)' }}>{s.notes}</div>
                      </div>
                    )}
                    <div className="mt-3 flex items-center gap-2">
                      <button type="button" className="text-xs transition hover:opacity-70"
                        style={{ color: 'var(--wb-accent)' }}
                        onClick={() => { setEditing({ ...p, secret: s }); setFormOpen(true) }}>
                        编辑
                      </button>
                      {confirmId.current === p.id ? (
                        <>
                          <button type="button" className="text-xs" style={{ color: '#EF4444' }}
                            onClick={() => { store.removePassword(p.id); confirmId.current = null }}>
                            确认删除
                          </button>
                          <button type="button" className="text-xs" style={{ color: 'var(--wb-ink-3)' }}
                            onClick={() => { confirmId.current = null; setExpandedId(null) }}>
                            取消
                          </button>
                        </>
                      ) : (
                        <button type="button" className="text-xs transition hover:opacity-70"
                          style={{ color: 'var(--wb-ink-3)' }}
                          onClick={() => { confirmId.current = p.id; setTimeout(() => { confirmId.current = null }, 3000) }}>
                          删除
                        </button>
                      )}
                      {copiedId === `${p.id}:u` && (
                        <span className="ml-auto text-xs" style={{ color: 'var(--wb-accent)' }}>已复制用户名</span>
                      )}
                      {copiedId === `${p.id}:p` && (
                        <span className="ml-auto text-xs" style={{ color: 'var(--wb-accent)' }}>已复制密码</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <PasswordFormModal
        open={formOpen}
        initial={editing}
        master={master}
        onClose={() => setFormOpen(false)}
        onSubmit={(saved) => {
          setFormOpen(false)
          // 关键：同步刷新内存中的解密缓存，否则列表/详情仍显示旧值（刷新前不生效）
          if (saved?.enc && master) {
            void decryptJson(master, saved.enc).then(
              (s) => setSecrets((prev) => ({ ...prev, [saved.id]: s as PasswordSecret })),
              () => {},
            )
          }
        }}
      />
    </div>
  )
}
