import { ref } from 'vue'

export type ConfirmVariant = 'info' | 'warning' | 'danger'

export interface ConfirmOptions {
  title?: string
  content: string
  confirmText?: string
  cancelText?: string
  variant?: ConfirmVariant
  /** 危险操作红按钮（等同 variant: 'danger'） */
  danger?: boolean
}

interface ConfirmState extends Required<Omit<ConfirmOptions, 'danger'>> {
  visible: boolean
  resolve?: (v: boolean) => void
}

const state = ref<ConfirmState>({
  visible: false,
  title: '请确认',
  content: '',
  confirmText: '确认',
  cancelText: '取消',
  variant: 'info',
})

/**
 * 弹出确认框，返回 Promise<boolean>，确认 true / 取消 false
 * 用法：const ok = await confirm({ content: '删除？', danger: true })
 */
export function confirm(options: ConfirmOptions | string): Promise<boolean> {
  const opts: ConfirmOptions = typeof options === 'string' ? { content: options } : options
  state.value = {
    visible: true,
    title: opts.title ?? '请确认',
    content: opts.content,
    confirmText: opts.confirmText ?? '确认',
    cancelText: opts.cancelText ?? '取消',
    variant: opts.danger ? 'danger' : (opts.variant ?? 'info'),
  }
  return new Promise<boolean>(resolve => {
    state.value.resolve = resolve
  })
}

/** 内部用：组件调用，resolve 并关闭 */
export function resolveConfirm(value: boolean) {
  const s = state.value
  s.visible = false
  s.resolve?.(value)
  s.resolve = undefined
}

export function useConfirmState() {
  return state
}
