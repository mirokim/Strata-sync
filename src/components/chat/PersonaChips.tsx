import { SPEAKER_CONFIG } from '@/lib/speakerConfig'

export default function PersonaChips() {
  const { label, color } = SPEAKER_CONFIG['chief_director']

  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 4 }}
      data-testid="persona-chips"
    >
      <span
        data-testid="persona-chip-chief_director"
        data-active="true"
        style={{
          border: `1px solid ${color}`,
          color,
          background: color + '18',
          borderRadius: 2,
          padding: '2px 8px',
          fontSize: 11,
          fontWeight: 500,
        }}
      >
        {label}
      </span>
    </div>
  )
}
