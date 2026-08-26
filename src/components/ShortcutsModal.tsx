import { Modal } from './ui'

interface Props {
  open: boolean
  onClose: () => void
}

const SHORTCUTS: { keys: string[]; desc: string }[] = [
  { keys: ['N'], desc: '新建需求' },
  { keys: ['/'], desc: '聚焦搜索框（需求列表页）' },
  { keys: ['Esc'], desc: '关闭弹窗 / 抽屉' },
  { keys: ['?'], desc: '打开快捷键面板' },
]

export function ShortcutsModal({ open, onClose }: Props) {
  return (
    <Modal open={open} onClose={onClose} title="键盘快捷键" width="max-w-md">
      <div className="space-y-2">
        {SHORTCUTS.map((s) => (
          <div
            key={s.keys[0]}
            className="flex items-center justify-between rounded-lg px-3 py-2.5 transition hover:bg-[var(--wb-surface-2)]"
          >
            <span className="text-sm" style={{ color: 'var(--wb-ink-2)' }}>
              {s.desc}
            </span>
            <div className="flex items-center gap-1">
              {s.keys.map((k) => (
                <kbd
                  key={k}
                  className="inline-flex min-w-[28px] items-center justify-center rounded-md border border-[var(--wb-line)] bg-[var(--wb-surface-2)] px-2 py-1 text-xs font-medium shadow-sm"
                  style={{ color: 'var(--wb-ink-2)' }}
                >
                  {k}
                </kbd>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs" style={{ color: 'var(--wb-ink-3)' }}>
        在输入框中编辑时快捷键自动禁用。
      </p>
    </Modal>
  )
}
