import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * 全局错误边界：任何一处渲染异常（如脏数据的字段缺失）不应导致整个应用白屏。
 * 崩溃时给出可操作的提示，并支持一键恢复（重试渲染）。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  private handleReset = () => {
    this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6 dark:bg-slate-900">
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-xl dark:bg-red-900/30">
            ⚠️
          </div>
          <h1 className="mb-2 text-lg font-semibold text-slate-800 dark:text-slate-100">
            页面渲染出错
          </h1>
          <p className="mb-1 text-sm text-slate-500 dark:text-slate-400">
            本地数据仍在，仅是界面渲染被异常数据打断。可尝试重试；
          </p>
          <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
            若反复出错，请导出数据备份后反馈此错误信息。
          </p>
          <pre className="mb-4 max-h-32 overflow-auto rounded-lg bg-slate-100 p-3 text-left text-xs text-red-600 dark:bg-slate-900 dark:text-red-400">
            {this.state.error.message}
          </pre>
          <button
            type="button"
            onClick={this.handleReset}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            重试
          </button>
        </div>
      </div>
    )
  }
}
