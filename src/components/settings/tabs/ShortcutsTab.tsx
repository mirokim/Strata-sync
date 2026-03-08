// ── ShortcutsTab — keyboard shortcut reference ───────────────────────────────

interface ShortcutRow {
  keys: string[]
  desc: string
}

interface ShortcutGroup {
  label: string
  rows: ShortcutRow[]
}

const GROUPS: ShortcutGroup[] = [
  {
    label: 'Editor',
    rows: [
      { keys: ['Ctrl', 'S'],           desc: 'Save' },
      { keys: ['Ctrl', 'B'],           desc: 'Bold' },
      { keys: ['Ctrl', 'I'],           desc: 'Italic' },
      { keys: ['Ctrl', 'Shift', 'S'],  desc: 'Strikethrough' },
      { keys: ['Ctrl', 'Shift', 'H'],  desc: 'Highlight' },
      { keys: ['Ctrl', 'Shift', 'C'],  desc: 'Inline Code' },
      { keys: ['Ctrl', 'Z'],           desc: 'Undo' },
      { keys: ['Ctrl', 'Y'],           desc: 'Redo' },
      { keys: ['Ctrl', 'A'],           desc: 'Select All' },
    ],
  },
  {
    label: 'Chat',
    rows: [
      { keys: ['Enter'],              desc: 'Send message' },
      { keys: ['Shift', 'Enter'],     desc: 'New line' },
    ],
  },
  {
    label: 'Graph',
    rows: [
      { keys: ['Scroll'],             desc: 'Zoom in / out' },
      { keys: ['Drag'],               desc: 'Pan view' },
      { keys: ['Click'],              desc: 'Select node' },
      { keys: ['Double Click'],       desc: 'Open node in editor' },
    ],
  },
  {
    label: 'General',
    rows: [
      { keys: ['Escape'],             desc: 'Close popup / menu' },
    ],
  },
]

function Kbd({ children }: { children: string }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '1px 6px',
      borderRadius: 4,
      fontSize: 10,
      fontFamily: 'ui-monospace, monospace',
      background: 'var(--color-bg-active)',
      border: '1px solid var(--color-border)',
      color: 'var(--color-text-primary)',
      lineHeight: 1.8,
    }}>
      {children}
    </span>
  )
}

export default function ShortcutsTab() {
  const row: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '5px 0',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
    gap: 12,
  }

  const sectionTitle: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 600,
    color: 'var(--color-text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '0.07em',
    marginBottom: 6,
  }

  return (
    <div className="flex flex-col gap-6">
      {GROUPS.map(group => (
        <div key={group.label}>
          <p style={sectionTitle}>{group.label}</p>
          {group.rows.map(({ keys, desc }) => (
            <div key={desc} style={row}>
              <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{desc}</span>
              <div style={{ display: 'flex', gap: 3, alignItems: 'center', flexShrink: 0 }}>
                {keys.map((k, i) => (
                  <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                    {i > 0 && <span style={{ fontSize: 9, color: 'var(--color-text-muted)', opacity: 0.5 }}>+</span>}
                    <Kbd>{k}</Kbd>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
