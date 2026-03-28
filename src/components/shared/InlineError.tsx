import { AlertCircle } from 'lucide-react'

interface Props {
  message: string | null | undefined
  className?: string
}

/** 인라인 에러 메시지 — 다크 테마 CSS 변수 기반, role="alert" 접근성 포함 */
export default function InlineError({ message, className }: Props) {
  if (!message) return null
  return (
    <p
      className={`flex items-center gap-1 text-xs mt-2 ${className ?? ''}`}
      style={{ color: 'var(--color-error, #f87171)' }}
      role="alert"
    >
      <AlertCircle size={11} aria-hidden />
      {message}
    </p>
  )
}
