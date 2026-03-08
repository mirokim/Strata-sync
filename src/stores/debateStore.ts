/**
 * Debate store — manages debate/discussion state and settings.
 * Adapted from Onion_flow's debateStore.ts for STRATA SYNC.
 *
 * Key difference: no aiStore dependency — API keys come from VITE_*_API_KEY env vars
 * read directly inside debateEngine.ts.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  DiscussionConfig,
  DiscussionMessage,
  DebateStatus,
  DiscussionMode,
  RoleConfig,
  ReferenceFile,
} from '@/types'
import { generateId } from '@/lib/utils'
import { runDebate } from '@/services/debateEngine'

/** Persistent debate settings (configured via SettingsPanel) */
interface DebateSettings {
  mode: DiscussionMode
  maxRounds: number
  selectedProviders: string[]
  roles: RoleConfig[]
  judgeProvider: string | null
  useReference: boolean
  referenceText: string
  referenceFiles: ReferenceFile[]
  pacingMode: 'auto' | 'manual'
  autoDelay: number
}

interface DebateState {
  status: DebateStatus
  config: DiscussionConfig | null
  messages: DiscussionMessage[]
  currentRound: number
  currentTurnIndex: number
  loadingProvider: string | null
  abortController: AbortController | null

  // Pacing state
  countdown: number   // >0 = auto countdown, -1 = manual waiting, 0 = none
  waitingForNext: boolean
  _nextTurnResolver: (() => void) | null

  // Persistent settings
  settings: DebateSettings

  // Actions
  startDebate: (config: DiscussionConfig) => void
  pauseDebate: () => void
  resumeDebate: () => void
  stopDebate: () => void
  userIntervene: (content: string, files?: ReferenceFile[]) => void
  nextTurn: () => void
  reset: () => void

  // Settings actions
  updateSettings: (partial: Partial<DebateSettings>) => void
  toggleProvider: (provider: string) => void
  updateRole: (provider: string, role: string) => void
}

const DEFAULT_SETTINGS: DebateSettings = {
  mode: 'roundRobin',
  maxRounds: 3,
  selectedProviders: [],
  roles: [],
  judgeProvider: null,
  useReference: false,
  referenceText: '',
  referenceFiles: [],
  pacingMode: 'auto',
  autoDelay: 5,
}

export const useDebateStore = create<DebateState>()(
  persist(
    (set, get) => ({
      status: 'idle',
      config: null,
      messages: [],
      currentRound: 0,
      currentTurnIndex: 0,
      loadingProvider: null,
      abortController: null,
      countdown: 0,
      waitingForNext: false,
      _nextTurnResolver: null,

      settings: { ...DEFAULT_SETTINGS },

      startDebate: (config) => {
        // Abort any previous debate
        const prev = get().abortController
        if (prev) prev.abort()

        const controller = new AbortController()

        set({
          config,
          status: 'running',
          messages: [],
          currentRound: 1,
          currentTurnIndex: 0,
          loadingProvider: null,
          abortController: controller,
          countdown: 0,
          waitingForNext: false,
          _nextTurnResolver: null,
        })

        // Launch the debate engine (fire-and-forget, updates come via callbacks)
        void runDebate(
          config,
          {
            onMessage: (msg) => {
              set((state) => ({ messages: [...state.messages, msg] }))
            },
            onStatusChange: (status) => {
              set({ status })
            },
            onRoundChange: (round, turnIndex) => {
              set({ currentRound: round, currentTurnIndex: turnIndex })
            },
            onLoadingChange: (provider) => {
              set({ loadingProvider: provider })
            },
            onCountdownTick: (seconds) => {
              set({ countdown: seconds, waitingForNext: seconds === -1 })
            },
            waitForNextTurn: () =>
              new Promise<void>((resolve) => {
                set({ _nextTurnResolver: resolve, waitingForNext: true })
              }),
            getStatus: () => get().status,
            getMessages: () => get().messages,
          },
          controller.signal,
        )
      },

      pauseDebate: () => set({ status: 'paused' }),

      resumeDebate: () => set({ status: 'running' }),

      stopDebate: () => {
        const resolver = get()._nextTurnResolver
        if (resolver) resolver()
        get().abortController?.abort()
        set({
          status: 'stopped',
          loadingProvider: null,
          countdown: 0,
          waitingForNext: false,
          _nextTurnResolver: null,
        })
      },

      userIntervene: (content, files) => {
        const msg: DiscussionMessage = {
          id: generateId(),
          provider: 'user',
          content,
          round: get().currentRound,
          timestamp: Date.now(),
          files: files && files.length > 0 ? files : undefined,
        }
        set((state) => ({ messages: [...state.messages, msg] }))
      },

      nextTurn: () => {
        const resolver = get()._nextTurnResolver
        if (resolver) {
          resolver()
          set({ _nextTurnResolver: null, waitingForNext: false, countdown: 0 })
        }
      },

      reset: () => {
        const resolver = get()._nextTurnResolver
        if (resolver) resolver()
        get().abortController?.abort()
        set({
          status: 'idle',
          config: null,
          messages: [],
          currentRound: 0,
          currentTurnIndex: 0,
          loadingProvider: null,
          abortController: null,
          countdown: 0,
          waitingForNext: false,
          _nextTurnResolver: null,
        })
      },

      updateSettings: (partial) => {
        set((state) => ({
          settings: { ...state.settings, ...partial },
        }))
      },

      toggleProvider: (provider) => {
        set((state) => {
          const prev = state.settings.selectedProviders
          const next = prev.includes(provider)
            ? prev.filter((p) => p !== provider)
            : [...prev, provider]
          const existing = new Map(state.settings.roles.map((r) => [r.provider, r]))
          const roles = next.map((p) => existing.get(p) || { provider: p, role: 'Neutral' })
          const judgeProvider =
            state.settings.judgeProvider && next.includes(state.settings.judgeProvider)
              ? state.settings.judgeProvider
              : null
          return {
            settings: { ...state.settings, selectedProviders: next, roles, judgeProvider },
          }
        })
      },

      updateRole: (provider, role) => {
        set((state) => ({
          settings: {
            ...state.settings,
            roles: state.settings.roles.map((r) =>
              r.provider === provider ? { ...r, role } : r,
            ),
          },
        }))
      },
    }),
    {
      name: 'strata-sync-debate-settings',
      partialize: (state) => ({
        settings: {
          mode: state.settings.mode,
          maxRounds: state.settings.maxRounds,
          selectedProviders: state.settings.selectedProviders,
          roles: state.settings.roles,
          judgeProvider: state.settings.judgeProvider,
          pacingMode: state.settings.pacingMode,
          autoDelay: state.settings.autoDelay,
          // Don't persist reference data (per-session)
          useReference: false,
          referenceText: '',
          referenceFiles: [],
        },
      }),
    },
  ),
)
