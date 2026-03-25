import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { DirectorId, ProviderId } from '@/types'
import { DEFAULT_MODEL_ID, DEFAULT_FAST_MODEL_ID, DEFAULT_PERSONA_MODELS, MODEL_OPTIONS, envKeyForProvider } from '@/lib/modelConfig'
import type { VaultPersonaConfig } from '@/lib/personaVaultConfig'

// Search / RAG tuning config

export interface SearchConfig {
  // Filename vs body weight
  filenameWeight: number          // score per filename hit (default 10)
  bodyWeight: number              // score per body hit (default 1)
  // Recency boost
  recencyHalfLifeDays: number     // half-life in days (default 180)
  recencyCoeffNormal: number      // recency coefficient for normal queries (default 0.4)
  recencyCoeffHot: number         // recency coefficient for hot/recent queries (default 2.0)
  // Candidate counts
  directCandidatesNormal: number  // direct search candidates for normal queries (default 20)
  directCandidatesRecency: number // direct search candidates for recency queries (default 50)
  directHitSeeds: number          // top N direct hits used as BFS seeds (default 8)
  bm25Candidates: number          // BM25 fallback candidate count (default 8)
  rerankSeeds: number             // seed count after reranking (default 5)
  // Thresholds
  minDirectHitScore: number       // hasStrongDirectHit threshold (default 0.2)
  minPinnedScore: number          // full-body direct injection threshold (default 0.4)
  minBm25Score: number            // BM25 minimum valid score (default 0.05)
  // Reranking weights
  rerankVectorWeight: number      // vector score weight (default 0.6)
  rerankKeywordWeight: number     // keyword score weight (default 0.3)
  // Graph traversal
  bfsMaxHops: number              // BFS max hops (default 3)
  bfsMaxDocs: number              // BFS max collected docs (default 20)
  // Small vault full injection
  fullVaultThreshold: number      // inject entire vault if char count <= this (0=disabled, default 60000)
}

export const DEFAULT_SEARCH_CONFIG: SearchConfig = {
  filenameWeight: 10,
  bodyWeight: 1,
  recencyHalfLifeDays: 180,
  recencyCoeffNormal: 0.4,
  recencyCoeffHot: 2.0,
  directCandidatesNormal: 20,
  directCandidatesRecency: 50,
  directHitSeeds: 8,
  bm25Candidates: 8,
  rerankSeeds: 5,
  minDirectHitScore: 0.2,
  minPinnedScore: 0.4,
  minBm25Score: 0.05,
  rerankVectorWeight: 0.6,
  rerankKeywordWeight: 0.3,
  bfsMaxHops: 3,
  bfsMaxDocs: 20,
  fullVaultThreshold: 60000,
}

// Edit Agent config

export interface EditAgentConfig {
  /** Whether the autonomous wake cycle is enabled */
  enabled: boolean
  /** Wake interval in minutes (default 30) */
  intervalMinutes: number
  /** Model ID to use for file refinement */
  modelId: string
  /** User-editable refinement manual (system prompt for the agent) */
  refinementManual: string
}

export const DEFAULT_EDIT_AGENT_CONFIG: EditAgentConfig = {
  enabled: false,
  intervalMinutes: 30,
  modelId: DEFAULT_MODEL_ID,
  refinementManual:
`You are an editing agent that autonomously manages and improves markdown documents in an Obsidian vault.

Available tools:
- list_directory: List files in a directory
- read_file / write_file: Read/write files
- rename_file / delete_file / create_folder / move_file: File management
- run_python_tool: Run Python scripts from tools/ folder (normalize_frontmatter, enhance_wikilinks, inject_keywords, gen_index, check_quality, etc.)
- web_search: Web search
- gstack: Headless browser (goto/snapshot/click/fill/js/text)

Primary tasks:
1. Add cross-references and wikilinks ([[links]]) between documents
2. Improve structure: optimize markdown formatting with headers, lists, tables, etc.
3. Improve RAG search quality: enrich key keywords and tags
4. Detect duplicate content and standardize
5. Batch process files using Python tools

Editing principles:
- Never change the original meaning or facts
- Only improve structure and connections — no unnecessary additions
- Keep changes minimal`,
}

// Confluence import config

export interface ConfluenceConfig {
  baseUrl: string
  spaceKey: string
  authType: 'cloud' | 'server_basic' | 'server_pat'
  email: string
  apiToken: string
  bypassSSL: boolean
  dateFrom: string
  dateTo: string
}

export const DEFAULT_CONFLUENCE_CONFIG: ConfluenceConfig = {
  baseUrl: '',
  spaceKey: '',
  authType: 'cloud',
  email: '',
  apiToken: '',
  bypassSSL: false,
  dateFrom: '',
  dateTo: '',
}

// State interface

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
  /** Mapping: director persona -> selected model ID */
  personaModels: Record<DirectorId, string>
  /** User-provided API keys (persisted in localStorage) */
  apiKeys: Partial<Record<ProviderId, string>>
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
  /** Web search: Worker LLM autonomously decides whether to search DuckDuckGo */
  webSearch: boolean
  /** Citation mode: workers extract verbatim quotes instead of summaries; chief marks inferences */
  citationMode: boolean
  /** Global RAG document-reference instructions (injected into every persona's system prompt) */
  ragInstruction: string
  /** Keywords the AI should pay special attention to — injected as priority context when matched in query */
  sensitiveKeywords: string
  /** Slack bot configuration */
  slackBotConfig: {
    botToken: string
    appToken: string
    model: string
  }
  /** Search / RAG scoring parameters */
  searchConfig: SearchConfig
  /** Whether the 2-pass self-review LLM call is enabled */
  selfReview: boolean
  /** Number of sub-agents for multi-agent RAG */
  nAgents: number
  /** Bookmarked document IDs (persisted) */
  bookmarkedDocIds: string[]
  /** Edit Agent autonomous refinement configuration */
  editAgentConfig: EditAgentConfig
  /** Confluence import configuration */
  confluenceConfig: ConfluenceConfig

  setPersonaModel: (persona: DirectorId, modelId: string) => void
  resetPersonaModels: () => void
  setApiKey: (provider: ProviderId, key: string) => void
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
  toggleBookmark: (docId: string) => void
  setMultiAgentRAG: (enabled: boolean) => void
  setWebSearch: (enabled: boolean) => void
  setCitationMode: (enabled: boolean) => void
  setRagInstruction: (v: string) => void
  setSensitiveKeywords: (v: string) => void
  setSlackBotConfig: (c: Partial<{ botToken: string; appToken: string; model: string }>) => void
  setSearchConfig: (c: Partial<SearchConfig>) => void
  resetSearchConfig: () => void
  setSelfReview: (v: boolean) => void
  setNAgents: (v: number) => void
  setEditAgentConfig: (c: Partial<EditAgentConfig>) => void
  setConfluenceConfig: (c: Partial<ConfluenceConfig>) => void
}

/** Resolve API key for a provider: settings store first, then env var fallback */
export function getApiKey(provider: ProviderId): string | undefined {
  const storeKey = useSettingsStore.getState().apiKeys[provider]?.trim()
  if (storeKey) return storeKey
  const envKey = envKeyForProvider(provider)
  return (import.meta.env as Record<string, string>)[envKey]?.trim() || undefined
}

// Migration: replace defunct model IDs with current defaults

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

// Store

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      personaModels: { ...DEFAULT_PERSONA_MODELS },
      apiKeys: {},
      projectInfo: { ...DEFAULT_PROJECT_INFO },
      directorBios: {},
      customPersonas: [],
      personaPromptOverrides: {},
      disabledPersonaIds: [],
      editorDefaultLocked: false,
      paragraphRenderQuality: 'high' as ParagraphRenderQuality,
      showNodeLabels: false,
      tagPresets: [],
      tagColors: {},
      folderColors: {},
      responseInstructions: DEFAULT_RESPONSE_INSTRUCTIONS,
      personaDocumentIds: {},
      reportModelId: DEFAULT_MODEL_ID,
      bookmarkedDocIds: [],
      multiAgentRAG: true,
      webSearch: true,
      citationMode: false,
      ragInstruction: DEFAULT_RAG_INSTRUCTION,
      sensitiveKeywords: '',
      slackBotConfig: { botToken: '', appToken: '', model: DEFAULT_MODEL_ID },
      searchConfig: { ...DEFAULT_SEARCH_CONFIG },
      selfReview: true,
      nAgents: 6,
      editAgentConfig: { ...DEFAULT_EDIT_AGENT_CONFIG },
      confluenceConfig: { ...DEFAULT_CONFLUENCE_CONFIG },

      setPersonaModel: (persona, modelId) =>
        set((state) => ({
          personaModels: { ...state.personaModels, [persona]: modelId },
        })),

      resetPersonaModels: () =>
        set({ personaModels: { ...DEFAULT_PERSONA_MODELS } }),

      setApiKey: (provider, key) =>
        set((state) => ({
          apiKeys: { ...state.apiKeys, [provider]: key?.trim() || undefined },
        })),

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
          disabledPersonaIds: [],
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
      toggleBookmark: (docId) =>
        set((s) => ({
          bookmarkedDocIds: s.bookmarkedDocIds.includes(docId)
            ? s.bookmarkedDocIds.filter(id => id !== docId)
            : [...s.bookmarkedDocIds, docId],
        })),
      setMultiAgentRAG: (multiAgentRAG) => set({ multiAgentRAG }),
      setWebSearch: (webSearch) => set({ webSearch }),
      setCitationMode: (citationMode) => set({ citationMode }),
      setRagInstruction: (ragInstruction) => set({ ragInstruction }),
      setSensitiveKeywords: (sensitiveKeywords) => set({ sensitiveKeywords }),
      setSlackBotConfig: (c) => set(s => ({ slackBotConfig: { ...s.slackBotConfig, ...c } })),
      setSearchConfig: (c) => set(s => ({ searchConfig: { ...s.searchConfig, ...c } })),
      resetSearchConfig: () => set({ searchConfig: { ...DEFAULT_SEARCH_CONFIG } }),
      setSelfReview: (selfReview) => set({ selfReview }),
      setNAgents: (nAgents) => set({ nAgents }),
      setEditAgentConfig: (c) => set(s => ({ editAgentConfig: { ...s.editAgentConfig, ...c } })),
      setConfluenceConfig: (c) => set(s => ({ confluenceConfig: { ...s.confluenceConfig, ...c } })),
    }),
    {
      name: 'strata-sync-settings',
      partialize: (state) => ({
        personaModels: state.personaModels,
        apiKeys: state.apiKeys,
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
        bookmarkedDocIds: state.bookmarkedDocIds,
        multiAgentRAG: state.multiAgentRAG,
        webSearch: state.webSearch,
        citationMode: state.citationMode,
        ragInstruction: state.ragInstruction,
        sensitiveKeywords: state.sensitiveKeywords,
        slackBotConfig: state.slackBotConfig,
        searchConfig: state.searchConfig,
        selfReview: state.selfReview,
        nAgents: state.nAgents,
        editAgentConfig: state.editAgentConfig,
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
          slackBotConfig: { ...current.slackBotConfig, ...(stored.slackBotConfig ?? {}) },
          searchConfig: (() => {
            const sc = stored.searchConfig as (Partial<SearchConfig> & Record<string, number>) ?? {}
            const merged = { ...DEFAULT_SEARCH_CONFIG, ...sc }
            // Migrate old field names -> new names (one-time backward compat)
            if ('tfIdfCandidates' in sc && !('bm25Candidates' in sc)) merged.bm25Candidates = sc['tfIdfCandidates'] as number
            if ('minTfIdfScore' in sc && !('minBm25Score' in sc)) merged.minBm25Score = sc['minTfIdfScore'] as number
            return merged
          })(),
          selfReview: stored.selfReview ?? current.selfReview,
          nAgents: stored.nAgents ?? current.nAgents,
          editAgentConfig: stored.editAgentConfig
            ? { ...DEFAULT_EDIT_AGENT_CONFIG, ...stored.editAgentConfig }
            : current.editAgentConfig,
          confluenceConfig: stored.confluenceConfig
            ? { ...DEFAULT_CONFLUENCE_CONFIG, ...stored.confluenceConfig }
            : current.confluenceConfig,
        }
      },
    }
  )
)
