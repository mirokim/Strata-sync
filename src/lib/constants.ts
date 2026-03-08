/**
 * constants.ts — Project-wide global constants
 *
 * Centralizes hard-coded values previously scattered across multiple files.
 */

// ── Vault / File System ────────────────────────────────────────────────────────

/** Path to the persona config file within the vault (relative to vault root) */
export const PERSONA_CONFIG_PATH = '.rembrant/personas.md'

// ── Chat ──────────────────────────────────────────────────────────────────────

/** Per-persona start delay (ms) when streaming multiple personas simultaneously */
export const STREAM_STAGGER_MS = 100

// ── Graph ────────────────────────────────────────────────────────────────────

/** Default strength for graph edges created from wikilinks */
export const DEFAULT_LINK_STRENGTH = 0.5

// ── Debate ────────────────────────────────────────────────────────────────────

/** Default role for debate participants */
export const DEFAULT_DEBATE_ROLE = 'Neutral'

// ── TF-IDF / Graph Analysis ───────────────────────────────────────────────────

/** Maximum number of documents for O(N²) implicit link computation */
export const TFIDF_MAX_DOCS = 250

// ── RAG / BFS ─────────────────────────────────────────────────────────────────

/** Default maximum hop count for BFS graph traversal */
export const BFS_DEFAULT_HOPS = 3

/** Default maximum document count for BFS graph traversal */
export const BFS_DEFAULT_MAX_DOCS = 20
