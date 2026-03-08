import { DebateSettingsContent } from '@/components/chat/debate/DebateSettingsContent'

export default function DebateTab() {
  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Debate Settings</h3>
      <DebateSettingsContent />
    </div>
  )
}
