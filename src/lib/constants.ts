/**
 * constants.ts — Project-wide global constants
 *
 * Centralizes hard-coded values previously scattered across multiple files.
 */

// ── Vault / File System ────────────────────────────────────────────────────────

/** Path to the persona config file within the vault (relative to vault root) */
export const PERSONA_CONFIG_PATH = '.strata-sync/personas.md'

/** Path to the edit-agent log file within the vault (relative to vault root) */
export const EDIT_AGENT_LOG_PATH = '.strata-sync/edit-agent-logs.jsonl'

// ── Chat ──────────────────────────────────────────────────────────────────────

/** Per-persona start delay (ms) when streaming multiple personas simultaneously */
export const STREAM_STAGGER_MS = 100

/** Max file size for chat attachments / debate reference files (10 MB) */
export const MAX_FILE_SIZE = 10 * 1024 * 1024

// ── Graph ────────────────────────────────────────────────────────────────────

/** Default strength for graph edges created from wikilinks */
export const DEFAULT_LINK_STRENGTH = 0.5

/** Minimum pixel gap between node labels to prevent overlap (Graph2D / Graph2DCanvas) */
export const LABEL_MIN_GAP = 64

/** Viewport padding pixels used for fit-to-view (Graph2D / Graph2DCanvas) */
export const GRAPH_VIEW_PADDING = 48

// ── Agent / LLM ──────────────────────────────────────────────────────────────

/** Maximum output tokens for agent LLM calls */
export const AGENT_MAX_OUTPUT_TOKENS = 8096

/** Maximum characters per file sent to the edit agent LLM */
export const EDIT_AGENT_MAX_FILE_CHARS = 12000

// ── TF-IDF / Graph Analysis ───────────────────────────────────────────────────

/** Maximum number of documents for O(N²) implicit link computation */
export const TFIDF_MAX_DOCS = 250

// ── RAG / BFS ─────────────────────────────────────────────────────────────────

/** Default maximum hop count for BFS graph traversal */
export const BFS_DEFAULT_HOPS = 3

/** Default maximum document count for BFS graph traversal */
export const BFS_DEFAULT_MAX_DOCS = 20

// ── Backend ──────────────────────────────────────────────────────────────────

/** Default port for the Python FastAPI backend */
export const BACKEND_DEFAULT_PORT = 7331
