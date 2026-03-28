/**
 * DebateSettingsContent — Debate configuration UI for SettingsPanel.
 * Participants are personas (chief_director, art_director, …), not raw providers.
 * A persona is "enabled" when its assigned model's provider has an API key configured.
 */
import { useMemo, useRef } from 'react'
import { AlertCircle, FileText, Upload, X } from 'lucide-react'
import { useDebateStore } from '@/stores/debateStore'
import { useSettingsStore, getApiKey } from '@/stores/settingsStore'
import { getProviderForModel } from '@/lib/modelConfig'
import { SPEAKER_IDS, SPEAKER_CONFIG } from '@/lib/speakerConfig'
import { generateId } from '@/lib/utils'
import { MAX_FILE_SIZE } from '@/lib/constants'
import {
  ROLE_OPTIONS,
  ROLE_GROUPS,
} from '@/services/debateRoles'
import type { DiscussionMode, ReferenceFile } from '@/types'

/** All participant candidates — the 5 director personas */
const ALL_PERSONAS = SPEAKER_IDS

const DEBATE_MODES: DiscussionMode[] = ['roundRobin', 'freeDiscussion', 'roleAssignment', 'battle']

const MODE_LABELS: Record<DiscussionMode, string> = {
  roundRobin: 'Round Robin',
  freeDiscussion: 'Free Discussion',
  roleAssignment: 'Role Assignment',
  battle: 'Battle Mode',
}

const MODE_DESCRIPTIONS: Record<DiscussionMode, string> = {
  roundRobin: 'AIs take turns speaking in order',
  freeDiscussion: 'AIs freely rebut or agree with each other',
  roleAssignment: 'Each AI is assigned a character/role for the debate',
  battle: '2 AIs compete and 1 acts as judge to score',
}

const DELAY_OPTIONS = [5, 10, 15, 30] as const
const REF_MAX_LENGTH = 10_000
const MAX_FILES = 5
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf']
const ACCEPTED_EXTENSIONS = '.png,.jpg,.jpeg,.gif,.webp,.pdf'

const ROLE_LABEL_MAP = new Map(ROLE_OPTIONS.map((r) => [r.value, r.label]))

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export function DebateSettingsContent() {
  const settings = useDebateStore((s) => s.settings)
  const updateSettings = useDebateStore((s) => s.updateSettings)
  const toggleProvider = useDebateStore((s) => s.toggleProvider)
  const updateRole = useDebateStore((s) => s.updateRole)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const {
    mode, maxRounds, selectedProviders, roles, judgeProvider,
    useReference, referenceText, referenceFiles, pacingMode, autoDelay,
  } = settings

  // Personas whose assigned model's provider has an API key set
  const apiKeys = useSettingsStore(s => s.apiKeys)
  const personaModels = useSettingsStore(s => s.personaModels)
  const enabledProviders = useMemo(
    () => ALL_PERSONAS.filter((p) => {
      const model = (personaModels as Record<string, string>)[p]
      if (!model) return false
      const provider = getProviderForModel(model)
      if (!provider) return false
      return Boolean(getApiKey(provider))
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [apiKeys, personaModels],
  )

  const handleFileUpload = async (fileList: FileList | null) => {
    if (!fileList) return
    const newFiles: ReferenceFile[] = []
    for (const file of Array.from(fileList)) {
      if (!ACCEPTED_TYPES.includes(file.type)) continue
      if (file.size > MAX_FILE_SIZE) continue
      if (referenceFiles.length + newFiles.length >= MAX_FILES) break
      const dataUrl = await readFileAsDataUrl(file)
      newFiles.push({ id: generateId(), filename: file.name, mimeType: file.type, size: file.size, dataUrl })
    }
    updateSettings({ referenceFiles: [...referenceFiles, ...newFiles] })
  }

  const removeFile = (id: string) => {
    updateSettings({ referenceFiles: referenceFiles.filter((f) => f.id !== id) })
  }

  const sectionLabel = (text: string) => (
    <label className="block text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-text-muted)' }}>
      {text}
    </label>
  )

  const modeBtn = (m: DiscussionMode) => (
    <button
      key={m}
      onClick={() => updateSettings({ mode: m })}
      className="px-3 py-2 text-xs rounded-lg transition-all"
      style={
        mode === m
          ? { background: 'rgba(82,156,202,0.1)', border: '1px solid rgba(82,156,202,0.4)', color: 'var(--color-accent)', fontWeight: 600 }
          : { background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }
      }
    >
      {MODE_LABELS[m]}
    </button>
  )

  return (
    <div className="space-y-6">
      <p className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
        Configure debate mode, participating AIs, roles, number of rounds, and more.
      </p>

      {/* Mode Selection */}
      <div>
        {sectionLabel('Debate Mode')}
        <div className="grid grid-cols-2 gap-1.5">
          {DEBATE_MODES.map(modeBtn)}
        </div>
        <p className="text-[11px] mt-1.5 pl-0.5" style={{ color: 'var(--color-text-muted)' }}>
          {MODE_DESCRIPTIONS[mode]}
        </p>
      </div>

      {/* Participants */}
      <div>
        {sectionLabel('Select Participating AIs')}
        {enabledProviders.length < 2 && (
          <div
            className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg mb-2"
            style={{ background: 'rgba(255,152,0,0.1)', color: '#ff9800' }}
          >
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>Set API keys for 2 or more personas in AI Settings</span>
          </div>
        )}
        {mode === 'battle' && selectedProviders.length >= 2 && selectedProviders.length < 3 && (
          <div
            className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg mb-2"
            style={{ background: 'rgba(255,152,0,0.1)', color: '#ff9800' }}
          >
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>Battle mode requires 3 AIs (2 debaters + 1 judge)</span>
          </div>
        )}
        <div className="flex flex-wrap gap-1.5">
          {enabledProviders.map((p) => {
            const selected = selectedProviders.includes(p)
            const meta = SPEAKER_CONFIG[p]
            return (
              <button
                key={p}
                onClick={() => toggleProvider(p)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-all"
                style={
                  selected
                    ? {
                        background: `${meta.color}12`,
                        border: `1px solid ${meta.color}60`,
                        color: meta.color,
                        fontWeight: 600,
                      }
                    : {
                        background: 'var(--color-bg-surface)',
                        border: '1px solid var(--color-border)',
                        color: 'var(--color-text-secondary)',
                      }
                }
              >
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: meta.color }} />
                {meta.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Judge Selection (Battle Mode) */}
      {mode === 'battle' && selectedProviders.length >= 3 && (
        <div>
          {sectionLabel('Select Judge AI')}
          <div className="flex flex-wrap gap-1.5">
            {selectedProviders.map((p) => {
              const isJudge = judgeProvider === p
              const meta = SPEAKER_CONFIG[p as keyof typeof SPEAKER_CONFIG]
              return (
                <button
                  key={p}
                  onClick={() => updateSettings({ judgeProvider: p })}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-all"
                  style={
                    isJudge
                      ? { background: 'rgba(255,152,0,0.1)', border: '1px solid rgba(255,152,0,0.4)', color: '#ff9800', fontWeight: 600 }
                      : { background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }
                  }
                >
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: meta?.color ?? '#888' }} />
                  {meta?.label ?? p}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Role Assignment */}
      {(mode === 'roleAssignment' || mode === 'battle') && selectedProviders.length > 0 && (
        <div>
          {sectionLabel(mode === 'battle' ? 'Character Assignment (optional)' : 'Role Assignment')}
          <div
            className="space-y-1.5 rounded-lg p-2.5"
            style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)' }}
          >
            {selectedProviders.map((p) => {
              const isJudgeAI = mode === 'battle' && judgeProvider === p
              const role = roles.find((r) => r.provider === p)?.role || 'neutral'
              const meta = SPEAKER_CONFIG[p as keyof typeof SPEAKER_CONFIG]
              return (
                <div key={p} className="flex items-center gap-2.5">
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: meta?.color ?? '#888' }} />
                  <span className="text-xs w-14 font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                    {meta?.label ?? p}
                  </span>
                  {isJudgeAI ? (
                    <span className="flex-1 px-2 py-1 text-xs font-semibold" style={{ color: '#ff9800' }}>Judge</span>
                  ) : (
                    <select
                      value={role}
                      onChange={(e) => updateRole(p, e.target.value)}
                      className="flex-1 px-2 py-1 text-xs rounded focus:outline-none"
                      style={{
                        background: 'var(--color-bg-primary)',
                        border: '1px solid var(--color-border)',
                        color: 'var(--color-text-primary)',
                      }}
                    >
                      {ROLE_GROUPS.map((group) => (
                        <optgroup key={group.label} label={group.label}>
                          {group.roles.map((roleValue) => {
                            const roleLabel = ROLE_LABEL_MAP.get(roleValue)
                            if (!roleLabel) return null
                            return (
                              <option key={roleValue} value={roleLabel}>
                                {roleLabel}
                              </option>
                            )
                          })}
                        </optgroup>
                      ))}
                    </select>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Rounds */}
      <div>
        {sectionLabel(`Rounds: ${maxRounds}`)}
        <input
          type="range"
          min={1}
          max={10}
          value={maxRounds}
          onChange={(e) => updateSettings({ maxRounds: Number(e.target.value) })}
          className="w-full"
          style={{ accentColor: 'var(--color-accent)' }}
        />
        <div className="flex justify-between text-[10px] px-0.5 mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
          <span>1</span>
          <span>10</span>
        </div>
      </div>

      {/* Reference Data */}
      <div>
        <label className="flex items-center gap-2 cursor-pointer">
          {/* Toggle */}
          <div
            className="relative w-8 rounded-full cursor-pointer transition-colors"
            style={{
              height: 18,
              background: useReference ? 'var(--color-accent)' : 'var(--color-bg-hover)',
            }}
            onClick={() => updateSettings({ useReference: !useReference })}
          >
            <div
              className="absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-transform"
              style={{ transform: useReference ? 'translateX(16px)' : 'translateX(2px)' }}
            />
          </div>
          <FileText className="w-3.5 h-3.5" style={{ color: 'var(--color-text-secondary)' }} />
          <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>Include reference material</span>
        </label>

        {useReference && (
          <div className="space-y-2 mt-2">
            <textarea
              value={referenceText}
              onChange={(e) => {
                if (e.target.value.length <= REF_MAX_LENGTH) updateSettings({ referenceText: e.target.value })
              }}
              placeholder="Paste text to use as reference for the debate."
              className="w-full px-3 py-2.5 text-sm rounded-lg resize-none focus:outline-none transition"
              style={{
                background: 'var(--color-bg-surface)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text-primary)',
              }}
              rows={3}
            />
            <div className="flex justify-end">
              <span
                className="text-[10px]"
                style={{ color: referenceText.length > REF_MAX_LENGTH * 0.9 ? '#ff9800' : 'var(--color-text-muted)' }}
              >
                {referenceText.length.toLocaleString()} / {REF_MAX_LENGTH.toLocaleString()} chars
              </span>
            </div>

            {/* File Upload */}
            <label
              className="flex flex-col items-center justify-center gap-2 p-4 border-2 border-dashed rounded-lg cursor-pointer transition-all"
              style={{
                borderColor: referenceFiles.length >= MAX_FILES ? 'var(--color-border)' : 'var(--color-border)',
                color: referenceFiles.length >= MAX_FILES ? 'var(--color-text-muted)' : 'var(--color-text-secondary)',
                opacity: referenceFiles.length >= MAX_FILES ? 0.4 : 1,
                cursor: referenceFiles.length >= MAX_FILES ? 'not-allowed' : 'pointer',
              }}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation() }}
              onDrop={(e) => {
                e.preventDefault(); e.stopPropagation()
                if (referenceFiles.length < MAX_FILES) void handleFileUpload(e.dataTransfer.files)
              }}
            >
              <Upload className="w-4 h-4" />
              <span className="text-xs font-medium">Drag image/PDF or click to upload</span>
              <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                Max 10MB | Max {MAX_FILES} files
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_EXTENSIONS}
                multiple
                className="hidden"
                onChange={(e) => void handleFileUpload(e.target.files)}
                disabled={referenceFiles.length >= MAX_FILES}
              />
            </label>

            {referenceFiles.length > 0 && (
              <div className="space-y-1">
                {referenceFiles.map((file) => (
                  <div
                    key={file.id}
                    className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg"
                    style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)' }}
                  >
                    {file.mimeType.startsWith('image/') ? (
                      <img src={file.dataUrl} alt={file.filename} className="w-8 h-8 object-cover rounded shrink-0" />
                    ) : (
                      <div className="w-8 h-8 flex items-center justify-center rounded shrink-0" style={{ background: 'var(--color-bg-hover)' }}>
                        <FileText className="w-3.5 h-3.5" style={{ color: 'var(--color-text-muted)' }} />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs truncate" style={{ color: 'var(--color-text-primary)' }}>{file.filename}</p>
                      <p className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                        {file.size < 1024 ? `${file.size} B` : file.size < 1024 * 1024 ? `${(file.size / 1024).toFixed(1)} KB` : `${(file.size / 1024 / 1024).toFixed(1)} MB`}
                      </p>
                    </div>
                    <button
                      onClick={() => removeFile(file.id)}
                      className="p-1 rounded transition shrink-0"
                      style={{ color: 'var(--color-text-muted)' }}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Pacing */}
      <div>
        {sectionLabel('Turn Speed Control')}
        <div className="grid grid-cols-2 gap-1.5 mb-2">
          {(['auto', 'manual'] as const).map((m) => (
            <button
              key={m}
              onClick={() => updateSettings({ pacingMode: m })}
              className="px-3 py-2 text-xs rounded-lg transition-all"
              style={
                pacingMode === m
                  ? { background: 'rgba(82,156,202,0.1)', border: '1px solid rgba(82,156,202,0.4)', color: 'var(--color-accent)', fontWeight: 600 }
                  : { background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }
              }
            >
              {m === 'auto' ? 'Auto' : 'Manual'}
            </button>
          ))}
        </div>

        {pacingMode === 'auto' ? (
          <div className="grid grid-cols-4 gap-1">
            {DELAY_OPTIONS.map((d) => (
              <button
                key={d}
                onClick={() => updateSettings({ autoDelay: d })}
                className="px-2 py-1.5 text-xs rounded-lg transition-all"
                style={
                  autoDelay === d
                    ? { background: 'rgba(82,156,202,0.1)', border: '1px solid rgba(82,156,202,0.3)', color: 'var(--color-accent)', fontWeight: 500 }
                    : { background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }
                }
              >
                {d}s
              </button>
            ))}
          </div>
        ) : (
          <p className="text-[11px] pl-0.5" style={{ color: 'var(--color-text-muted)' }}>
            Press the 'Next Turn' button after each AI response to proceed
          </p>
        )}
      </div>
    </div>
  )
}
