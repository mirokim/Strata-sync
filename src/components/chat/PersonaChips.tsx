import { useChatStore } from '@/stores/chatStore'
import { SPEAKER_CONFIG, SPEAKER_IDS } from '@/lib/speakerConfig'

export default function PersonaChips() {
  const { activePersonas, togglePersona } = useChatStore()

  return (
    <div
      style={{ display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: 'center' }}
      data-testid="persona-chips"
    >
      {SPEAKER_IDS.map(id => {
        const { label, color } = SPEAKER_CONFIG[id]
        const active = activePersonas.includes(id)
        return (
          <button
            key={id}
            onClick={() => togglePersona(id)}
            data-testid={`persona-chip-${id}`}
            data-active={active ? 'true' : undefined}
            style={{
              border: `1px solid ${active ? color : 'var(--color-border)'}`,
              color: active ? color : 'var(--color-text-muted)',
              background: active ? color + '18' : 'transparent',
              borderRadius: 5,
              padding: '2px 8px',
              fontSize: 11,
              fontWeight: active ? 500 : 400,
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
