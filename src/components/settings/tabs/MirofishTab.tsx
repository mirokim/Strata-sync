/**
 * MirofishTab — Settings > MiroFish Simulator tab
 *
 * Layout:
 *   Simulation settings (topic, rounds, model, etc.)
 *   Execution controls (start/stop, progress)
 *   Persona list (manual editing)
 *   Feed (real-time reactions)
 *   Report (after completion)
 */

import { useRef, useEffect, useState } from 'react'
import { Play, Square, Plus, Trash2, RotateCcw, Save, Clock, History, ChevronDown, ChevronRight } from 'lucide-react'
import { useMiroStore } from '@/stores/miroStore'
import { MODEL_OPTIONS } from '@/lib/modelConfig'
import type { MirofishPersona, MirofishScheduledTopic, MirofishHistoryEntry } from '@/services/mirofish/types'

// Color mapping

const STANCE_COLOR: Record<MirofishPersona['stance'], string> = {
  supportive: 'var(--color-accent)',
  opposing:   'var(--color-error)',
  neutral:    'var(--color-text-secondary)',
  observer:   'var(--color-text-muted)',
}

const STANCE_LABEL: Record<MirofishPersona['stance'], string> = {
  supportive: 'Supportive',
  opposing:   'Opposing',
  neutral:    'Neutral',
  observer:   'Observer',
}

// Sub-components

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, letterSpacing: '0.07em',
      textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 10,
    }}>
      {children}
    </div>
  )
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      padding: 14, borderRadius: 2,
      background: 'var(--color-bg-surface)',
      border: '1px solid var(--color-border)',
      ...style,
    }}>
      {children}
    </div>
  )
}

// Main Component

export default function MirofishTab() {
  const {
    config, simState,
    setConfig, setPersonas, addPersona, removePersona, updatePersona,
    startSimulation, stopSimulation, resetSimulation,
    presets, savePreset, loadPreset, deletePreset,
    scheduledTopics, addScheduledTopic, updateScheduledTopic, deleteScheduledTopic,
    simulationHistory, deleteHistoryEntry, clearHistory,
  } = useMiroStore()

  const [presetName, setPresetName] = useState('')
  const [newSched, setNewSched] = useState<Omit<MirofishScheduledTopic, 'id'>>({
    topic: '', numPersonas: 5, numRounds: 3, time: '09:00', enabled: true,
  })
  const [vaultToast, setVaultToast] = useState<'saved' | 'copied' | 'error' | null>(null)

  const feedEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll feed
  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [simState.feed, simState.streamingPost])

  const isRunning  = simState.status === 'running' || simState.status === 'generating-personas' || simState.status === 'generating-report'
  const isDone     = simState.status === 'done'
  const canStart   = config.topic.trim().length > 0 && config.personas.length > 0

  const statusText: Record<typeof simState.status, string> = {
    idle:                'Idle',
    'generating-personas': 'Generating personas...',
    running:             `Round ${simState.currentRound} / ${simState.totalRounds} in progress...`,
    'generating-report': 'Generating report...',
    done:                'Complete',
    error:               `Error: ${simState.errorMessage ?? ''}`,
  }

  // Save to vault
  const saveToVault = async () => {
    if (!simState.report) return
    const date = new Date().toISOString().split('T')[0]
    const slug = config.topic.slice(0, 30).replace(/\s+/g, '_').replace(/[^\w_-]/g, '')
    const filename = `MiroFish_${slug}_${date}.md`
    const content = `---\ndate: ${date}\ntags: [mirofish, simulation]\n---\n\n# MiroFish Simulation: ${config.topic}\n\n${simState.report}`
    try {
      const result = await window.vaultAPI?.saveFile?.(filename, content)
      if (result?.success) {
        setVaultToast('saved')
      } else {
        await navigator.clipboard.writeText(content)
        setVaultToast('copied')
      }
    } catch {
      setVaultToast('error')
    }
    setTimeout(() => setVaultToast(null), 3000)
  }

  const copyReport = () => navigator.clipboard.writeText(simState.report)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Simulation settings */}
      <div>
        <SectionLabel>Simulation Settings</SectionLabel>
        <Card>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* Topic */}
            <div>
              <label style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-text-muted)', display: 'block', marginBottom: 5 }}>
                Topic / Scenario
              </label>
              <input
                value={config.topic}
                onChange={e => setConfig({ topic: e.target.value })}
                placeholder="e.g. New character launch, price increase announcement, new feature promo..."
                disabled={isRunning}
                style={{
                  width: '100%', fontSize: 13, padding: '7px 10px', borderRadius: 2,
                  background: 'var(--color-bg-base)', border: '1px solid var(--color-border)',
                  color: 'var(--color-text-primary)', outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Number settings row */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-text-muted)', display: 'block', marginBottom: 5 }}>
                  Persona Count (3-50)
                </label>
                <input
                  type="number" min={3} max={50} value={config.numPersonas}
                  onChange={e => setConfig({ numPersonas: Math.max(3, Math.min(50, +e.target.value)) })}
                  disabled={isRunning}
                  style={{
                    width: '100%', fontSize: 13, padding: '7px 10px', borderRadius: 2, textAlign: 'right',
                    background: 'var(--color-bg-base)', border: '1px solid var(--color-border)',
                    color: 'var(--color-text-primary)', outline: 'none',
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-text-muted)', display: 'block', marginBottom: 5 }}>
                  Round Count (2-10)
                </label>
                <input
                  type="number" min={2} max={10} value={config.numRounds}
                  onChange={e => setConfig({ numRounds: Math.max(2, Math.min(10, +e.target.value)) })}
                  disabled={isRunning}
                  style={{
                    width: '100%', fontSize: 13, padding: '7px 10px', borderRadius: 2, textAlign: 'right',
                    background: 'var(--color-bg-base)', border: '1px solid var(--color-border)',
                    color: 'var(--color-text-primary)', outline: 'none',
                  }}
                />
              </div>
            </div>

            {/* Model selection */}
            <div>
              <label style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-text-muted)', display: 'block', marginBottom: 5 }}>
                Model
              </label>
              <select
                value={config.modelId}
                onChange={e => setConfig({ modelId: e.target.value })}
                disabled={isRunning}
                style={{
                  width: '100%', fontSize: 13, padding: '7px 10px', borderRadius: 2,
                  background: 'var(--color-bg-base)', border: '1px solid var(--color-border)',
                  color: 'var(--color-text-primary)', outline: 'none', cursor: 'pointer',
                }}
              >
                {MODEL_OPTIONS.map(m => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </div>

            {/* Auto-generate toggle */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: isRunning ? 'not-allowed' : 'pointer' }}>
              <input
                type="checkbox"
                checked={config.autoGeneratePersonas}
                onChange={e => setConfig({ autoGeneratePersonas: e.target.checked })}
                disabled={isRunning}
              />
              <span style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
                Auto-generate personas based on topic
              </span>
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                (LLM analyzes topic and creates personas)
              </span>
            </label>

            {/* Image direct pass toggle */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <span style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
                  Direct Image Pass
                </span>
                <span style={{ fontSize: 11, color: 'var(--color-text-muted)', marginLeft: 6 }}>
                  {config.imageDirectPass ? 'Each persona sees images directly (more tokens)' : 'Images converted to text descriptions (fewer tokens)'}
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={config.imageDirectPass}
                onClick={() => setConfig({ imageDirectPass: !config.imageDirectPass })}
                disabled={isRunning}
                className="shrink-0 ml-4 w-9 h-5 rounded-full transition-colors"
                style={{
                  background: config.imageDirectPass ? 'var(--color-accent)' : 'var(--color-bg-hover)',
                  border: '1px solid var(--color-border)',
                  opacity: isRunning ? 0.5 : 1,
                }}
              >
                <span
                  className="block w-3.5 h-3.5 rounded-full bg-white transition-transform"
                  style={{ transform: config.imageDirectPass ? 'translateX(18px)' : 'translateX(2px)', marginTop: 2 }}
                />
              </button>
            </div>

          </div>
        </Card>
      </div>

      {/* Execution controls */}
      <div>
        <SectionLabel>Execution Controls</SectionLabel>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '12px 14px', borderRadius: 2,
          background: isRunning
            ? 'color-mix(in srgb, var(--color-accent) 8%, transparent)'
            : isDone ? 'color-mix(in srgb, var(--color-success) 8%, transparent)' : 'var(--color-bg-surface)',
          border: `1px solid ${isRunning ? 'color-mix(in srgb, var(--color-accent) 35%, transparent)' : isDone ? 'color-mix(in srgb, var(--color-success) 25%, transparent)' : 'var(--color-border)'}`,
          transition: 'border-color 0.2s, background 0.2s',
        }}>
          {/* Status dot */}
          <div style={{ position: 'relative', width: 9, height: 9, flexShrink: 0 }}>
            <div style={{
              width: 9, height: 9, borderRadius: '50%',
              background: isRunning ? 'var(--color-accent)' : isDone ? 'var(--color-success)' : 'var(--color-text-muted)',
            }} />
            {isRunning && (
              <div style={{
                position: 'absolute', inset: -3, borderRadius: '50%',
                background: 'var(--color-accent)', opacity: 0.25,
                animation: 'miroPing 1.8s ease-out infinite',
              }} />
            )}
          </div>

          <div style={{ flex: 1, fontSize: 13, color: isRunning ? 'var(--color-accent)' : isDone ? 'var(--color-success)' : 'var(--color-text-primary)' }}>
            {statusText[simState.status]}
          </div>

          {isDone && (
            <button
              onClick={resetSimulation}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '5px 10px', borderRadius: 2, fontSize: 11,
                background: 'none', border: '1px solid var(--color-border)',
                color: 'var(--color-text-muted)', cursor: 'pointer',
              }}
            >
              <RotateCcw size={10} /> Reset
            </button>
          )}

          <button
            onClick={isRunning ? stopSimulation : startSimulation}
            disabled={!isRunning && !canStart}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '6px 14px', borderRadius: 2, fontSize: 12, fontWeight: 500,
              border: isRunning ? '1px solid #ef444450' : 'none',
              cursor: (!isRunning && !canStart) ? 'not-allowed' : 'pointer',
              background: isRunning ? '#ef444415' : 'var(--color-accent)',
              color: isRunning ? '#ef4444' : '#fff',
              opacity: (!isRunning && !canStart) ? 0.4 : 1,
              flexShrink: 0, whiteSpace: 'nowrap',
            }}
          >
            {isRunning ? <><Square size={11} /> Stop</> : <><Play size={11} /> Start</>}
          </button>
        </div>
        <style>{`@keyframes miroPing { 0% { transform: scale(1); opacity: 0.25; } 100% { transform: scale(3); opacity: 0; } }`}</style>
      </div>

      {/* Persona editing */}
      {!config.autoGeneratePersonas && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <SectionLabel>Persona List</SectionLabel>
            <button
              onClick={addPersona}
              disabled={isRunning || config.personas.length >= 50}
              style={{
                display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, padding: '4px 8px',
                borderRadius: 2, border: '1px solid var(--color-border)',
                background: 'none', color: 'var(--color-text-muted)', cursor: 'pointer',
              }}
            >
              <Plus size={10} /> Add
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {config.personas.slice(0, config.numPersonas).map(p => (
              <PersonaCard
                key={p.id}
                persona={p}
                disabled={isRunning}
                onUpdate={(partial) => updatePersona(p.id, partial)}
                onRemove={() => removePersona(p.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Persona presets */}
      <div>
        <SectionLabel>Persona Presets</SectionLabel>
        <Card>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* Save current personas */}
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                value={presetName}
                onChange={e => setPresetName(e.target.value)}
                placeholder="Preset name..."
                style={{
                  flex: 1, fontSize: 12, padding: '5px 8px', borderRadius: 2,
                  background: 'var(--color-bg-base)', border: '1px solid var(--color-border)',
                  color: 'var(--color-text-primary)', outline: 'none',
                }}
              />
              <button
                onClick={() => { if (presetName.trim()) { savePreset(presetName.trim()); setPresetName('') } }}
                disabled={!presetName.trim() || config.personas.length === 0}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  padding: '5px 10px', borderRadius: 2, fontSize: 11,
                  background: 'var(--color-accent)', border: 'none', color: '#fff',
                  cursor: presetName.trim() ? 'pointer' : 'not-allowed',
                  opacity: presetName.trim() && config.personas.length > 0 ? 1 : 0.4,
                }}
              >
                <Save size={10} /> Save
              </button>
            </div>
            {/* Saved presets list */}
            {presets.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', textAlign: 'center', padding: '6px 0' }}>
                No saved presets
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {presets.map(preset => (
                  <div key={preset.id} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '6px 10px', borderRadius: 2,
                    background: 'var(--color-bg-base)', border: '1px solid var(--color-border)',
                  }}>
                    <span style={{ flex: 1, fontSize: 12, color: 'var(--color-text-primary)' }}>
                      {preset.name}
                    </span>
                    <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>
                      {preset.personas.length} personas
                    </span>
                    <button
                      onClick={() => loadPreset(preset.id)}
                      style={{ ...btnStyle, fontSize: 10, padding: '3px 8px' }}
                    >
                      Load
                    </button>
                    <button
                      onClick={() => deletePreset(preset.id)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-error)', padding: 2 }}
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Scheduled execution */}
      <div>
        <SectionLabel>Scheduled Execution</SectionLabel>
        <Card>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* Add new schedule */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  value={newSched.topic}
                  onChange={e => setNewSched(s => ({ ...s, topic: e.target.value }))}
                  placeholder="Topic..."
                  style={{
                    flex: 1, fontSize: 12, padding: '5px 8px', borderRadius: 2,
                    background: 'var(--color-bg-base)', border: '1px solid var(--color-border)',
                    color: 'var(--color-text-primary)', outline: 'none',
                  }}
                />
                <input
                  type="time"
                  value={newSched.time}
                  onChange={e => setNewSched(s => ({ ...s, time: e.target.value }))}
                  style={{
                    fontSize: 12, padding: '5px 8px', borderRadius: 2,
                    background: 'var(--color-bg-base)', border: '1px solid var(--color-border)',
                    color: 'var(--color-text-primary)', outline: 'none',
                  }}
                />
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Personas</span>
                <input
                  type="number" min={3} max={50} value={newSched.numPersonas}
                  onChange={e => setNewSched(s => ({ ...s, numPersonas: Math.max(3, Math.min(50, +e.target.value)) }))}
                  style={{
                    width: 50, fontSize: 12, padding: '4px 6px', borderRadius: 2, textAlign: 'right',
                    background: 'var(--color-bg-base)', border: '1px solid var(--color-border)',
                    color: 'var(--color-text-primary)', outline: 'none',
                  }}
                />
                <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Rounds</span>
                <input
                  type="number" min={2} max={10} value={newSched.numRounds}
                  onChange={e => setNewSched(s => ({ ...s, numRounds: Math.max(2, Math.min(10, +e.target.value)) }))}
                  style={{
                    width: 50, fontSize: 12, padding: '4px 6px', borderRadius: 2, textAlign: 'right',
                    background: 'var(--color-bg-base)', border: '1px solid var(--color-border)',
                    color: 'var(--color-text-primary)', outline: 'none',
                  }}
                />
                <button
                  onClick={() => { if (newSched.topic.trim()) { addScheduledTopic(newSched); setNewSched(s => ({ ...s, topic: '' })) } }}
                  disabled={!newSched.topic.trim()}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    padding: '5px 10px', borderRadius: 2, fontSize: 11, marginLeft: 'auto',
                    background: 'var(--color-accent)', border: 'none', color: '#fff',
                    cursor: newSched.topic.trim() ? 'pointer' : 'not-allowed',
                    opacity: newSched.topic.trim() ? 1 : 0.4,
                  }}
                >
                  <Clock size={10} /> Add
                </button>
              </div>
            </div>
            {/* Schedule list */}
            {scheduledTopics.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', textAlign: 'center', padding: '4px 0' }}>
                No scheduled topics
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {scheduledTopics.map(sched => (
                  <div key={sched.id} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '6px 10px', borderRadius: 2,
                    background: 'var(--color-bg-base)', border: `1px solid ${sched.enabled ? 'color-mix(in srgb, var(--color-accent) 35%, transparent)' : 'var(--color-border)'}`,
                    opacity: sched.enabled ? 1 : 0.5,
                  }}>
                    <span style={{ fontSize: 11, color: 'var(--color-accent)', fontFamily: 'monospace', flexShrink: 0 }}>
                      {sched.time}
                    </span>
                    <span style={{ flex: 1, fontSize: 12, color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {sched.topic}
                    </span>
                    <span style={{ fontSize: 10, color: 'var(--color-text-muted)', flexShrink: 0 }}>
                      {sched.numPersonas} personas, {sched.numRounds} rounds
                    </span>
                    <button
                      onClick={() => updateScheduledTopic(sched.id, { enabled: !sched.enabled })}
                      style={{
                        fontSize: 10, padding: '2px 6px', borderRadius: 2,
                        background: sched.enabled ? 'color-mix(in srgb, var(--color-accent) 15%, transparent)' : 'none',
                        border: `1px solid ${sched.enabled ? 'color-mix(in srgb, var(--color-accent) 40%, transparent)' : 'var(--color-border)'}`,
                        color: sched.enabled ? 'var(--color-accent)' : 'var(--color-text-muted)',
                        cursor: 'pointer',
                      }}
                    >
                      {sched.enabled ? 'ON' : 'OFF'}
                    </button>
                    <button
                      onClick={() => deleteScheduledTopic(sched.id)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-error)', padding: 2 }}
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Feed */}
      {(simState.feed.length > 0 || simState.streamingPost) && (
        <div>
          <SectionLabel>Reaction Feed</SectionLabel>
          <div style={{
            height: 240, overflowY: 'auto',
            background: 'var(--color-bg-base)', border: '1px solid var(--color-border)',
            borderRadius: 2, padding: '8px 10px',
            fontFamily: 'monospace', fontSize: 12,
            color: 'var(--color-text-secondary)',
          }}>
            {simState.feed.map((post, i) => (
              <div key={i} style={{ lineHeight: 1.6, marginBottom: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                <span style={{ color: 'var(--color-text-muted)' }}>[R{post.round}] </span>
                <span style={{ color: STANCE_COLOR[post.stance], fontWeight: 600 }}>
                  {post.personaName}
                </span>
                <span style={{ color: 'var(--color-text-muted)', fontSize: 10 }}> ({STANCE_LABEL[post.stance]})</span>
                <span style={{ color: 'var(--color-text-primary)' }}>: {post.content}</span>
              </div>
            ))}

            {/* Streaming post */}
            {simState.streamingPost && (
              <div style={{ lineHeight: 1.6, marginBottom: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                <span style={{ color: 'var(--color-text-muted)' }}>[R{simState.currentRound + 1}] </span>
                <span style={{ color: 'var(--color-accent)', fontWeight: 600 }}>
                  {config.personas.find(p => p.id === simState.streamingPost!.personaId)?.name ?? '...'}
                </span>
                <span style={{ color: 'var(--color-text-primary)' }}>: {simState.streamingPost.content}</span>
                <span style={{ animation: 'blink 1s step-end infinite', color: 'var(--color-accent)' }}>|</span>
              </div>
            )}
            <div ref={feedEndRef} />
          </div>
          <style>{`@keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }`}</style>
        </div>
      )}

      {/* Report */}
      {isDone && simState.report && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <SectionLabel>Analysis Report</SectionLabel>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={copyReport} style={btnStyle}>Copy</button>
              <button onClick={saveToVault} style={btnStyle}>
                {vaultToast === 'saved' ? 'Saved' : vaultToast === 'copied' ? 'Copied to clipboard' : vaultToast === 'error' ? 'Save failed' : 'Save to Vault'}
              </button>
            </div>
          </div>
          <div style={{
            maxHeight: 320, overflowY: 'auto',
            padding: 14, borderRadius: 2,
            background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)',
            fontSize: 13, lineHeight: 1.7, color: 'var(--color-text-primary)',
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>
            {simState.report}
          </div>
        </div>
      )}

      {/* Simulation history */}
      {simulationHistory.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <SectionLabel>Simulation History ({simulationHistory.length})</SectionLabel>
            <button
              onClick={clearHistory}
              style={{ fontSize: 11, padding: '2px 8px', borderRadius: 2, border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer' }}
            >
              Clear All
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {simulationHistory.map(entry => (
              <HistoryCard
                key={entry.id}
                entry={entry}
                onDelete={() => deleteHistoryEntry(entry.id)}
                onRerun={() => {
                  setConfig({ topic: entry.topic, numPersonas: entry.numPersonas, numRounds: entry.numRounds, autoGeneratePersonas: true })
                  window.scrollTo({ top: 0, behavior: 'smooth' })
                }}
              />
            ))}
          </div>
        </div>
      )}

    </div>
  )
}

// History card

function HistoryCard({ entry, onDelete, onRerun }: { entry: MirofishHistoryEntry; onDelete: () => void; onRerun: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const date = new Date(entry.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  const stanceCounts = entry.feed.reduce<Record<string, number>>((acc, p) => {
    acc[p.stance] = (acc[p.stance] ?? 0) + 1; return acc
  }, {})

  return (
    <div style={{ border: '1px solid var(--color-border)', borderRadius: 2, background: 'var(--color-bg-surface)', overflow: 'hidden' }}>
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', cursor: 'pointer' }}
        onClick={() => setExpanded(e => !e)}
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {entry.topic}
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
            {date} - {entry.numPersonas} personas - {entry.numRounds} rounds - {entry.feed.length} reactions
            {Object.entries(stanceCounts).map(([s, n]) => (
              <span key={s} style={{ marginLeft: 6, color: s === 'supportive' ? 'var(--color-accent)' : s === 'opposing' ? 'var(--color-error)' : 'var(--color-text-muted)' }}>
                {s === 'supportive' ? 'Support' : s === 'opposing' ? 'Oppose' : s === 'neutral' ? 'Neutral' : 'Observe'} {n}
              </span>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
          <button onClick={onRerun} title="Rerun with this topic" style={{ fontSize: 11, padding: '2px 6px', borderRadius: 2, border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-secondary)', cursor: 'pointer' }}>
            Rerun
          </button>
          <button onClick={onDelete} title="Delete" style={{ padding: '2px 4px', borderRadius: 2, border: 'none', background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer' }}>
            <Trash2 size={12} />
          </button>
        </div>
      </div>
      {expanded && (
        <div style={{ borderTop: '1px solid var(--color-border)', padding: '10px 12px', maxHeight: 260, overflowY: 'auto' }}>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
            {entry.report}
          </div>
        </div>
      )}
    </div>
  )
}

// Persona card

function PersonaCard({
  persona, disabled, onUpdate, onRemove,
}: {
  persona: MirofishPersona
  disabled: boolean
  onUpdate: (p: Partial<MirofishPersona>) => void
  onRemove: () => void
}) {
  const inp = (style?: React.CSSProperties): React.CSSProperties => ({
    fontSize: 12, padding: '4px 8px', borderRadius: 2,
    background: 'var(--color-bg-base)', border: '1px solid var(--color-border)',
    color: 'var(--color-text-primary)', outline: 'none',
    ...style,
  })

  return (
    <div style={{
      padding: '10px 12px', borderRadius: 2,
      border: `1px solid var(--color-border)`,
      background: 'var(--color-bg-surface)',
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {/* Name */}
        <input
          value={persona.name}
          onChange={e => onUpdate({ name: e.target.value })}
          disabled={disabled}
          placeholder="Name"
          style={inp({ flex: 1 })}
        />
        {/* Stance */}
        <select
          value={persona.stance}
          onChange={e => onUpdate({ stance: e.target.value as MirofishPersona['stance'] })}
          disabled={disabled}
          style={inp({ color: STANCE_COLOR[persona.stance] })}
        >
          <option value="supportive">Supportive</option>
          <option value="opposing">Opposing</option>
          <option value="neutral">Neutral</option>
          <option value="observer">Observer</option>
        </select>
        {/* Activity level */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 10, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>Activity</span>
          <input
            type="number" min={0.1} max={1} step={0.1}
            value={persona.activityLevel}
            onChange={e => onUpdate({ activityLevel: Math.max(0.1, Math.min(1, +e.target.value)) })}
            disabled={disabled}
            style={inp({ width: 52, textAlign: 'right' })}
          />
        </div>
        <button
          onClick={onRemove}
          disabled={disabled}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-error)', padding: 4, flexShrink: 0 }}
        >
          <Trash2 size={12} />
        </button>
      </div>
      {/* System prompt */}
      <textarea
        value={persona.systemPrompt}
        onChange={e => onUpdate({ systemPrompt: e.target.value })}
        disabled={disabled}
        rows={2}
        placeholder="Describe this persona's perspective and voice..."
        style={{
          ...inp({ width: '100%', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5, boxSizing: 'border-box' }),
        }}
      />
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  fontSize: 11, padding: '4px 10px', borderRadius: 2,
  background: 'none', border: '1px solid var(--color-border)',
  color: 'var(--color-text-muted)', cursor: 'pointer',
}
