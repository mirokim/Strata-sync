/**
 * Toast notification renderer.
 * Mounts in bottom-right above the StatusBar.
 * Auto-dismisses each toast after its durationMs.
 */
import { useEffect } from 'react'
import { useToastStore, type ToastItem } from '@/stores/toastStore'
import { CheckCircle, XCircle, Info, AlertTriangle, X } from 'lucide-react'

const TYPE_CONFIG: Record<ToastItem['type'], {
  icon: React.ReactNode
  border: string
  iconColor: string
}> = {
  success: { icon: <CheckCircle size={14} />, border: 'rgba(34,197,94,0.4)',   iconColor: 'var(--color-success)' },
  error:   { icon: <XCircle size={14} />,     border: 'rgba(239,68,68,0.4)',    iconColor: 'var(--color-error)' },
  warn:    { icon: <AlertTriangle size={14} />,border: 'rgba(245,158,11,0.4)', iconColor: 'var(--color-warning)' },
  info:    { icon: <Info size={14} />,         border: 'rgba(96,165,250,0.4)',  iconColor: 'var(--color-info)' },
}

function Toast({ toast }: { toast: ToastItem }) {
  const removeToast = useToastStore(s => s.removeToast)
  const cfg = TYPE_CONFIG[toast.type]

  useEffect(() => {
    const timer = setTimeout(() => removeToast(toast.id), toast.durationMs)
    return () => clearTimeout(timer)
  }, [toast.id, toast.durationMs, removeToast])

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        padding: '9px 12px',
        background: 'rgba(15,23,42,0.95)',
        border: `1px solid ${cfg.border}`,
        borderRadius: 8,
        boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        fontSize: 12,
        color: 'var(--color-text-primary)',
        maxWidth: 320,
        minWidth: 200,
        backdropFilter: 'blur(8px)',
        animation: 'toastSlideIn 0.18s ease-out',
      }}
    >
      <span style={{ color: cfg.iconColor, flexShrink: 0, marginTop: 1 }}>
        {cfg.icon}
      </span>
      <span style={{ flex: 1, lineHeight: 1.5 }}>{toast.message}</span>
      <button
        onClick={() => removeToast(toast.id)}
        style={{
          display: 'flex', alignItems: 'center',
          padding: 2, border: 'none', borderRadius: 3,
          background: 'transparent',
          color: 'rgba(148,163,184,0.5)',
          cursor: 'pointer', flexShrink: 0,
        }}
        onMouseEnter={e => (e.currentTarget.style.color = '#94a3b8')}
        onMouseLeave={e => (e.currentTarget.style.color = 'rgba(148,163,184,0.5)')}
      >
        <X size={12} />
      </button>
    </div>
  )
}

export default function ToastContainer() {
  const toasts = useToastStore(s => s.toasts)

  if (toasts.length === 0) return null

  return (
    <>
      <style>{`
        @keyframes toastSlideIn {
          from { opacity: 0; transform: translateX(16px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>
      <div
        style={{
          position: 'fixed',
          bottom: 36, // above status bar
          right: 16,
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          pointerEvents: 'auto',
        }}
      >
        {toasts.map(t => <Toast key={t.id} toast={t} />)}
      </div>
    </>
  )
}
