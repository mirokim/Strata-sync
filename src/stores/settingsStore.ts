import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { DirectorId } from '@/types'
import type { ProviderId } from '@/lib/modelConfig'
import { DEFAULT_PERSONA_MODELS, MODEL_OPTIONS, envKeyForProvider } from '@/lib/modelConfig'
import type { VaultPersonaConfig } from '@/lib/personaVaultConfig'

// ── State interface ────────────────────────────────────────────────────────────

export type AppTheme = 'light' | 'dark' | 'oled'
export type ParagraphRenderQuality = 'high' | 'medium' | 'fast'

export interface ProjectInfo {
  name: string
  engine: string
  genre: string
  platform: string
  scale: string
  teamSize: string
  description: string
  /** Team members in plain-text format: "art: John, Jane\nchief: Bob" */
  teamMembers: string
  /** Raw project info as pasted/uploaded MD content (replaces individual fields in UI) */
  rawProjectInfo: string
  /** Current real-world situation to supplement vault data (MD format, injected into AI prompts) */
  currentSituation: string
}

export const DEFAULT_RAG_INSTRUCTION =
`Document Reference Priority:
- If _index.md is attached, read it first to understand the overall project structure and current status.
- When multiple documents are provided, treat the most recently dated/modified document as the absolute authority and base your response on the latest state.
- When the latest and older documents conflict, always prioritize the latest data and do all of the following:
  1. Clearly summarize what changed and how (before vs. after)
  2. Infer why it changed from the document context
  3. Derive deep insights about what this change implies for the project direction (trends, risks, opportunities)
- Use past data only as context/background for changes, not as a basis for judging current state.

Document Analysis and Insight Generation:
- Do not summarize attached documents individually; synthesize them holistically to identify patterns, risks, and opportunities.
- Actively identify issues, contradictions, and unresolved matters that recur across multiple documents.
- Present actionable recommendations (action items) from my director role perspective.
- Even without documents, answer using general game development knowledge; if documents exist, always use them first.
- If the document content provides evidence, actively perform pattern analysis, trend inference, and risk prediction.

Factual Accuracy Principles:
- For specific facts like names, dates, numbers, and quotes, use only what is explicitly stated in the documents — never fabricate.
- If specific facts not found in documents are needed, state "not in documents" and supplement with general principles.
- Analysis, interpretation, and recommendations are allowed if sources are cited. Use the form "Synthesizing these documents..." to reveal sources.`

export const DEFAULT_RESPONSE_INSTRUCTIONS =
`Response Principles:
- Understand the actual intent and context beyond the surface question, and respond more deeply and substantively to that.
- Don't just answer what is asked — proactively address the problem hidden behind the question and the next steps.
- Do not write in the style of official documents or briefing reports. Answer as if speaking directly to the person.
- Avoid expressions like "Comprehensive Analysis Briefing" or "Review Complete" that sound like document submissions.
- Convey the key points in a natural flow without overusing headings and subheadings.`

export const DEFAULT_PROJECT_INFO: ProjectInfo = {
  name: '',
  engine: '',
  genre: '',
  platform: '',
  scale: '',
  teamSize: '',
  description: '',
  teamMembers: '',
  rawProjectInfo: '',
  currentSituation: '',
}

export interface CustomPersona {
  id: string
  label: string
  role: string
  color: string
  darkBg: string
  systemPrompt: string
  modelId: string
}

interface SettingsState {
  /** Mapping: director persona → selected model ID */
  personaModels: Record<DirectorId, string>
  /** User-provided API keys (persisted in localStorage) */
  apiKeys: Partial<Record<ProviderId, string>>
  /** Whether the settings panel is open */
  settingsPanelOpen: boolean
  /** UI colour theme */
  theme: AppTheme
  /** Project metadata (injected into AI prompts as context) */
  projectInfo: ProjectInfo
  /** Per-director custom persona descriptions */
  directorBios: Partial<Record<DirectorId, string>>
  /** User-defined additional personas */
  customPersonas: CustomPersona[]
  /** System prompt overrides for built-in director personas */
  personaPromptOverrides: Record<string, string>
  /** Built-in persona IDs that the user has disabled (hidden) */
  disabledPersonaIds: string[]
  /** Whether markdown editor opens in locked (read-only) mode by default */
  editorDefaultLocked: boolean
  /** Paragraph rendering quality: high = full markdown+wikilinks, medium = markdown only, fast = plain text */
  paragraphRenderQuality: ParagraphRenderQuality
  /** Whether node labels are visible in the graph */
  showNodeLabels: boolean
  /** Allowed tag names for AI tag suggestion */
  tagPresets: string[]
  /** User-assigned hex colors per tag name (overrides auto-palette in graph) */
  tagColors: Record<string, string>
  /** User-assigned hex colors per folder path (overrides auto-palette in graph) */
  folderColors: Record<string, string>
  /** Global AI response format instructions (appended to every persona's system prompt) */
  responseInstructions: string
  /** Vault document IDs injected into each persona's system prompt as persona context */
  personaDocumentIds: Record<string, string>
  /** Model ID used for AI-generated conversation reports. Empty string = static format only. */
  reportModelId: string
  /** Multi-agent RAG: cheap worker LLMs summarize secondary docs before chief responds */
  multiAgentRAG: boolean
  /** Global RAG document-reference instructions (injected into every persona's system prompt) */
  ragInstruction: string
  /** Confluence import configuration */
  confluenceConfig: {
    baseUrl: string
    /** Authentication method:
     *  cloud       — Atlassian Cloud: Basic auth (email + API token)
     *  server_pat  — Server/Data Center: Bearer PAT (token only, no email required)
     *  server_basic — Server/Data Center: Basic auth (username + password) */
    authType: 'cloud' | 'server_pat' | 'server_basic'
    email: string      // cloud/server_basic: email or username
    apiToken: string   // cloud/server_basic: API token or password; server_pat: PAT
    spaceKey: string
    targetFolder: string
    /** Minimum creation date for pages to import (YYYY-MM-DD). Default: 2025-01-01 */
    dateFrom: string
    /** Maximum creation date for pages to import (YYYY-MM-DD). Leave empty for no limit */
    dateTo: string
    /** Allow self-signed or corporate CA certificates (on-premises Confluence) */
    bypassSSL: boolean
  }

  setPersonaModel: (persona: DirectorId, modelId: string) => void
  resetPersonaModels: () => void
  setApiKey: (provider: ProviderId, key: string) => void
  setSettingsPanelOpen: (open: boolean) => void
  toggleSettingsPanel: () => void
  setTheme: (theme: AppTheme) => void
  setProjectInfo: (info: Partial<ProjectInfo>) => void
  setDirectorBio: (director: DirectorId, bio: string) => void
  addPersona: (persona: CustomPersona) => void
  updatePersona: (id: string, updates: Partial<Omit<CustomPersona, 'id'>>) => void
  removePersona: (id: string) => void
  setPersonaPromptOverride: (personaId: string, prompt: string) => void
  disableBuiltInPersona: (id: string) => void
  restoreBuiltInPersona: (id: string) => void
  /** Apply persona config loaded from vault file (overrides current state) */
  loadVaultPersonas: (config: VaultPersonaConfig) => void
  /** Reset all persona state to defaults (called when loading a vault with no config) */
  resetVaultPersonas: () => void
  setEditorDefaultLocked: (locked: boolean) => void
  setParagraphRenderQuality: (q: ParagraphRenderQuality) => void
  toggleNodeLabels: () => void
  addTagPreset: (tag: string) => void
  removeTagPreset: (tag: string) => void
  setTagColor: (tag: string, color: string) => void
  setFolderColor: (folderPath: string, color: string) => void
  setResponseInstructions: (v: string) => void
  setPersonaDocumentId: (personaId: string, docId: string | null) => void
  setReportModelId: (id: string) => void
  setMultiAgentRAG: (enabled: boolean) => void
  setRagInstruction: (v: string) => void
  setConfluenceConfig: (c: Partial<{ baseUrl: string; authType: 'cloud' | 'server_pat' | 'server_basic'; email: string; apiToken: string; spaceKey: string; targetFolder: string; dateFrom: string; dateTo: string; bypassSSL: boolean }>) => void
}

/** Resolve API key for a provider: settings store first, then env var fallback */
export function getApiKey(provider: ProviderId): string | undefined {
  const storeKey = useSettingsStore.getState().apiKeys[provider]
  if (storeKey) return storeKey
  const envKey = envKeyForProvider(provider)
  return (import.meta.env as Record<string, string>)[envKey] || undefined
}

// ── Migration: replace defunct model IDs with current defaults ────────────────

const VALID_MODEL_IDS = new Set(MODEL_OPTIONS.map(m => m.id))

function migratePersonaModels(
  stored: Record<DirectorId, string>
): Record<DirectorId, string> {
  const migrated = { ...stored }
  for (const [persona, modelId] of Object.entries(migrated)) {
    if (!VALID_MODEL_IDS.has(modelId)) {
      migrated[persona as DirectorId] =
        DEFAULT_PERSONA_MODELS[persona as DirectorId]
    }
  }
  return migrated
}

// ── Store ──────────────────────────────────────────────────────────────────────

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      personaModels: { ...DEFAULT_PERSONA_MODELS },
      apiKeys: {},
      settingsPanelOpen: false,
      theme: 'dark' as AppTheme,
      projectInfo: { ...DEFAULT_PROJECT_INFO },
      directorBios: {},
      customPersonas: [],
      personaPromptOverrides: {},
      disabledPersonaIds: ['art_director', 'plan_director', 'level_director', 'prog_director'],
      editorDefaultLocked: false,
      paragraphRenderQuality: 'fast' as ParagraphRenderQuality,
      showNodeLabels: false,
      tagPresets: [],
      tagColors: {},
      folderColors: {},
      responseInstructions: DEFAULT_RESPONSE_INSTRUCTIONS,
      personaDocumentIds: {},
      reportModelId: 'claude-sonnet-4-6',
      multiAgentRAG: true,
      ragInstruction: DEFAULT_RAG_INSTRUCTION,
      confluenceConfig: { baseUrl: '', authType: 'cloud' as const, email: '', apiToken: '', spaceKey: '', targetFolder: 'active', dateFrom: '2026-01-01', dateTo: '', bypassSSL: false },

      setPersonaModel: (persona, modelId) =>
        set((state) => ({
          personaModels: { ...state.personaModels, [persona]: modelId },
        })),

      resetPersonaModels: () =>
        set({ personaModels: { ...DEFAULT_PERSONA_MODELS } }),

      setApiKey: (provider, key) =>
        set((state) => ({
          apiKeys: { ...state.apiKeys, [provider]: key || undefined },
        })),

      setSettingsPanelOpen: (open) => set({ settingsPanelOpen: open }),

      toggleSettingsPanel: () =>
        set((state) => ({ settingsPanelOpen: !state.settingsPanelOpen })),

      setTheme: (theme) => set({ theme }),

      setProjectInfo: (info) =>
        set((state) => ({ projectInfo: { ...state.projectInfo, ...info } })),

      setDirectorBio: (director, bio) =>
        set((state) => ({ directorBios: { ...state.directorBios, [director]: bio } })),

      addPersona: (persona) =>
        set((state) => ({ customPersonas: [...state.customPersonas, persona] })),

      updatePersona: (id, updates) =>
        set((state) => ({
          customPersonas: state.customPersonas.map(p => p.id === id ? { ...p, ...updates } : p),
        })),

      removePersona: (id) =>
        set((state) => ({ customPersonas: state.customPersonas.filter(p => p.id !== id) })),

      setPersonaPromptOverride: (personaId, prompt) =>
        set((state) => ({
          personaPromptOverrides: prompt
            ? { ...state.personaPromptOverrides, [personaId]: prompt }
            : Object.fromEntries(Object.entries(state.personaPromptOverrides).filter(([k]) => k !== personaId)),
        })),

      disableBuiltInPersona: (id) =>
        set((state) => ({
          disabledPersonaIds: state.disabledPersonaIds.includes(id)
            ? state.disabledPersonaIds
            : [...state.disabledPersonaIds, id],
        })),

      restoreBuiltInPersona: (id) =>
        set((state) => ({
          disabledPersonaIds: state.disabledPersonaIds.filter(d => d !== id),
        })),

      loadVaultPersonas: (config) =>
        set((state) => ({
          customPersonas: config.customPersonas,
          personaPromptOverrides: config.personaPromptOverrides,
          disabledPersonaIds: config.disabledPersonaIds,
          directorBios: config.directorBios,
          personaModels: migratePersonaModels({
            ...state.personaModels,
            ...config.personaModels,
          }),
        })),

      resetVaultPersonas: () =>
        set({
          customPersonas: [],
          personaPromptOverrides: {},
          disabledPersonaIds: ['art_director', 'plan_director', 'level_director', 'prog_director'],
          directorBios: {},
          personaModels: { ...DEFAULT_PERSONA_MODELS },
        }),

      setEditorDefaultLocked: (editorDefaultLocked) => set({ editorDefaultLocked }),

      setParagraphRenderQuality: (paragraphRenderQuality) => set({ paragraphRenderQuality }),

      toggleNodeLabels: () => set((s) => ({ showNodeLabels: !s.showNodeLabels })),

      addTagPreset: (tag) =>
        set((s) => ({
          tagPresets: s.tagPresets.includes(tag) ? s.tagPresets : [...s.tagPresets, tag],
        })),

      removeTagPreset: (tag) =>
        set((s) => ({
          tagPresets: s.tagPresets.filter(t => t !== tag),
          tagColors: Object.fromEntries(Object.entries(s.tagColors).filter(([k]) => k !== tag)),
        })),

      setTagColor: (tag, color) =>
        set((s) => ({ tagColors: { ...s.tagColors, [tag]: color } })),

      setFolderColor: (folderPath, color) =>
        set((s) => ({ folderColors: { ...s.folderColors, [folderPath]: color } })),

      setResponseInstructions: (responseInstructions) => set({ responseInstructions }),

      setPersonaDocumentId: (personaId, docId) =>
        set((s) => ({
          personaDocumentIds: docId
            ? { ...s.personaDocumentIds, [personaId]: docId }
            : Object.fromEntries(Object.entries(s.personaDocumentIds).filter(([k]) => k !== personaId)),
        })),

      setReportModelId: (reportModelId) => set({ reportModelId }),
      setMultiAgentRAG: (multiAgentRAG) => set({ multiAgentRAG }),
      setRagInstruction: (ragInstruction) => set({ ragInstruction }),
      setConfluenceConfig: (c) => set(s => ({ confluenceConfig: { ...s.confluenceConfig, ...c } })),
    }),
    {
      name: 'strata-sync-settings',
      partialize: (state) => ({
        personaModels: state.personaModels,
        apiKeys: state.apiKeys,
        theme: state.theme,
        projectInfo: state.projectInfo,
        directorBios: state.directorBios,
        customPersonas: state.customPersonas,
        personaPromptOverrides: state.personaPromptOverrides,
        disabledPersonaIds: state.disabledPersonaIds,
        editorDefaultLocked: state.editorDefaultLocked,
        paragraphRenderQuality: state.paragraphRenderQuality,
        showNodeLabels: state.showNodeLabels,
        tagPresets: state.tagPresets,
        tagColors: state.tagColors,
        folderColors: state.folderColors,
        responseInstructions: state.responseInstructions,
        personaDocumentIds: state.personaDocumentIds,
        reportModelId: state.reportModelId,
        multiAgentRAG: state.multiAgentRAG,
        ragInstruction: state.ragInstruction,
        confluenceConfig: state.confluenceConfig,
      }),
      // Migrate persisted data: replace old/removed model IDs with defaults
      merge: (persisted, current) => {
        const stored = persisted as Partial<SettingsState>
        return {
          ...current,
          ...stored,
          personaModels: migratePersonaModels(
            stored.personaModels ?? { ...DEFAULT_PERSONA_MODELS }
          ),
          // Merge with defaults so new fields added to confluenceConfig don't go missing
          confluenceConfig: { ...current.confluenceConfig, ...(stored.confluenceConfig ?? {}) },
        }
      },
    }
  )
)
