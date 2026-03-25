// ── Speaker / Director types ──────────────────────────────────────────────────

export type SpeakerId =
  | 'chief_director'
  | 'art_director'
  | 'plan_director'
  | 'level_director'
  | 'prog_director'
  | 'unknown'   // Phase 6: fallback when speaker is not specified in vault files

/** The 5 actual director personas (excludes the 'unknown' fallback). */
export type DirectorId = Exclude<SpeakerId, 'unknown'>

/** AI provider identity (authoritative definition). */
export type ProviderId = 'anthropic' | 'openai' | 'gemini' | 'grok'

/** All possible participants in a discussion: AI providers, directors, or the user. */
export type DiscussionParticipantId = ProviderId | DirectorId | 'user'

// ── Document model ────────────────────────────────────────────────────────────

export interface DocSection {
  /** Unique ID — also serves as wiki-link target slug */
  id: string
  heading: string
  body: string
  /** List of [[slug]] references found in this section's body */
  wikiLinks: string[]
}

export interface MockDocument {
  id: string
  filename: string
  /** Folder path relative to vault root. Empty string for mock data. */
  folderPath: string
  /** Absolute filesystem path. Empty string for mock data. */
  absolutePath: string
  speaker: SpeakerId
  date: string
  /** File last-modified timestamp (ms) — from filesystem stat */
  mtime?: number
  tags: string[]
  /** Top-level [[wiki-link]] references in frontmatter */
  links: string[]
  sections: DocSection[]
  /** Full markdown string including YAML frontmatter (for FrontmatterBlock display) */
  rawContent: string
  /** Image filenames referenced via ![[image.png]] embeds in this document */
  imageRefs?: string[]
}

// ── Graph types ───────────────────────────────────────────────────────────────

export interface GraphNode {
  id: string
  docId: string
  speaker: SpeakerId
  /** Truncated section heading for display */
  label: string
  /** Folder path relative to vault root (for folder color mode) */
  folderPath?: string
  /** Tags from frontmatter (for tag color mode) */
  tags?: string[]
  /** True for image nodes created from ![[...]] embeds */
  isImage?: boolean
  // d3-force mutable position fields
  x?: number
  y?: number
  z?: number
  vx?: number
  vy?: number
  vz?: number
  fx?: number | null
  fy?: number | null
  fz?: number | null
}

export interface GraphLink {
  source: string | GraphNode
  target: string | GraphNode
  strength?: number
}

export interface PhysicsParams {
  /** Center attraction force — range 0.0–1.0, default 0.05 */
  centerForce: number
  /** Node repulsion (charge) — range -1000–0, default -300 */
  charge: number
  /** Link attraction strength — range 0.0–2.0, default 0.5 */
  linkStrength: number
  /** Base link distance in px — range 20–300, default 80 */
  linkDistance: number
  /** Wire (edge) opacity — range 0.0–1.0, default 0.4 */
  linkOpacity: number
  /** Node sphere radius in 2D px — range 2–20, default 7 */
  nodeRadius: number
}

// ── Attachment types (Feature 4) ──────────────────────────────────────────────

/**
 * A file attached to a chat message.
 * - type 'image': dataUrl is a base64 data URL (e.g. "data:image/png;base64,...")
 * - type 'text':  dataUrl holds the raw UTF-8 text content
 */
export interface Attachment {
  id: string
  name: string
  type: 'image' | 'text'
  mimeType: string
  dataUrl: string
  size: number
}

// ── Chat types ────────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string
  persona: SpeakerId
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  /** True while the assistant is still streaming tokens into this message */
  streaming?: boolean
  /** Files attached to this message (images for vision, text for context injection) */
  attachments?: Attachment[]
  /** Sub-agent/thinking process streamed before the main response */
  thinking?: string
}

// ── Vault types (Phase 6) ─────────────────────────────────────────────────────

/** A raw file read from the filesystem vault */
export interface VaultFile {
  relativePath: string   // relative to vault root (e.g. "subdir/note.md")
  absolutePath: string
  content: string        // UTF-8
  mtime?: number         // file modification timestamp (ms)
}

/**
 * A parsed markdown document loaded from the vault.
 * Structurally identical to MockDocument so both can be used interchangeably.
 * speaker may be 'unknown' if frontmatter is missing/invalid.
 */
export interface LoadedDocument {
  id: string
  filename: string
  /** Folder path relative to vault root (e.g. "Onion Flow"). Empty string for root-level files. */
  folderPath: string
  /** Absolute filesystem path (for save/rename/delete operations) */
  absolutePath: string
  speaker: SpeakerId
  date: string
  /** File last-modified timestamp (ms) — from filesystem stat */
  mtime?: number
  tags: string[]
  links: string[]
  sections: DocSection[]
  rawContent: string
  /** Image filenames referenced via ![[image.png]] embeds in this document */
  imageRefs?: string[]
  /** Original source URL (from frontmatter `source:` — Confluence/Jira import) */
  source?: string
  /** Platform origin (e.g. 'confluence', 'jira') */
  origin?: string
  /** Document title from frontmatter */
  title?: string
  /** Document type from frontmatter: 'spec' | 'decision' | 'meeting' | 'guide' | 'reference' */
  type?: string
  /** Document lifecycle status from frontmatter: 'active' | 'outdated' | 'deprecated' */
  status?: string
  /** Wikilink to the document that supersedes this one (e.g. "[[new_doc]]") */
  supersededBy?: string
  /** Structural hub links from frontmatter `related:` (separate from wiki-link body references) */
  related?: string[]
  /**
   * Graph RAG link weight hint from frontmatter `graph_weight:`.
   * - normal (default): standard traversal, link weight 1.0
   * - low: traverse but link weight ~0.3 (100-499 outbound links)
   * - skip: exclude from RAG traversal entirely (500+ outbound links, link-only hubs)
   */
  graphWeight?: 'normal' | 'low' | 'skip'
  /** Multi-vault: vault label this document belongs to (for Slack RAG context attribution) */
  vaultLabel?: string
}

// ── RAG types ───────────────────────────────────────────────────────────────

/** A single result from keyword/TF-IDF search */
export interface SearchResult {
  doc_id: string
  filename: string
  section_id: string | null
  heading: string | null
  speaker: string
  content: string
  score: number   // 0.0–1.0 (higher = more relevant)
  tags: string[]
}

// ── Debate / Discussion types ─────────────────────────────────────────────────

export type DiscussionMode = 'roundRobin' | 'freeDiscussion' | 'roleAssignment' | 'battle'
export type DebateStatus = 'idle' | 'running' | 'paused' | 'completed' | 'stopped'

export interface RoleConfig {
  provider: string
  role: string
}

export interface ReferenceFile {
  id: string
  filename: string
  mimeType: string
  size: number
  dataUrl: string
}

export interface DiscussionConfig {
  mode: DiscussionMode
  topic: string
  maxRounds: number
  selectedProviders: string[]
  roles: RoleConfig[]
  judgeProvider?: string
  referenceText: string
  useReference: boolean
  referenceFiles: ReferenceFile[]
  pacingMode: 'auto' | 'manual'
  autoDelay: number
}

export interface DiscussionMessage {
  id: string
  provider: DiscussionParticipantId
  content: string
  round: number
  timestamp: number
  error?: string
  messageType?: 'judge-evaluation'
  roleName?: string
  files?: ReferenceFile[]
}

export interface DebateCallbacks {
  onMessage: (msg: DiscussionMessage) => void
  onStatusChange: (status: DebateStatus) => void
  onRoundChange: (round: number, turnIndex: number) => void
  onLoadingChange: (provider: string | null) => void
  onCountdownTick: (seconds: number) => void
  waitForNextTurn: () => Promise<void>
  getStatus: () => DebateStatus
  getMessages: () => DiscussionMessage[]
}

// ── UI types ──────────────────────────────────────────────────────────────────

export type ThemeId = 'dark' | 'oled' | 'white'
export type GraphMode = '3d' | '2d'
export type CenterTab = 'graph' | 'document' | 'editor' | 'settings'
export type AppState = 'launch' | 'main'
export type NodeColorMode = 'document' | 'auto' | 'speaker' | 'folder' | 'tag' | 'topic'
