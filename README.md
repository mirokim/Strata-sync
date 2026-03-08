# STRATA SYNC

**AI Knowledge Graph for Obsidian Vaults** — A desktop application that visualizes your Obsidian markdown vault as a knowledge graph and lets multiple AI director personas traverse the graph to provide deep, contextual insights.

---

## Table of Contents

1. [Overview](#overview)
2. [Key Features](#key-features)
3. [Tech Stack](#tech-stack)
4. [Core Algorithms](#core-algorithms)
5. [Multi-Agent RAG Architecture](#multi-agent-rag-architecture)
6. [System Architecture](#system-architecture)
7. [Installation & Setup](#installation--setup)
8. [Usage Guide](#usage-guide)
9. [Vault Structure Guide](#vault-structure-guide)
10. [LLM Configuration](#llm-configuration)
11. [Project Structure](#project-structure)

---

## Overview

STRATA SYNC reads an Obsidian-style markdown vault and builds a **wikilink-based knowledge graph**. Five AI director personas traverse the graph and deliver concrete feedback and insights about your project.

```
Vault folder (.md files)
  ↓ Load + Parse
Knowledge Graph (WikiLink connections)
  ↓ directVaultSearch + TF-IDF + BFS + PageRank
Context collection
  ↓ Multi-Agent RAG (Chief + Worker LLMs)
Deep insights (streaming)
```

**Fully local and offline-capable** — no backend server required. All RAG runs on-device via TF-IDF and graph traversal.

---

## Key Features

### Knowledge Graph Visualization
- **2D Graph (SVG)**: Interactive graph powered by d3-force physics — default mode
- **2D Graph (Canvas)**: Fast Mode renderer for large vaults with high-performance rendering
- **3D Graph**: Three.js + d3-force-3d volumetric graph
- **Obsidian-style node sizing**: Node size proportional to link count (degree), using √degree scale
- **Node color modes**: By document type / speaker / folder / tags / topic cluster
- **Phantom nodes**: Wikilinks pointing to non-existent files still appear in the graph (matches Obsidian behavior)
- **Image nodes**: Images referenced via `![[image.png]]` appear as diamond-shaped nodes
- **AI node highlight**: Documents mentioned in AI responses are automatically highlighted with a pulse animation
- **Node label toggle**: Show/hide all node labels from the top bar
- **Fast Mode**: Forces Canvas renderer + skips hover + synchronous physics ticks for smooth rendering on large vaults

### Graph-Augmented RAG
- **directVaultSearch**: Grep-style direct search for date-named files (`[2026.01.28] feedback.md`) and exact title matches — runs before TF-IDF
- **TF-IDF vector search**: Auto-indexed on vault load, retrieves documents by statistical semantic similarity
- **IndexedDB caching**: TF-IDF index restored from cache on vault re-open (no recomputation if files unchanged)
- **Passage-level search**: Selects only the most relevant section per document (not just the beginning)
- **BFS graph traversal**: Follows wikilinks up to 4 hops to collect related documents automatically
- **PageRank hub seeding**: High-degree hub nodes are automatically added as traversal seeds
- **Full-scan mode**: Automatically triggered for broad queries like "give me project-wide insights"
- **Recency-first sorting**: Most recently modified documents are prioritized in RAG results
- **Implicit link discovery**: Detects hidden related document pairs via TF-IDF cosine similarity
- **Cluster topic labels**: Automatically extracts top TF-IDF keywords per cluster
- **Bridge node detection**: Identifies architectural keystone documents connecting multiple clusters

### Multi-Agent RAG
- **Chief + Worker structure**: Key documents are read in full (20K chars) by the Chief LLM; secondary documents are summarized in parallel by a cheaper Worker LLM (200 chars each)
- **Automatic Worker model selection**: Picks the cheapest model from the same provider (Claude Haiku / GPT-4.1-mini / Gemini Flash Lite / Grok-mini)
- **Parallel summarization**: Up to 4 secondary documents processed simultaneously via `Promise.all`
- **Fallback safety**: Worker failures fall back to first 300 characters of the document
- **Toggle**: Enable/disable via Settings → AI tab

### Context Compaction
- **Auto conversation compression**: When chat history exceeds 20,000 characters, older messages are summarized by a Worker LLM and injected as a "Previous Conversation Summary" in the system prompt
- **Preserves last 8 messages**: Recent context is always kept intact
- **Auto memory save**: Summaries are automatically saved to persistent memory (`memoryStore`) — insights accumulate across sessions

### AI Memory
- **Save conversation summary** (📝 button): Click to have the AI summarize the current conversation and add it to persistent memory
- **Manual + automatic**: Save manually via button, or automatically during context compaction
- **Accumulated memory**: Previous session decisions/insights are automatically injected into AI prompts

### AI Analysis Panel
- **Node analysis**: Select a document node and click "AI Analysis" — the AI automatically explores all connected documents
- **Full-vault analysis**: No node selection needed — hub-node-based traversal of the entire vault
- **Multi-pass UI**: "Exploring → Analyzing" step-by-step progress display
- **QuickQuestions**: Random question suggestions drawn from per-persona question pools
- **currentSituation context**: Describe the current project situation in Settings and it will be injected into every AI prompt
- **Auto image attachment**: If a selected document contains `![[...]]` image embeds, they are automatically attached when sending to AI for vision analysis

### Multiple LLM Personas
- 5 director personas (Chief / Art / Design / Level / Tech)
- Supported providers: **Anthropic Claude**, **OpenAI GPT**, **Google Gemini**, **xAI Grok**
- Image attachment support (Anthropic, OpenAI, Gemini)
- Customizable system prompts per persona

### Markdown Editor (CodeMirror 6)
- Obsidian-style `[[WikiLink]]` WYSIWYG rendering + autocomplete
- Visual processing of `~~strikethrough~~`, `==highlight==`, `%% comments %%`
- Keyboard shortcuts: `Ctrl+Shift+S` (strikethrough), `Ctrl+Shift+H` (highlight), `Ctrl+Shift+C` (inline code)
- Smart Enter continuation: auto-increments numbered lists / continues blockquotes
- 1.2-second auto-save

### Debate Mode
- Select director personas to debate a topic (Round-Robin / Free Debate / Role Assignment / Showdown modes)
- Persona-based participants — multiple personas can participate using the same API key
- Only personas with API keys configured are shown as candidates
- Reference material attachment (text / image / PDF), real-time streaming output

### File Tree
- Folder / speaker / tag classification views
- Sort by name or modification date
- Right-click context menu: Open in editor / Copy / Bookmark / Rename / Delete

### Confluence Importer
- Import pages from a Confluence space directly into your vault as markdown files
- Supports Atlassian Cloud (email + API token) and Server/Data Center (PAT or Basic auth)
- Date range filtering, SSL bypass option for on-premises instances
- Image attachment download

---

## Tech Stack

### Frontend
| Technology | Version | Purpose |
|------------|---------|---------|
| React | 19.x | UI components |
| TypeScript | 5.5 | Type safety |
| Vite | 5.4 | Build tool + HMR |
| Tailwind CSS | 4.x | Utility CSS |
| Zustand | 5.x | Global state management (with persist) |
| Framer Motion | 12.x | Animations |
| Lucide React | 0.400 | Icons |

### Graph Visualization
| Technology | Version | Purpose |
|------------|---------|---------|
| d3-force | 3.x | 2D physics simulation |
| d3-force-3d | 3.x | 3D physics simulation |
| Three.js | 0.175 | 3D rendering (WebGL) |

### Editor
| Technology | Version | Purpose |
|------------|---------|---------|
| CodeMirror | 6.x | Markdown editor core |
| @codemirror/lang-markdown | 6.5 | Markdown syntax + parser |
| @lezer/highlight | 1.2 | Syntax highlighting |

### Markdown Parsing
| Technology | Version | Purpose |
|------------|---------|---------|
| gray-matter | 4.x | YAML frontmatter parsing |
| unified / remark-parse | 11.x | Markdown AST parsing |
| react-markdown | 10.x | Markdown rendering |

### Desktop (Electron)
| Technology | Version | Purpose |
|------------|---------|---------|
| Electron | 31.x | Desktop app wrapper |
| electron-builder | 26.x | Installer build |

### Testing
| Technology | Purpose |
|------------|---------|
| Vitest | Unit/integration tests |
| @testing-library/react | Component testing |
| jsdom | DOM simulation |

---

## Core Algorithms

### 1. directVaultSearch — Grep-style Direct Search (`src/lib/graphRAG.ts`)

Handles title-based searches that TF-IDF struggles with, such as date-named files like `[2026.01.28] Feedback Meeting.md`.

**Search strategy**:
1. **Strong match** (score ≥ 0.4): Filename contains query / title match / extracted number match
2. **Weak match** (score < 0.4): Body substring match

**Features**:
- Particle stripping for Korean: "게임에서의" → "게임"
- Number extraction: "January 28 2026" → multiple patterns like `["2026", "0128", "28"]`
- Strong matches become "Directly Referenced Documents" — processed by Chief LLM with full content

---

### 2. TF-IDF Vector Search (`src/lib/graphAnalysis.ts`)

**Theory**: Term Frequency-Inverse Document Frequency

Retrieves documents by **statistical semantic similarity** rather than keyword matching.

```
TF(t, d)  = frequency of term t in doc d / total terms in doc d
IDF(t)    = log((total docs + 1) / (docs containing t + 1)) + 1  ← Smoothed IDF
TF-IDF    = TF × IDF

Cosine similarity = (query vector · doc vector) / (|query vector| × |doc vector|)
```

**Implementation highlights**:
- Background indexing via `setTimeout(0)` on vault load (no UI blocking)
- Korean particle stripping: "스칼렛이라는" → "스칼렛"
- OOV (Out-of-Vocabulary) words: `IDF = log(2)` fallback
- **IndexedDB caching**: mtime-based fingerprint validates cache → restores in milliseconds on re-open

---

### 3. BFS Graph Traversal (`src/lib/graphRAG.ts`)

**Theory**: Breadth-First Search

Traverses wikilink-connected documents up to N hops to collect related context.

```
Seed document (hop=0) → 1-hop connected → 2-hop connected → 3-hop connected
      ↑                       ↑                  ↑                  ↑
  Full content           600 chars           280 chars           120 chars
```

**Hub node supplement**: If TF-IDF seeds are fewer than 2, the top-5 hub nodes by degree are automatically added as seeds.

---

### 4. PageRank (`src/lib/graphAnalysis.ts`)

**Theory**: Google PageRank algorithm

Documents referenced by more wikilinks receive higher importance scores.

```
PR(d) = (1 - d) / N + d × Σ [PR(i) / OutDegree(i)]  for all i linking to d

d = damping factor (0.85)
N = total document count
```

**Implementation**: Pre-computed reverse edges for O(N+M) time complexity (25 iterations).

---

### 5. Union-Find Cluster Detection (`src/lib/graphAnalysis.ts`)

**Theory**: Disjoint Set Union (Union-Find)

Automatically classifies wikilink-connected document groups into clusters.

```
A - B - C      D - E      F
  Cluster 1    Cluster 2  Cluster 3
```

With **path compression** for near-O(1) amortized complexity.

---

### 6. d3-force Physics Simulation

**Theory**: Force-Directed Graph Layout

Natural graph layout from the balance between repulsion (charge) and link tension.

**Parameters (adjustable in real time)**:
| Parameter | Default | Range | Description |
|-----------|---------|-------|-------------|
| centerForce | 0.8 | 0–1 | Pull toward center |
| charge | -80 | -1000–0 | Node repulsion |
| linkStrength | 0.7 | 0–2 | Link tension |
| linkDistance | 60 | 20–300 | Target link length |

---

### 7. Implicit Link Discovery (`src/lib/graphAnalysis.ts`)

Detects document pairs **not** directly connected by wikilinks but with TF-IDF cosine similarity ≥ 0.25 — flagged as "hidden connections".

---

### 8. Passage-level Search (`src/lib/graphRAG.ts`)

**Theory**: Passage-level Relevance Scoring

Selects the most relevant **section** from each document rather than always including the beginning.

```
"combat balance" query
  Section 1 "## Overview":     0 matches
  Section 2 "## Combat Logic": 2 matches  ← selected
  Section 3 "## Bug Log":      0 matches
```

---

## Multi-Agent RAG Architecture

```
User query
    │
    ├─ directVaultSearch() ← date/title direct search (grep-style)
    │       │
    │       └─ Strong match (score≥0.4)?
    │               ├─ YES → "Directly Referenced Document" path
    │               │
    │               │   Top-1 document
    │               │     └─ Chief LLM → full content 20K
    │               │
    │               │   Doc 2–5 (parallel)
    │               │     └─ Worker LLM × N → 200-char summary each
    │               │           (fallback: first 300 chars)
    │               │
    │               └─ NO → TF-IDF path
    │
    └─ TF-IDF cosine similarity → top-8 candidates
            │
            ├─ Reranking (keyword overlap + speaker affinity)
            ├─ Seeds < 2? → auto-supplement with hub nodes
            └─ BFS graph traversal (3 hops, up to 20 documents)
                    │
                    └─ buildDeepGraphContext()
                            └─ Context injected into LLM prompt

                                    ↓
                    Context Compaction (automatic)
                    ├─ History > 20K chars?
                    │   └─ Worker LLM → summarize old messages
                    │         → inject "Previous Summary" in system prompt
                    │         → auto-save to memoryStore
                    └─ Preserve last 8 messages
```

### Worker Model Auto-selection

| Chief Model Provider | Worker Model |
|---------------------|--------------|
| Anthropic | `claude-haiku-4-5-20251001` |
| OpenAI | `gpt-4.1-mini` |
| Google | `gemini-2.5-flash-lite` |
| xAI | `grok-3-mini` |

---

## System Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Electron Shell                    │
│  ┌─────────────────┐      ┌────────────────────┐   │
│  │   Main Process  │      │  Renderer Process  │   │
│  │  (electron/     │ IPC  │  (React + Vite)    │   │
│  │   main.cjs)     │ ←──→ │                    │   │
│  │                 │      │  ┌──────────────┐  │   │
│  │  • File System  │      │  │  Graph UI    │  │   │
│  │  • File Watch   │      │  │  (2D + 3D)   │  │   │
│  │  • strata-img:// │      │  ├──────────────┤  │   │
│  │    protocol     │      │  │  Chat Panel  │  │   │
│  │  • RAG API HTTP │      │  │  (5 Personas)│  │   │
│  │    (port 7331)  │      │  ├──────────────┤  │   │
│  └─────────────────┘      │  │  MD Editor   │  │   │
│                            │  │  (CodeMirror)│  │   │
│                            │  └──────────────┘  │   │
│                            └────────────────────┘   │
└─────────────────────────────────────────────────────┘
         ↕                           ↕
   Local .md Vault Files       LLM APIs (Claude / GPT /
   (Obsidian vault)            Gemini / Grok)
```

### Data Flow

```
.md file load
  → markdownParser.ts (async chunk processing — YAML frontmatter + WikiLinks)
  → LoadedDocument[]
  → buildGraph() → GraphNode[] + GraphLink[]
  → graphStore / vaultStore
  → 2D/3D graph rendering

  [Background, setTimeout(0)]
  → buildFingerprint(docs) → fingerprint string
  → loadTfIdfCache(vaultPath, fingerprint)
      ├─ Cache hit:  tfidfIndex.restore(cached)   ← restored in ms
      └─ Cache miss: tfidfIndex.build(docs) → saveTfIdfCache(...)
  → findImplicitLinks(adjacency)  ← pre-compute hidden connections

  [Background, void async IIFE]
  → Collect all imageRefs from docs (deduplicated)
  → 10-image batches via parallel readImage() IPC
  → imageDataCache (filename → base64 dataUrl)
  → Attached instantly on chat send (no IPC round-trip)
```

---

## Installation & Setup

### Prerequisites
- Node.js 18+

### Development

```bash
# Install dependencies
npm install

# Run Electron + Vite concurrently
npm run electron:dev
```

### Production Build

```bash
npm run electron:build
```

### Tests

```bash
npm test
```

---

## Usage Guide

### 1. Load a Vault

1. Launch the app → click "Open Vault" on the start screen
2. Select your Obsidian vault folder (any folder containing `.md` files)
3. The knowledge graph is automatically generated

### 2. Explore the Graph

- **Mouse drag**: Pan / rotate the graph
- **Scroll**: Zoom in/out
- **Node click**: Select document (content shown in the right document viewer)
- **Node double-click**: Open in editor
- **Palette button** (bottom-left): Switch node color mode

### 3. AI Analysis

**Specific node analysis**:
1. Click a node to select it
2. Click "AI Analysis" (bottom-left)
3. The AI automatically explores all related documents and delivers analysis

**Full-vault analysis**:
1. Click "Full AI Analysis" with no node selected
2. Hub-node-based traversal gives a project-wide overview

### 4. AI Chat

- Select an AI director persona from the right panel
- Ask in natural language — related documents are automatically retrieved:
  - `"What was in the January 28 feedback session?"` → directVaultSearch finds the date-named file
  - `"How can we improve RPG combat balance?"` → TF-IDF search + BFS traversal
  - `"Give me project-wide insights"` → full-vault scan
- **Auto image attachment**: If the selected document has `![[...]]` image embeds, a "🖼️ N images attached" badge appears — images are automatically sent to AI for vision analysis

### 5. Save Conversation Summary (📝)

- Click the 📝 button at the top of the chat panel
- The AI summarizes the current conversation and adds it to persistent memory
- Summaries are automatically referenced in future sessions

### 6. Markdown Editor

- Double-click a file in the file tree, or right-click → "Open in Editor"
- Type `[[` to trigger vault document autocomplete
- Save: `Ctrl+S` or auto-save after 1.2 seconds

---

## Vault Structure Guide

STRATA SYNC is fully compatible with Obsidian. For richer AI insights, we recommend this structure:

### Recommended Frontmatter

```yaml
---
speaker: tech_director    # Persona assignment
date: 2024-01-15
tags: [combat, balance, RPG]
type: design
---
```

### Wikilinks and Image Embeds

```markdown
## Combat System

The basic attack mechanism connects to [[Skill Tree]].
Balancing principles follow [[Game Design Principles]].

![[combat_flowchart.png]]
```

**More wikilinks = wider BFS traversal = richer AI context.**

**Date filenames recommended**: Save files like `[2024.01.28] Feedback Meeting.md` to enable natural language searches like "January 28 feedback".

### Speaker IDs

| ID | Role |
|----|------|
| `chief_director` | Chief Director |
| `art_director` | Art Director |
| `design_director` | Design Director |
| `level_director` | Level Director |
| `tech_director` | Tech Director |

---

## LLM Configuration

Settings panel (top settings button) → Enter API keys → Select model per persona:

| Provider | Supported Models | Image Support |
|----------|-----------------|---------------|
| Anthropic | claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5 | ✅ |
| OpenAI | gpt-4.1, gpt-4.1-mini, gpt-4o, o3, o4-mini | ✅ |
| Google Gemini | gemini-2.5-pro, gemini-2.5-flash, gemini-2.5-flash-lite | ✅ |
| xAI Grok | grok-3, grok-3-mini, grok-3-fast | ❌ |

**Per-persona model assignment**: Each director persona can use a different model and provider independently.

**Multi-Agent RAG toggle**: Enable/disable Worker LLM parallel summarization in Settings → AI tab. Enabled by default.

---

## Project Structure

```
src/
├── components/
│   ├── chat/           # Chat panel + Debate mode (DebateEngine, QuickQuestions)
│   ├── editor/         # CodeMirror markdown editor + image viewer
│   ├── fileTree/       # File tree + context menu
│   ├── graph/          # Graph2D (Canvas), Graph3D, GraphPanel (AI analysis)
│   ├── layout/         # Main layout + top bar (node label toggle)
│   ├── converter/      # Confluence importer UI
│   └── settings/       # Settings modal (personas, models, currentSituation, Multi-Agent toggle)
│
├── lib/
│   ├── graphAnalysis.ts    # TF-IDF + PageRank + clustering + serialize/restore
│   ├── graphRAG.ts         # Graph-Augmented RAG pipeline (directVaultSearch + BFS + getStrippedBody)
│   ├── graphBuilder.ts     # Node/link construction (phantom nodes + image nodes)
│   ├── markdownParser.ts   # YAML frontmatter + WikiLink + imageRefs parsing (async chunks)
│   ├── tfidfCache.ts       # IndexedDB TF-IDF cache (save/restore/fingerprint validation)
│   ├── speakerConfig.ts    # Persona ID + label + color centralized config
│   ├── modelConfig.ts      # Model → provider mapping + model list
│   ├── personaVaultConfig.ts # Vault-scoped .rembrant/personas.md parsing
│   └── nodeColors.ts       # Hash-based deterministic node colors + degree-proportional sizing
│
├── services/
│   ├── debateEngine.ts     # Debate mode engine (persona-based participants)
│   ├── debateRoles.ts      # Debate roles + labels/colors
│   ├── llmClient.ts        # Multi-LLM unified interface (Multi-Agent RAG + context compaction)
│   └── providers/          # Anthropic / OpenAI / Gemini / Grok
│
├── stores/
│   ├── graphStore.ts       # Nodes / links / selection state
│   ├── vaultStore.ts       # Loaded documents + imagePathRegistry + imageDataCache
│   ├── settingsStore.ts    # API keys + persona models + currentSituation + multiAgentRAG (persist)
│   ├── memoryStore.ts      # AI persistent memory (accumulated conversation summaries, persist)
│   └── uiStore.ts          # Theme + tabs + active document
│
├── hooks/
│   ├── useVaultLoader.ts       # Vault load + TF-IDF cache + image pre-indexing
│   ├── useRagApi.ts            # Slack bot RAG bridge (HTTP API on port 7331)
│   ├── useGraphSimulation.ts   # 2D d3-force simulation (Canvas + Fast Mode)
│   └── useGraphSimulation3D.ts # 3D physics simulation
│
└── __tests__/              # Vitest unit/integration tests
    ├── graphRAG.test.ts        # directVaultSearch + getStrippedBody + buildDeepGraphContext
    ├── graphAnalysis.test.ts   # TF-IDF + PageRank + clustering
    ├── llmClient.test.ts       # Multi-Agent RAG + context compaction
    └── ...                     # Component tests
```

---

## License

MIT License

---

> *"The more documents in the vault, the deeper the graph — and the wider the AI can explore."*
