import type { EditAgentLogEntry } from '@/stores/editAgentStore'

interface Props { entry: EditAgentLogEntry }

// Dot colors sourced from CSS variables (defined in index.css :root)
const ACTION_DOT: Record<string, string> = {
  wake:       'var(--ea-log-wake)',
  diff_check: 'var(--ea-log-scan)',
  file_edit:  'var(--ea-log-edit)',
  file_skip:  'var(--ea-log-skip)',
  error:      'var(--ea-log-error)',
  chat:       'var(--ea-log-chat)',
  done:       'var(--ea-log-done)',
}

const ACTION_LABEL: Record<string, string> = {
  wake:       'wake',
  diff_check: 'scan',
  file_edit:  'edit',
  file_skip:  'skip',
  error:      'error',
  chat:       'chat',
  done:       'done',
}

const MONO = 'var(--ea-font-mono)'

export default function EditAgentLogEntryRow({ entry }: Props) {
  const dot   = ACTION_DOT[entry.action]   ?? ACTION_DOT.error
  const label = ACTION_LABEL[entry.action] ?? entry.action
  const time  = new Date(entry.timestamp).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  })

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '46px 40px 1fr',
      gap: '0 6px',
      padding: '5px 10px',
      borderBottom: '1px solid var(--color-border)',
      fontSize: 11, lineHeight: 1.45,
      transition: 'background 0.08s',
    }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = 'var(--color-bg-hover)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
    >
      {/* Timestamp */}
      <span style={{
        fontFamily: MONO, fontSize: 10,
        color: 'var(--color-text-muted)',
        paddingTop: 1, whiteSpace: 'nowrap',
      }}>
        {time}
      </span>

      {/* Action badge */}
      <span style={{
        display: 'flex', alignItems: 'center', gap: 4,
        paddingTop: 1,
        fontFamily: MONO, fontSize: 10, fontWeight: 600,
        color: dot, whiteSpace: 'nowrap',
        letterSpacing: '0.02em',
      }}>
        <span style={{
          width: 5, height: 5, borderRadius: '50%',
          background: dot, flexShrink: 0,
        }} />
        {label}
      </span>

      {/* Content */}
      <div style={{ minWidth: 0, paddingTop: 1 }}>
        {entry.file && (
          <div style={{
            fontFamily: MONO, fontSize: 10,
            color: 'var(--color-text-muted)',
            marginBottom: 1,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {entry.file}
          </div>
        )}
        <span style={{ color: 'var(--color-text-secondary)', fontSize: 11 }}>
          {entry.detail}
        </span>
        {entry.tokensUsed != null && (
          <span style={{
            marginLeft: 6, fontFamily: MONO, fontSize: 10,
            color: 'var(--color-text-muted)',
          }}>
            {entry.tokensUsed.toLocaleString()}t
          </span>
        )}
      </div>
    </div>
  )
}
