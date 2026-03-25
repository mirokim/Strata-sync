import { useUIStore } from '@/stores/uiStore'
import { useEditAgentStore } from '@/stores/editAgentStore'
import EditAgentChat from './EditAgentChat'
import EditAgentLog from './EditAgentLog'
import ErrorBoundary from '@/components/shared/ErrorBoundary'
import { MessageSquare, ScrollText, X } from 'lucide-react'

export default function EditAgentPanel() {
  const subTab    = useUIStore(s => s.editAgentSubTab)
  const setSubTab = useUIStore(s => s.setEditAgentSubTab)
  const toggle    = useUIStore(s => s.toggleEditAgentPanel)
  const isRunning = useEditAgentStore(s => s.isRunning)

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: 'var(--color-bg-secondary)',
      borderLeft: '1px solid var(--color-border)',
    }}>

      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center',
        height: 36, padding: '0 4px 0 12px',
        borderBottom: '1px solid var(--color-border)',
        flexShrink: 0, gap: 2,
      }}>
        {/* Title */}
        <span style={{
          fontSize: 11, fontWeight: 600, letterSpacing: '0.04em',
          color: 'var(--color-text-muted)', textTransform: 'uppercase',
          flex: 1,
        }}>
          Edit Agent
        </span>

        {/* Running indicator */}
        {isRunning && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            fontSize: 10, fontWeight: 500,
            color: 'var(--color-accent)',
            marginRight: 6,
          }}>
            <span style={{
              width: 5, height: 5, borderRadius: '50%',
              background: 'var(--color-accent)',
              animation: 'ea-pulse 1.4s ease-in-out infinite',
              flexShrink: 0,
            }} />
            running
          </span>
        )}

        {/* Tabs */}
        {(['chat', 'log'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setSubTab(tab)}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '0 9px', height: 36, border: 'none',
              borderBottom: subTab === tab
                ? '1px solid var(--color-text-primary)'
                : '1px solid transparent',
              background: 'transparent',
              color: subTab === tab
                ? 'var(--color-text-primary)'
                : 'var(--color-text-muted)',
              cursor: 'pointer', fontSize: 11, fontWeight: 500,
              transition: 'color 0.12s',
            }}
          >
            {tab === 'chat' ? <MessageSquare size={11} /> : <ScrollText size={11} />}
            {tab === 'chat' ? 'Chat' : 'Log'}
          </button>
        ))}

        {/* Close */}
        <button
          onClick={toggle}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 26, height: 26, borderRadius: 5, border: 'none',
            background: 'transparent', color: 'var(--color-text-muted)',
            cursor: 'pointer', marginLeft: 2, flexShrink: 0,
            transition: 'background 0.12s, color 0.12s',
          }}
          onMouseEnter={e => {
            const b = e.currentTarget
            b.style.background = 'var(--color-bg-hover)'
            b.style.color = 'var(--color-text-primary)'
          }}
          onMouseLeave={e => {
            const b = e.currentTarget
            b.style.background = 'transparent'
            b.style.color = 'var(--color-text-muted)'
          }}
        >
          <X size={13} />
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
        <ErrorBoundary>
          {subTab === 'chat' ? <EditAgentChat /> : <EditAgentLog />}
        </ErrorBoundary>
      </div>

      <style>{`
        @keyframes ea-pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.35; }
        }
      `}</style>
    </div>
  )
}
