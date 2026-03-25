import { Globe, Sun, Moon, Monitor, Zap } from 'lucide-react'
import { useSettingsStore, type ParagraphRenderQuality } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'
import type { ThemeId } from '@/types'
import VaultSelector from '../VaultSelector'

const THEMES: { id: ThemeId; label: string; Icon: React.ElementType }[] = [
  { id: 'white', label: 'Light',    Icon: Sun     },
  { id: 'dark',  label: 'Dark',     Icon: Moon    },
  { id: 'oled',  label: 'OLED Black', Icon: Monitor },
]

const PARAGRAPH_QUALITIES: { id: ParagraphRenderQuality; label: string; desc: string }[] = [
  { id: 'high',   label: 'High',   desc: 'Markdown + Wikilinks' },
  { id: 'medium', label: 'Medium', desc: 'Markdown only' },
  { id: 'fast',   label: 'Fast',   desc: 'Plain text' },
]

export default function GeneralTab() {
  const { theme, setTheme } = useUIStore()
  const { editorDefaultLocked, setEditorDefaultLocked, paragraphRenderQuality, setParagraphRenderQuality, showNodeLabels, toggleNodeLabels } = useSettingsStore()

  return (
    <div className="flex flex-col gap-7">

      {/* Language */}
      <section>
        <div className="flex items-center gap-1.5 mb-3">
          <Globe size={13} style={{ color: 'var(--color-text-muted)' }} />
          <h3 className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Language</h3>
        </div>
        <div className="flex gap-2">
          {([
            { code: 'kr', flag: 'KR', label: 'Korean' },
            { code: 'en', flag: 'US', label: 'English' },
          ] as const).map(lang => (
            <button
              key={lang.code}
              className="flex-1 px-3 py-2 rounded-lg text-xs transition-colors"
              style={{
                border: `1.5px solid ${lang.code === 'en' ? 'var(--color-accent)' : 'var(--color-border)'}`,
                background: 'transparent',
                color: lang.code === 'en' ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
              }}
            >
              <span className="font-semibold mr-1.5">{lang.flag}</span>
              {lang.label}
            </button>
          ))}
        </div>
      </section>

      {/* Theme */}
      <section>
        <h3 className="text-xs font-semibold mb-3" style={{ color: 'var(--color-text-secondary)' }}>Theme</h3>
        <div className="grid grid-cols-3 gap-2">
          {THEMES.map(({ id, label, Icon }) => {
            const active = theme === id
            return (
              <button
                key={id}
                onClick={() => setTheme(id)}
                className="flex flex-col items-center gap-2 py-4 rounded-lg transition-colors"
                style={{
                  border: `1.5px solid ${active ? 'var(--color-accent)' : 'var(--color-border)'}`,
                  background: active ? 'rgba(59,130,246,0.08)' : 'transparent',
                  color: active ? 'var(--color-accent)' : 'var(--color-text-muted)',
                }}
              >
                <Icon size={18} />
                <span className="text-xs">{label}</span>
              </button>
            )
          })}
        </div>
      </section>

      {/* Editor */}
      <section>
        <h3 className="text-xs font-semibold mb-3" style={{ color: 'var(--color-text-secondary)' }}>Editor</h3>
        <div
          className="flex items-center justify-between px-3 py-2.5 rounded-lg"
          style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)' }}
        >
          <div>
            <div className="text-xs" style={{ color: 'var(--color-text-primary)' }}>Default Edit Lock</div>
            <div className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
              Open documents in read-only mode by default
            </div>
          </div>
          <button
            role="switch"
            aria-checked={editorDefaultLocked}
            onClick={() => setEditorDefaultLocked(!editorDefaultLocked)}
            className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors"
            style={{ background: editorDefaultLocked ? 'var(--color-accent)' : 'var(--color-border)' }}
          >
            <span
              className="inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform"
              style={{ transform: editorDefaultLocked ? 'translateX(18px)' : 'translateX(2px)' }}
            />
          </button>
        </div>
      </section>

      {/* Graph */}
      <section>
        <h3 className="text-xs font-semibold mb-3" style={{ color: 'var(--color-text-secondary)' }}>Graph</h3>
        <div
          className="flex items-center justify-between px-3 py-2.5 rounded-lg"
          style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)' }}
        >
          <div>
            <div className="text-xs" style={{ color: 'var(--color-text-primary)' }}>Show Node Labels</div>
            <div className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
              Always show node names in the graph
            </div>
          </div>
          <button
            role="switch"
            aria-checked={showNodeLabels}
            onClick={toggleNodeLabels}
            className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors"
            style={{ background: showNodeLabels ? 'var(--color-accent)' : 'var(--color-border)' }}
          >
            <span
              className="inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform"
              style={{ transform: showNodeLabels ? 'translateX(18px)' : 'translateX(2px)' }}
            />
          </button>
        </div>
      </section>

      {/* Document Viewer Rendering */}
      <section>
        <div className="flex items-center gap-1.5 mb-3">
          <Zap size={13} style={{ color: 'var(--color-text-muted)' }} />
          <h3 className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Document Rendering Quality</h3>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {PARAGRAPH_QUALITIES.map(({ id, label, desc }) => {
            const active = paragraphRenderQuality === id
            return (
              <button
                key={id}
                onClick={() => setParagraphRenderQuality(id)}
                className="flex flex-col items-center gap-1.5 py-3 rounded-lg transition-colors"
                style={{
                  border: `1.5px solid ${active ? 'var(--color-accent)' : 'var(--color-border)'}`,
                  background: active ? 'rgba(59,130,246,0.08)' : 'transparent',
                  color: active ? 'var(--color-accent)' : 'var(--color-text-muted)',
                }}
              >
                <span className="text-xs font-semibold">{label}</span>
                <span className="text-[10px] opacity-70">{desc}</span>
              </button>
            )
          })}
        </div>
      </section>

      {/* Vault Path */}
      <section data-testid="vault-section">
        <h3 className="text-xs font-semibold mb-3" style={{ color: 'var(--color-text-secondary)' }}>Vault Path</h3>
        <VaultSelector />
      </section>
    </div>
  )
}
