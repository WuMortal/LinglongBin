import { ref, reactive } from 'vue'

type Rule = (v: unknown) => string | true

interface FieldConfig {
  label: string
  rules?: Rule[]
}

export function useFormValidation<T extends Record<string, unknown>>(fields: {
  [K in keyof T]?: FieldConfig
}) {
  const errors = reactive<Record<string, string>>({})

  function validate(data: T): boolean {
    let valid = true
    for (const key in fields) {
      const cfg = fields[key]
      if (!cfg?.rules?.length) continue
      for (const rule of cfg.rules) {
        const result = rule(data[key])
        if (result !== true) {
          errors[key] = result
          valid = false
          break
        }
      }
      if (!errors[key]) errors[key] = ''
    }
    return valid
  }

  function validateField(key: keyof T, value: unknown): boolean {
    const cfg = fields[key]
    if (!cfg?.rules?.length) { errors[key as string] = ''; return true }
    for (const rule of cfg.rules) {
      const result = rule(value)
      if (result !== true) {
        errors[key as string] = result
        return false
      }
    }
    errors[key as string] = ''
    return true
  }

  function clear() {
    for (const key in fields) errors[key] = ''
  }

  return { errors, validate, validateField, clear }
}

// 内置规则
export const rules = {
  required: (label: string): Rule => (v) => {
    if (v === null || v === undefined) return `${label}必填`
    if (typeof v === 'string' && !v.trim()) return `${label}必填`
    if (typeof v === 'number' && isNaN(v)) return `${label}必填`
    return true
  },
  min: (label: string, min: number): Rule => (v) => {
    const n = Number(v)
    if (isNaN(n) || n < min) return `${label}不能小于 ${min}`
    return true
  },
  max: (label: string, max: number): Rule => (v) => {
    const n = Number(v)
    if (isNaN(n) || n > max) return `${label}不能大于 ${max}`
    return true
  },
  pattern: (label: string, re: RegExp, hint: string): Rule => (v) => {
    if (!v) return true
    if (typeof v === 'string' && !re.test(v)) return `${label}格式不正确${hint ? '：' + hint : ''}`
    return true
  },
}
