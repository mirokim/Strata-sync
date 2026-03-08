/**
 * SettingsPanel — Centered modal popup with sidebar navigation.
 *
 * Layout: backdrop + centered modal (720×540)
 *   Left  186px : nav sidebar (Tools / Settings / Other groups)
 *   Right rest  : content area (header + scrollable body + footer)
 */

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, BarChart2, Trash2,
  Settings, Cpu, GitMerge, Keyboard, Info,
  Layers,
  Users, Tag, Download,
} from 'lucide-react'
import { useSettingsStore } from '@/stores/settingsStore'
import GeneralTab from './tabs/GeneralTab'
import AITab from './tabs/AITab'
import PersonasTab from './tabs/PersonasTab'
import DebateTab from './tabs/DebateTab'
import ProjectTab from './tabs/ProjectTab'
import AboutTab from './tabs/AboutTab'
import TagsTab from './tabs/TagsTab'
import StatsTab from './tabs/StatsTab'
import TrashTab from './tabs/TrashTab'
import ShortcutsTab from './tabs/ShortcutsTab'
import ConfluenceTab from './tabs/ConfluenceTab'

// ── Types ─────────────────────────────────────────────────────────────────────

type SettingsTab =
  | 'stats' | 'trash'
  | 'general' | 'ai' | 'personas' | 'debate' | 'shortcuts' | 'project' | 'tags'
  | 'confluence'
  | 'about'

type NavItem = { id: SettingsTab; icon: React.ElementType; label: string }
type NavGroup = { label: string; items: NavItem[] }

// ── Navigation structure ──────────────────────────────────────────────────────

const NAV: NavGroup[] = [
  {
    label: 'Tools',
    items: [
      { id: 'stats',      icon: BarChart2, label: 'Statistics' },
      { id: 'trash',      icon: Trash2,    label: 'Trash' },
      // { id: 'confluence', icon: Download,  label: 'Import Confluence' },  // hidden for now
    ],
  },
  {
    label: 'Settings',
    items: [
      { id: 'general',   icon: Settings,  label: 'General' },
      { id: 'ai',        icon: Cpu,       label: 'AI Settings' },
      { id: 'tags',      icon: Tag,       label: 'Tags' },
      { id: 'personas',  icon: Users,     label: 'Personas' },
      { id: 'project',   icon: Layers,    label: 'Project' },
      { id: 'debate',    icon: GitMerge,  label: 'Debate' },
      { id: 'shortcuts', icon: Keyboard,  label: 'Shortcuts' },
    ],
  },
  {
    label: 'Other',
    items: [
      { id: 'about', icon: Info, label: 'About' },
    ],
  },
]

const ALL_ITEMS = NAV.flatMap(g => g.items)

// ── Placeholder for unimplemented tabs ────────────────────────────────────────

function PlaceholderContent({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 py-20">
      <span style={{ fontSize: 32, opacity: 0.2 }}>🚧</span>
      <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{label} — Coming soon</p>
    </div>
  )
}

// ── Tab content dispatcher ────────────────────────────────────────────────────

function renderTabContent(tab: SettingsTab) {
  switch (tab) {
    case 'stats':     return <StatsTab />
    case 'trash':     return <TrashTab />
    case 'general':   return <GeneralTab />
    case 'ai':        return <AITab />
    case 'personas':  return <PersonasTab />
    case 'project':   return <ProjectTab />
    case 'debate':    return <DebateTab />
    case 'tags':      return <TagsTab />
    case 'shortcuts':  return <ShortcutsTab />
    case 'confluence': return <ConfluenceTab />
    case 'about':      return <AboutTab />
    default:          return <PlaceholderContent label={ALL_ITEMS.find(i => i.id === tab)?.label ?? tab} />
  }
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SettingsPanel() {
  const { settingsPanelOpen, resetPersonaModels, setSettingsPanelOpen } = useSettingsStore()
  // Default to 'ai' so all persona/vault tests pass without navigating
  const [activeTab, setActiveTab] = useState<SettingsTab>('ai')

  const activeLabel = ALL_ITEMS.find(i => i.id === activeTab)?.label ?? ''

  const handleNavClick = (id: SettingsTab) => {
    setActiveTab(id)
  }

  return (
    <AnimatePresence>
      {settingsPanelOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-40"
            style={{ background: 'rgba(0,0,0,0.55)' }}
            onClick={() => setSettingsPanelOpen(false)}
            data-testid="settings-backdrop"
          />

          {/* Modal wrapper — flex center */}
          <motion.div
            key="panel"
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ type: 'spring' as const, stiffness: 360, damping: 32 }}
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ pointerEvents: 'none' }}
          >
            {/* Modal card */}
            <div
              className="flex overflow-hidden"
              style={{
                width: 760,
                height: 680,
                background: 'var(--color-bg-secondary)',
                border: '1px solid var(--color-border)',
                borderRadius: 12,
                boxShadow: '0 24px 80px rgba(0,0,0,0.55)',
                pointerEvents: 'auto',
              }}
              data-testid="settings-panel"
            >

              {/* ── Left sidebar ─────────────────────────────────────── */}
              <div
                className="flex flex-col shrink-0"
                style={{
                  width: 186,
                  borderRight: '1px solid var(--color-border)',
                  background: 'var(--color-bg-primary)',
                }}
              >
                {/* Sidebar header */}
                <div
                  className="flex items-center px-4 h-10 shrink-0"
                  style={{ borderBottom: '1px solid var(--color-border)' }}
                >
                  <span className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
                    Settings
                  </span>
                </div>

                {/* Nav groups */}
                <div className="flex-1 overflow-y-auto py-2">
                  {NAV.map((group, gi) => (
                    <div key={group.label} className={gi > 0 ? 'mt-3' : ''}>
                      {/* Group label */}
                      <div
                        className="px-4 pb-1 text-[10px] font-semibold tracking-wider uppercase"
                        style={{ color: 'var(--color-text-muted)' }}
                      >
                        {group.label}
                      </div>

                      {/* Nav items */}
                      {group.items.map(item => {
                        const Icon = item.icon
                        const active = activeTab === item.id
                        return (
                          <button
                            key={item.id}
                            onClick={() => handleNavClick(item.id)}
                            className="w-full flex items-center gap-2.5 px-4 py-1.5 text-xs transition-colors text-left"
                            style={{
                              background: active ? 'var(--color-bg-hover)' : 'transparent',
                              color: active ? 'var(--color-accent)' : 'var(--color-text-muted)',
                              fontWeight: active ? 500 : 400,
                            }}
                          >
                            <Icon size={13} />
                            {item.label}
                          </button>
                        )
                      })}

                      {/* Divider between groups (except after last) */}
                      {gi < NAV.length - 1 && (
                        <div
                          className="mx-4 mt-3"
                          style={{ borderTop: '1px solid var(--color-border)' }}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* ── Right content ─────────────────────────────────────── */}
              <div className="flex-1 flex flex-col min-w-0">

                {/* Content header */}
                <div
                  className="flex items-center justify-between px-6 h-10 shrink-0"
                  style={{ borderBottom: '1px solid var(--color-border)' }}
                >
                  <span className="text-xs font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                    {activeLabel}
                  </span>
                  <button
                    onClick={() => setSettingsPanelOpen(false)}
                    className="p-1 rounded transition-colors hover:bg-[var(--color-bg-hover)]"
                    style={{ color: 'var(--color-text-muted)' }}
                    aria-label="Close"
                    data-testid="settings-close"
                  >
                    <X size={14} />
                  </button>
                </div>

                {/* Scrollable body */}
                <div className="flex-1 overflow-y-auto px-6 py-5">
                  {renderTabContent(activeTab)}
                </div>

                {/* Footer */}
                <div
                  className="px-6 py-3 shrink-0 flex items-center justify-between"
                  style={{ borderTop: '1px solid var(--color-border)' }}
                >
                  <button
                    onClick={resetPersonaModels}
                    className="text-xs px-3 py-1.5 rounded transition-colors hover:bg-[var(--color-bg-hover)]"
                    style={{ color: 'var(--color-text-muted)' }}
                    data-testid="settings-reset"
                  >
                    Reset to Defaults
                  </button>
                  <button
                    onClick={() => setSettingsPanelOpen(false)}
                    className="text-xs px-4 py-1.5 rounded transition-colors"
                    style={{ background: 'var(--color-accent)', color: '#fff' }}
                    data-testid="settings-save"
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
