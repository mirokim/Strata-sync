/**
 * miroStore.ts — MiroFish simulator state management
 *
 * config: persisted (localStorage)
 * simState: runtime only (reset on restart)
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { generatePersonas } from '@/services/mirofish/personaGenerator'
import { runSimulation } from '@/services/mirofish/simulationEngine'
import { generateReport } from '@/services/mirofish/reportGenerator'
import {
  DEFAULT_CONFIG,
  DEFAULT_PERSONAS,
  type MirofishSimulationConfig,
  type MirofishSimulationState,
  type MirofishPersona,
  type MirofishPost,
  type MirofishPersonaPreset,
  type MirofishScheduledTopic,
  type MirofishHistoryEntry,
} from '@/services/mirofish/types'

// Initial state

const INITIAL_SIM_STATE: MirofishSimulationState = {
  status: 'idle',
  currentRound: 0,
  totalRounds: 0,
  feed: [],
  streamingPost: null,
  report: '',
}

// Store type

interface MiroState {
  config: MirofishSimulationConfig
  simState: MirofishSimulationState
  _abortController: AbortController | null
  presets: MirofishPersonaPreset[]
  scheduledTopics: MirofishScheduledTopic[]
  /** Completed simulation history (keep most recent 20) */
  simulationHistory: MirofishHistoryEntry[]

  // Config actions
  setConfig: (partial: Partial<MirofishSimulationConfig>) => void
  setPersonas: (personas: MirofishPersona[]) => void
  addPersona: () => void
  removePersona: (id: string) => void
  updatePersona: (id: string, partial: Partial<MirofishPersona>) => void

  // Preset actions
  savePreset: (name: string) => void
  loadPreset: (id: string) => void
  deletePreset: (id: string) => void

  // Schedule actions
  addScheduledTopic: (topic: Omit<MirofishScheduledTopic, 'id'>) => void
  updateScheduledTopic: (id: string, partial: Partial<MirofishScheduledTopic>) => void
  deleteScheduledTopic: (id: string) => void

  // History actions
  deleteHistoryEntry: (id: string) => void
  clearHistory: () => void

  // Simulation actions
  startSimulation: () => Promise<void>
  stopSimulation: () => void
  resetSimulation: () => void
}

// Store

export const useMiroStore = create<MiroState>()(
  persist(
    (set, get) => ({
      config:   DEFAULT_CONFIG,
      simState: INITIAL_SIM_STATE,
      _abortController: null,
      presets: [],
      scheduledTopics: [],
      simulationHistory: [],

      // Config actions

      setConfig: (partial) =>
        set(s => ({ config: { ...s.config, ...partial } })),

      setPersonas: (personas) =>
        set(s => ({ config: { ...s.config, personas } })),

      addPersona: () => {
        const id = `persona_${Date.now()}`
        const newPersona: MirofishPersona = {
          id,
          name: 'New Persona',
          role: 'new role',
          stance: 'neutral',
          activityLevel: 0.7,
          influenceWeight: 0.5,
          systemPrompt: 'Write your perspective and tone here.',
        }
        set(s => ({ config: { ...s.config, personas: s.config.personas.length < 50 ? [...s.config.personas, newPersona] : s.config.personas } }))
      },

      removePersona: (id) =>
        set(s => ({
          config: { ...s.config, personas: s.config.personas.filter(p => p.id !== id) },
        })),

      updatePersona: (id, partial) =>
        set(s => ({
          config: {
            ...s.config,
            personas: s.config.personas.map(p => p.id === id ? { ...p, ...partial } : p),
          },
        })),

      // Preset actions
      savePreset: (name) =>
        set(s => ({
          presets: [
            ...s.presets,
            { id: `preset_${Date.now()}`, name, personas: s.config.personas.slice(0, s.config.numPersonas) },
          ],
        })),

      loadPreset: (id) =>
        set(s => {
          const preset = s.presets.find(p => p.id === id)
          if (!preset) return s
          return { config: { ...s.config, personas: preset.personas, numPersonas: preset.personas.length, autoGeneratePersonas: false } }
        }),

      deletePreset: (id) =>
        set(s => ({ presets: s.presets.filter(p => p.id !== id) })),

      // Schedule actions
      addScheduledTopic: (topic) =>
        set(s => ({
          scheduledTopics: [...s.scheduledTopics, { ...topic, id: `sched_${Date.now()}` }],
        })),

      updateScheduledTopic: (id, partial) =>
        set(s => ({
          scheduledTopics: s.scheduledTopics.map(t => t.id === id ? { ...t, ...partial } : t),
        })),

      deleteScheduledTopic: (id) =>
        set(s => ({ scheduledTopics: s.scheduledTopics.filter(t => t.id !== id) })),

      // History actions
      deleteHistoryEntry: (id) =>
        set(s => ({ simulationHistory: s.simulationHistory.filter(h => h.id !== id) })),

      clearHistory: () => set({ simulationHistory: [] }),

      // Simulation actions

      startSimulation: async () => {
        const { config } = get()
        if (!config.topic.trim()) return

        const abort = new AbortController()
        set({ _abortController: abort, simState: { ...INITIAL_SIM_STATE, totalRounds: config.numRounds } })

        try {
          // 1. Auto-generate personas
          let personas = config.personas
          if (config.autoGeneratePersonas) {
            set(s => ({ simState: { ...s.simState, status: 'generating-personas' } }))
            personas = await generatePersonas(config.topic, config.numPersonas, config.modelId, config.context)
            if (abort.signal.aborted) return
            set(s => ({ config: { ...s.config, personas } }))
          }

          // 2. Run simulation
          set(s => ({ simState: { ...s.simState, status: 'running' } }))

          const feed: MirofishPost[] = []

          await runSimulation(
            { ...config, personas },
            (event) => {
              if (abort.signal.aborted) return

              if (event.type === 'post-start') {
                set(s => ({
                  simState: {
                    ...s.simState,
                    streamingPost: { personaId: event.personaId!, content: '' },
                  },
                }))
              } else if (event.type === 'post-chunk') {
                set(s => {
                  const sp = s.simState.streamingPost
                  if (!sp || sp.personaId !== event.personaId) return s
                  return {
                    simState: {
                      ...s.simState,
                      streamingPost: { ...sp, content: sp.content + (event.chunk ?? '') },
                    },
                  }
                })
              } else if (event.type === 'post-done' && event.post) {
                feed.push(event.post)
                set(s => ({
                  simState: {
                    ...s.simState,
                    streamingPost: null,
                    feed: [...feed],
                  },
                }))
              } else if (event.type === 'round-done') {
                set(s => ({
                  simState: { ...s.simState, currentRound: event.round! },
                }))
              }
            },
            abort.signal,
          )

          if (abort.signal.aborted) return

          // 3. Generate report
          set(s => ({ simState: { ...s.simState, status: 'generating-report', streamingPost: null } }))
          let report = ''
          try {
            report = await generateReport(config.topic, feed, config.modelId)
          } catch (reportErr) {
            console.error('[miroStore] Report generation error:', reportErr)
            report = `## Report Generation Failed\n\nError: ${reportErr instanceof Error ? reportErr.message : String(reportErr)}`
          }

          if (abort.signal.aborted) return

          const historyEntry: MirofishHistoryEntry = {
            id: `hist_${Date.now()}`,
            topic: config.topic,
            numPersonas: config.numPersonas,
            numRounds: config.numRounds,
            feed: [...feed],
            report,
            createdAt: Date.now(),
          }
          set(s => ({
            simState: { ...s.simState, status: 'done', report, feed: [...feed] },
            simulationHistory: [historyEntry, ...s.simulationHistory].slice(0, 20),
          }))
        } catch (err) {
          if (!abort.signal.aborted) {
            set(s => ({
              simState: {
                ...s.simState,
                status: 'error',
                errorMessage: err instanceof Error ? err.message : 'Unknown error',
              },
            }))
          }
        } finally {
          set({ _abortController: null })
        }
      },

      stopSimulation: () => {
        get()._abortController?.abort()
        set(s => ({
          _abortController: null,
          simState: { ...s.simState, status: 'idle', streamingPost: null },
        }))
      },

      resetSimulation: () =>
        set({ simState: INITIAL_SIM_STATE }),
    }),
    {
      name: 'strata-sync-miro',
      partialize: (s) => ({
        config: s.config,
        presets: s.presets,
        scheduledTopics: s.scheduledTopics,
        simulationHistory: s.simulationHistory,
      }),
      merge: (persisted: unknown, current) => {
        const p = persisted as Partial<MiroState>
        return {
          ...current,
          config: {
            ...DEFAULT_CONFIG,
            ...(p.config ?? {}),
            personas: p.config?.personas?.length ? p.config.personas : DEFAULT_PERSONAS,
          },
          presets: p.presets ?? [],
          scheduledTopics: p.scheduledTopics ?? [],
          simulationHistory: p.simulationHistory ?? [],
        }
      },
    },
  ),
)
