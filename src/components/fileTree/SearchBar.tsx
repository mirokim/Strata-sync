import { Search, X } from 'lucide-react'

interface SearchBarProps {
  value: string
  onChange: (v: string) => void
}

export default function SearchBar({ value, onChange }: SearchBarProps) {
  return (
    <div
      className="flex items-center gap-2 px-3 py-2 mx-2 my-1 rounded"
      style={{ background: 'var(--color-bg-hover)', border: '1px solid var(--color-border)' }}
    >
      <Search size={12} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Search documents..."
        className="flex-1 bg-transparent outline-none text-xs min-w-0"
        style={{ color: 'var(--color-text-primary)' }}
        aria-label="Search documents"
      />
      {value && (
        <button
          onClick={() => onChange('')}
          aria-label="Clear search"
          style={{ color: 'var(--color-text-muted)' }}
          className="hover:text-[var(--color-text-secondary)]"
        >
          <X size={11} />
        </button>
      )}
    </div>
  )
}
