import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { DirectorId, ProviderId } from '@/types'
import { DEFAULT_PERSONA_MODELS, DEFAULT_MODEL_ID, MODEL_OPTIONS, envKeyForProvider } from '@/lib/modelConfig'
import { BFS_DEFAULT_HOPS, BFS_DEFAULT_MAX_DOCS } from '@/lib/constants'
import type { VaultPersonaConfig } from '@/lib/personaVaultConfig'

// Sentinel key used when migrating legacy single settings to per-vault Record
export const MIGRATED_CONFIG_KEY = '__migrated__'

// ── Search / RAG tuning config ────────────────────────────────────────────────

export interface SearchConfig {
  // Filename vs body weight
  filenameWeight: number          // score per filename hit (default 10)
  bodyWeight: number              // score per body hit (default 1)
  // Recency boost
  recencyHalfLifeDays: number     // half-life in days (default 180)
  recencyCoeffNormal: number      // normal query recency coefficient (default 0.4)
  recencyCoeffHot: number         // recency intent query recency coefficient (default 2.0)
  // Candidate counts
  directCandidatesNormal: number  // normal query direct search candidates (default 20)
  directCandidatesRecency: number // recency intent direct search candidates (default 50)
  directHitSeeds: number          // top N direct search results to use as BFS seeds (default 8)
  bm25Candidates: number          // BM25 fallback candidates (default 8)
  rerankSeeds: number             // seed count after rerank (default 5)
  // Thresholds
  minDirectHitScore: number       // hasStrongDirectHit threshold (default 0.2)
  minPinnedScore: number          // full body direct injection threshold (default 0.4)
  minBm25Score: number            // BM25 minimum valid score (default 0.05)
  // Reranking weights
  rerankVectorWeight: number      // vector score weight (default 0.6)
  rerankKeywordWeight: number     // keyword score weight (default 0.3)
  // Graph traversal
  bfsMaxHops: number              // BFS max hops (default 3)
  bfsMaxDocs: number              // BFS max collected documents (default 20)
  // Small vault full injection
  fullVaultThreshold: number      // inject all without RAG if total vault chars is below this (0=disabled, default 60000)
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
  bfsMaxHops: BFS_DEFAULT_HOPS,
  bfsMaxDocs: BFS_DEFAULT_MAX_DOCS,
  fullVaultThreshold: 60000,
}

// ── Per-vault integration config types ────────────────────────────────────────

export interface ConfluenceConfig {
  baseUrl: string
  /** Auth type:
   *  cloud       — Atlassian Cloud: Basic auth (email + API token)
   *  server_pat  — Server/Data Center: Bearer PAT (token only, no email needed)
   *  server_basic — Server/Data Center: Basic auth (username + password) */
  authType: 'cloud' | 'server_pat' | 'server_basic'
  email: string      // cloud/server_basic: email or username
  apiToken: string   // cloud/server_basic: API token or password; server_pat: PAT
  spaceKey: string
  targetFolder: string
  /** Minimum creation date for pages to fetch (YYYY-MM-DD). Default: 2026-01-01 */
  dateFrom: string
  /** Maximum creation date for pages to fetch (YYYY-MM-DD). Empty means no limit */
  dateTo: string
  bypassSSL: boolean
  autoSync: boolean
  autoSyncIntervalMinutes: number
}

export interface JiraConfig {
  baseUrl: string
  email: string
  apiToken: string
  projectKey: string
  jql: string
  authType: 'cloud' | 'server_pat' | 'server_basic'
  bypassSSL: boolean
  dateFrom: string
  dateTo: string
  targetFolder: string            // auto-sync save folder (default: 'jira')
  autoSync: boolean               // auto-sync enabled
  autoSyncIntervalMinutes: number // sync interval (minutes, default: 60)
}

const DEFAULT_DATE_FROM = '2026-01-01'

// ── Jira Team Member ───────────────────────────────────────────────────────────

export interface JiraTeamMember {
  id: string              // local UUID
  name: string
  jiraAccountId: string   // from Jira API
  role: string            // art director, game designer etc.
  responsibilities: string  // multiline plain text
  component: string       // Jira component name (e.g., [V1_Art] Concept Art)
}

// ── Edit Agent config ──────────────────────────────────────────────────────────

export interface EditAgentConfig {
  /** Whether the autonomous wake cycle is enabled */
  enabled: boolean
  /** Wake interval in minutes (default 30) */
  intervalMinutes: number
  /** Model ID to use for file refinement */
  modelId: string
  /** User-editable refinement manual (system prompt for the agent) */
  refinementManual: string
  /** Confluence auto-import (runs every wake cycle) */
  syncConfluence: boolean
  /** Jira auto-import (runs every wake cycle) */
  syncJira: boolean
}

export const DEFAULT_EDIT_AGENT_CONFIG: EditAgentConfig = {
  enabled: false,
  intervalMinutes: 30,
  modelId: DEFAULT_PERSONA_MODELS.chief_director,
  syncConfluence: false,
  syncJira: false,
  refinementManual:
`You are an editing agent that autonomously manages and improves markdown documents in an Obsidian vault.

Available tools:
- list_directory: List files in a directory
- read_file / write_file: Read/write files
- rename_file / delete_file / create_folder / move_file: File management
- run_python_tool: Run Python scripts in tools/ folder (normalize_frontmatter, enhance_wikilinks, inject_keywords, gen_index, check_quality, etc.)
- confluence_import: Import Confluence pages → convert to MD → save to vault
- jira_import: Import Jira issues → convert to MD → save to vault
- web_search: Web search
- gstack: Headless browser (goto/snapshot/click/fill/js/text)

Primary tasks:
1. Add cross-references and wikilinks ([[links]]) between documents
2. Structure improvement: optimize markdown formatting (headers, lists, tables, etc.)
3. Improve RAG search quality: enhance key terms and tags
4. Detect and standardize duplicate content
5. Batch process large numbers of files with Python tools

Editing principles:
- Never change the meaning or facts of the original text
- Improve only structure and connections without adding unnecessary content
- Keep changes to a minimum`,
}

export const DEFAULT_CONFLUENCE_CONFIG: ConfluenceConfig = {
  baseUrl: '', authType: 'cloud', email: '', apiToken: '', spaceKey: '',
  targetFolder: 'active', dateFrom: DEFAULT_DATE_FROM, dateTo: '',
  bypassSSL: false, autoSync: false, autoSyncIntervalMinutes: 60,
}

export const DEFAULT_JIRA_CONFIG: JiraConfig = {
  baseUrl: '', email: '', apiToken: '', projectKey: '', jql: '',
  authType: 'cloud', bypassSSL: false, dateFrom: DEFAULT_DATE_FROM, dateTo: '',
  targetFolder: 'jira', autoSync: false, autoSyncIntervalMinutes: 60,
}

// ── State interface ────────────────────────────────────────────────────────────

export type ParagraphRenderQuality = 'high' | 'medium' | 'fast'

export interface ProjectInfo {
  name: string
  engine: string
  genre: string
  platform: string
  scale: string
  teamSize: string
  description: string
  /** Team members in plain-text format: "art: 홍길동, 이순신\nchief: 김철수" */
  teamMembers: string
  /** Raw project info as pasted/uploaded MD content (replaces individual fields in UI) */
  rawProjectInfo: string
  /** Current real-world situation to supplement vault data (MD format, injected into AI prompts) */
  currentSituation: string
}

export const DEFAULT_RAG_INSTRUCTION =
`Document reference priority:
- If _index.md is attached, read it first to understand the overall project structure and latest status.
- When multiple documents are provided, use the document with the most recent date/modified date as the definitive reference and answer based on the most current state.
- When latest documents and older documents conflict, always prioritize the latest data and perform all of the following:
  1. Clearly summarize what changed and how (before vs after)
  2. Infer why it changed from the document context
  3. Derive deep contextual implications for the project direction (trends, risks, opportunities)
- Use historical data only as 'context/background' for changes, not as basis for current state judgments.

Document analysis and insight extraction:
- Do not summarize attached documents individually — synthesize them as a whole to identify patterns, risks, and opportunities.
- Actively find recurring issues, contradictions, and unresolved items across multiple documents.
- Present actionable recommendations (action items) from my director role perspective.
- Even without documents, answer using general game development knowledge, but always prioritize documents when available.
- When evidence exists in document content, actively perform pattern analysis, trend inference, and risk prediction.

Factual accuracy principles:
- Use only specific facts (names, dates, numbers, quotes) explicitly stated in documents — never fabricate them.
- When specific facts not found in documents are needed, state "not in documents" and supplement with general principles.
- Analysis, interpretation, and recommendations are allowed when sources are cited. Use the form "Based on these documents...".`

export const DEFAULT_RESPONSE_INSTRUCTIONS =
`Response principles:
- Look beyond the surface question to understand the actual intent and context, then answer more deeply and practically.
- Don't just answer what's asked — proactively address hidden problems or next steps behind the question.
- Don't write like an official document or briefing report. Answer as if speaking directly to the conversation partner.
- Avoid document-submission-style expressions like "comprehensive analysis briefing" or "review complete".
- Deliver key points in a natural flow without overusing titles and subtitles.`

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
  /** Citation mode: workers extract verbatim quotes instead of summaries; chief marks inferences as (추론) */
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
  /** Per-vault Jira configurations (keyed by vault ID) */
  jiraConfigs: Record<string, JiraConfig>
  /** Per-vault Confluence configurations (keyed by vault ID) */
  confluenceConfigs: Record<string, ConfluenceConfig>
  /** Search / RAG scoring parameters */
  searchConfig: SearchConfig
  /** Whether the 2-pass self-review LLM call is enabled in bot.py */
  selfReview: boolean
  /** Number of sub-agents for multi-agent RAG in bot.py */
  nAgents: number

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
  /** Bookmarked document IDs (persisted) */
  bookmarkedDocIds: string[]
  toggleBookmark: (docId: string) => void
  setMultiAgentRAG: (enabled: boolean) => void
  setWebSearch: (enabled: boolean) => void
  setCitationMode: (enabled: boolean) => void
  setRagInstruction: (v: string) => void
  setSensitiveKeywords: (v: string) => void
  setConfluenceConfigForVault: (vaultId: string, c: Partial<ConfluenceConfig>) => void
  setSlackBotConfig: (c: Partial<{ botToken: string; appToken: string; model: string }>) => void
  setJiraConfigForVault: (vaultId: string, c: Partial<JiraConfig>) => void
  setSearchConfig: (c: Partial<SearchConfig>) => void
  resetSearchConfig: () => void
  setSelfReview: (v: boolean) => void
  setNAgents: (v: number) => void
  /** Edit Agent autonomous refinement configuration */
  editAgentConfig: EditAgentConfig
  setEditAgentConfig: (c: Partial<EditAgentConfig>) => void
  /** Jira dispatch team roster */
  jiraTeamMembers: JiraTeamMember[]
  setJiraTeamMembers: (members: JiraTeamMember[]) => void
}

/** Resolve API key for a provider: settings store first, then env var fallback */
export function getApiKey(provider: ProviderId): string | undefined {
  const storeKey = useSettingsStore.getState().apiKeys[provider]?.trim()
  if (storeKey) return storeKey
  const envKey = envKeyForProvider(provider)
  return (import.meta.env as Record<string, string>)[envKey]?.trim() || undefined
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
      projectInfo: { ...DEFAULT_PROJECT_INFO },
      directorBios: {},
      customPersonas: [],
      personaPromptOverrides: {},
      disabledPersonaIds: [],
      editorDefaultLocked: false,
      paragraphRenderQuality: 'fast' as ParagraphRenderQuality,
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
      jiraConfigs: {},
      confluenceConfigs: {},
      slackBotConfig: { botToken: '', appToken: '', model: DEFAULT_PERSONA_MODELS.chief_director },
      searchConfig: { ...DEFAULT_SEARCH_CONFIG },
      selfReview: true,
      nAgents: 6,
      editAgentConfig: { ...DEFAULT_EDIT_AGENT_CONFIG },
      jiraTeamMembers: [],

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
      setConfluenceConfigForVault: (vaultId, c) =>
        set(s => ({
          confluenceConfigs: {
            ...s.confluenceConfigs,
            [vaultId]: { ...(s.confluenceConfigs[vaultId] ?? DEFAULT_CONFLUENCE_CONFIG), ...c },
          },
        })),
      setSlackBotConfig: (c) => set(s => ({ slackBotConfig: { ...s.slackBotConfig, ...c } })),
      setSearchConfig: (c) => set(s => ({ searchConfig: { ...s.searchConfig, ...c } })),
      resetSearchConfig: () => set({ searchConfig: { ...DEFAULT_SEARCH_CONFIG } }),
      setSelfReview: (selfReview) => set({ selfReview }),
      setNAgents: (nAgents) => set({ nAgents }),
      setEditAgentConfig: (c) => set(s => ({ editAgentConfig: { ...s.editAgentConfig, ...c } })),
      setJiraTeamMembers: (jiraTeamMembers) => set({ jiraTeamMembers }),
      setJiraConfigForVault: (vaultId, c) =>
        set(s => ({
          jiraConfigs: {
            ...s.jiraConfigs,
            [vaultId]: { ...(s.jiraConfigs[vaultId] ?? DEFAULT_JIRA_CONFIG), ...c },
          },
        })),
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
        confluenceConfigs: state.confluenceConfigs,
        slackBotConfig: state.slackBotConfig,
        jiraConfigs: state.jiraConfigs,
        searchConfig: state.searchConfig,
        selfReview: state.selfReview,
        nAgents: state.nAgents,
        editAgentConfig: state.editAgentConfig,
        jiraTeamMembers: state.jiraTeamMembers,
      }),
      // Migrate persisted data: replace old/removed model IDs with defaults
      merge: (persisted, current) => {
        const stored = persisted as Partial<SettingsState> & {
          confluenceConfig?: ConfluenceConfig
          jiraConfig?: JiraConfig
        }
        // Migrate old single config → per-vault Records (one-time backward compat)
        const confluenceConfigs: Record<string, ConfluenceConfig> =
          stored.confluenceConfigs
          ?? (stored.confluenceConfig
            ? { [MIGRATED_CONFIG_KEY]: { ...DEFAULT_CONFLUENCE_CONFIG, ...stored.confluenceConfig } }
            : {})
        const jiraConfigsRaw: Record<string, JiraConfig> =
          stored.jiraConfigs
          ?? (stored.jiraConfig
            ? { [MIGRATED_CONFIG_KEY]: { ...DEFAULT_JIRA_CONFIG, ...stored.jiraConfig } }
            : {})
        // 신규 필드(targetFolder, autoSync 등) 누락 시 기본값으로 채움
        const jiraConfigs: Record<string, JiraConfig> = Object.fromEntries(
          Object.entries(jiraConfigsRaw).map(([k, v]) => [k, { ...DEFAULT_JIRA_CONFIG, ...v }])
        )
        return {
          ...current,
          ...stored,
          personaModels: migratePersonaModels(
            stored.personaModels ?? { ...DEFAULT_PERSONA_MODELS }
          ),
          confluenceConfigs,
          jiraConfigs,
          slackBotConfig: { ...current.slackBotConfig, ...(stored.slackBotConfig ?? {}) },
          searchConfig: (() => {
            const sc = stored.searchConfig as (Partial<SearchConfig> & Record<string, number>) ?? {}
            const merged = { ...DEFAULT_SEARCH_CONFIG, ...sc }
            // Migrate old field names → new names (one-time backward compat)
            if ('tfIdfCandidates' in sc && !('bm25Candidates' in sc)) merged.bm25Candidates = sc['tfIdfCandidates'] as number
            if ('minTfIdfScore' in sc && !('minBm25Score' in sc)) merged.minBm25Score = sc['minTfIdfScore'] as number
            return merged
          })(),
          selfReview: stored.selfReview ?? current.selfReview,
          nAgents: stored.nAgents ?? current.nAgents,
          editAgentConfig: stored.editAgentConfig
            ? { ...DEFAULT_EDIT_AGENT_CONFIG, ...stored.editAgentConfig }
            : current.editAgentConfig,
        }
      },
    }
  )
)
