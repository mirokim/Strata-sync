import { AlertCircle } from 'lucide-react'

interface Props {
  message: string | null | undefined
  className?: string
}

/** Inline error message — dark theme CSS variable based, includes role="alert" accessibility */
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
