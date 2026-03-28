import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { DirectorId, ProviderId } from '@/types'
import { DEFAULT_PERSONA_MODELS, DEFAULT_MODEL_ID, MODEL_OPTIONS, envKeyForProvider } from '@/lib/modelConfig'
import { BFS_DEFAULT_HOPS, BFS_DEFAULT_MAX_DOCS } from '@/lib/constants'
import type { VaultPersonaConfig } from '@/lib/personaVaultConfig'

// 구버전 단일 설정을 per-vault Record로 마이그레이션할 때 사용하는 sentinel 키
export const MIGRATED_CONFIG_KEY = '__migrated__'

// ── Search / RAG tuning config ────────────────────────────────────────────────

export interface SearchConfig {
  // 파일명 vs 본문 가중치
  filenameWeight: number          // 파일명 히트당 점수 (default 10)
  bodyWeight: number              // 본문 히트당 점수 (default 1)
  // Recency boost
  recencyHalfLifeDays: number     // 반감기 일수 (default 180)
  recencyCoeffNormal: number      // 일반 쿼리 recency 계수 (default 0.4)
  recencyCoeffHot: number         // 최신 인텐트 쿼리 recency 계수 (default 2.0)
  // 후보 수
  directCandidatesNormal: number  // 일반 쿼리 직접 검색 후보 수 (default 20)
  directCandidatesRecency: number // 최신 인텐트 직접 검색 후보 수 (default 50)
  directHitSeeds: number          // BFS 시드로 사용할 직접 검색 상위 N개 (default 8)
  bm25Candidates: number          // BM25 폴백 후보 수 (default 8)
  rerankSeeds: number             // rerank 후 시드 수 (default 5)
  // 임계값
  minDirectHitScore: number       // hasStrongDirectHit 임계값 (default 0.2)
  minPinnedScore: number          // 전체 본문 직접 주입 임계값 (default 0.4)
  minBm25Score: number            // BM25 최소 유효 점수 (default 0.05)
  // 리랭킹 가중치
  rerankVectorWeight: number      // 벡터 점수 가중치 (default 0.6)
  rerankKeywordWeight: number     // 키워드 점수 가중치 (default 0.3)
  // 그래프 탐색
  bfsMaxHops: number              // BFS 최대 홉 수 (default 3)
  bfsMaxDocs: number              // BFS 최대 수집 문서 수 (default 20)
  // 소형 볼트 전체 주입
  fullVaultThreshold: number      // 볼트 전체 글자 수가 이 이하이면 RAG 없이 전체 주입 (0=비활성화, default 60000)
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
  /** 인증 방식:
   *  cloud       — Atlassian Cloud: Basic auth (이메일 + API 토큰)
   *  server_pat  — Server/Data Center: Bearer PAT (토큰만, 이메일 불필요)
   *  server_basic — Server/Data Center: Basic auth (사용자명 + 비밀번호) */
  authType: 'cloud' | 'server_pat' | 'server_basic'
  email: string      // cloud/server_basic: 이메일 or 사용자명
  apiToken: string   // cloud/server_basic: API토큰 or 비밀번호; server_pat: PAT
  spaceKey: string
  targetFolder: string
  /** 가져올 페이지의 최소 생성일 (YYYY-MM-DD). 기본: 2026-01-01 */
  dateFrom: string
  /** 가져올 페이지의 최대 생성일 (YYYY-MM-DD). 비어있으면 제한 없음 */
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
  targetFolder: string            // 자동 동기화 저장 폴더 (default: 'jira')
  autoSync: boolean               // 자동 동기화 활성화
  autoSyncIntervalMinutes: number // 동기화 주기 (분, default: 60)
}

const DEFAULT_DATE_FROM = '2026-01-01'

// ── Jira Team Member ───────────────────────────────────────────────────────────

export interface JiraTeamMember {
  id: string              // local UUID
  name: string
  jiraAccountId: string   // from Jira API
  role: string            // 아트 디렉터, 게임 디자이너 etc.
  responsibilities: string  // multiline plain text
  component: string       // Jira 컴포넌트 이름 (예: [V1_아트실] 원화파트)
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
  /** Confluence 자동 가져오기 (웨이크 사이클마다 실행) */
  syncConfluence: boolean
  /** Jira 자동 가져오기 (웨이크 사이클마다 실행) */
  syncJira: boolean
}

export const DEFAULT_EDIT_AGENT_CONFIG: EditAgentConfig = {
  enabled: false,
  intervalMinutes: 30,
  modelId: DEFAULT_PERSONA_MODELS.chief_director,
  syncConfluence: false,
  syncJira: false,
  refinementManual:
`당신은 Obsidian 볼트의 마크다운 문서를 자율적으로 관리·개선하는 편집 에이전트입니다.

사용 가능한 도구:
- list_directory: 디렉토리 파일 목록 조회
- read_file / write_file: 파일 읽기/쓰기
- rename_file / delete_file / create_folder / move_file: 파일 관리
- run_python_tool: tools/ 폴더의 파이썬 스크립트 실행 (normalize_frontmatter, enhance_wikilinks, inject_keywords, gen_index, check_quality 등)
- confluence_import: Confluence 페이지 가져오기 → MD 변환 → 볼트 저장
- jira_import: Jira 이슈 가져오기 → MD 변환 → 볼트 저장
- web_search: 웹 검색
- gstack: 헤드리스 브라우저 (goto/snapshot/click/fill/js/text)

주요 임무:
1. 문서 간 교차 참조 및 위키링크([[링크]]) 추가
2. 구조 개선: 헤더, 목록, 표 등 마크다운 포맷 최적화
3. RAG 검색 품질 향상: 핵심 키워드 및 태그 보강
4. 중복 내용 감지 및 표준화
5. 파이썬 도구로 대량 파일 일괄 처리

편집 원칙:
- 원문의 의미와 사실을 절대 변경하지 마세요
- 불필요한 내용 추가 없이 구조와 연결만 개선하세요
- 변경사항은 최소한으로 유지하세요`,
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
`문서 참조 우선순위:
- _index.md 파일이 첨부된 경우 가장 먼저 읽어 프로젝트 전체 구조와 최신 현황을 파악하세요.
- 여러 문서가 제공될 때는 날짜·수정일이 최신인 문서를 절대적 기준으로 삼아 가장 최근 상태를 기반으로 답변하세요.
- 최신 문서와 과거 문서의 내용이 충돌할 경우, 반드시 최신 데이터를 우선 채택하고 다음을 모두 수행하세요:
  1. 무엇이 어떻게 바뀌었는지 명확히 정리 (변경 전 vs 변경 후)
  2. 왜 바뀌었는지 문서 맥락에서 추론
  3. 이 변화가 프로젝트 방향에 시사하는 바(트렌드·리스크·기회)를 깊은 맥락으로 도출
- 과거 데이터는 변화의 '맥락·배경'으로만 활용하고, 현재 상태 판단의 근거로 삼지 마세요.

문서 분석 및 인사이트 도출:
- 첨부된 문서들을 개별 요약하지 말고, 전체를 종합하여 패턴·리스크·기회를 식별하세요.
- 여러 문서에 걸쳐 반복되는 이슈, 모순, 미결 사항을 적극적으로 찾아내세요.
- 나의 디렉터 역할 관점에서 실행 가능한 권고안(액션 아이템)을 제시하세요.
- 문서가 없는 경우에도 일반적인 게임 개발 지식으로 답변하되, 문서가 있으면 반드시 우선 활용하세요.
- 문서 내용에서 근거가 있다면 패턴 분석·트렌드 추론·리스크 예측을 적극적으로 수행하세요.

사실 정확성 원칙:
- 이름, 날짜, 수치, 인용구 등 구체적 사실은 문서에 명시된 것만 사용하고 절대 지어내지 마세요.
- 문서에서 확인되지 않는 구체적 사실이 필요한 경우 "문서에 없음"이라고 밝히고 일반 원칙으로 보완하세요.
- 분석·해석·권고는 근거를 명시하면 허용됩니다. "이 문서들을 종합하면..." 형태로 출처를 드러내세요.`

export const DEFAULT_RESPONSE_INSTRUCTIONS =
`응답 원칙:
- 질문자의 표면적 질문 너머 실제 의도와 맥락을 파악하여, 그것에 맞춰 더 깊고 실질적으로 답변하세요.
- 단순히 묻는 것만 답하지 말고, 질문 뒤에 숨겨진 문제나 다음 단계까지 선제적으로 짚어주세요.
- 공식 문서나 브리핑 보고서 형태로 작성하지 마세요. 대화 상대에게 직접 말하듯 답변하세요.
- "종합 분석 브리핑", "검토 완료" 같은 문서 제출 형식의 표현은 사용하지 마세요.
- 제목·부제목 남발 없이 자연스러운 흐름으로 핵심을 전달하세요.`

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
