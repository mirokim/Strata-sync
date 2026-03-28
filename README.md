# STRATA SYNC

**AI Knowledge Graph for Obsidian Vaults** — Obsidian 마크다운 볼트를 지식 그래프로 시각화하고, 멀티 AI 디렉터 페르소나가 그래프를 탐색하여 깊은 인사이트를 제공하는 데스크탑 애플리케이션.

**AI Knowledge Graph for Obsidian Vaults** — A desktop application that visualizes your Obsidian markdown vault as a knowledge graph and lets multiple AI director personas traverse the graph to provide deep, contextual insights.

---

## Table of Contents / 목차

1. [Overview / 개요](#overview--개요)
2. [Key Features / 주요 기능](#key-features--주요-기능)
3. [Tech Stack / 기술 스택](#tech-stack--기술-스택)
4. [Core Algorithms / 핵심 알고리즘](#core-algorithms--핵심-알고리즘)
5. [Multi-Agent RAG Architecture](#multi-agent-rag-architecture)
6. [System Architecture / 시스템 아키텍처](#system-architecture--시스템-아키텍처)
7. [Installation & Setup / 설치 및 설정](#installation--setup--설치-및-설정)
8. [Usage Guide / 사용 가이드](#usage-guide--사용-가이드)
9. [Bot Integration / 봇 연동](#bot-integration--봇-연동)
10. [Backend & MCP Server](#backend--mcp-server)
11. [Vault Tools / 볼트 도구](#vault-tools--볼트-도구)
12. [Vault Structure Guide / 볼트 구조 가이드](#vault-structure-guide--볼트-구조-가이드)
13. [LLM Configuration / LLM 설정](#llm-configuration--llm-설정)
14. [Project Structure / 프로젝트 구조](#project-structure--프로젝트-구조)

---

## Overview / 개요

STRATA SYNC는 Obsidian 스타일 마크다운 볼트를 읽어 **위키링크 기반 지식 그래프**를 구축합니다. 5개의 AI 디렉터 페르소나가 그래프를 탐색하여 프로젝트에 대한 구체적인 피드백과 인사이트를 전달합니다.

STRATA SYNC reads an Obsidian-style markdown vault and builds a **wikilink-based knowledge graph**. Five AI director personas traverse the graph and deliver concrete feedback and insights about your project.

```
Vault folder (.md files)
  ↓ Load + Parse
Knowledge Graph (WikiLink connections)
  ↓ directVaultSearch + BM25 + TF-IDF + BFS + PageRank
Context collection
  ↓ Multi-Agent RAG (Chief + Worker LLMs)
Deep insights (streaming)
```

**완전한 로컬 + 오프라인 동작** — 백엔드 서버 불필요. 모든 RAG가 BM25, TF-IDF, 그래프 탐색으로 디바이스에서 실행됩니다.

**Fully local and offline-capable** — no backend server required. All RAG runs on-device via BM25, TF-IDF, and graph traversal.

---

## Key Features / 주요 기능

### Knowledge Graph Visualization / 지식 그래프 시각화
- **2D Graph (SVG)**: d3-force 물리 엔진 기반 인터랙티브 그래프 — 기본 모드
- **2D Graph (Canvas)**: 대규모 볼트용 Fast Mode 고성능 렌더러
- **3D Graph**: Three.js + d3-force-3d 볼륨 그래프 (InstancedMesh 최적화, dirty-render 버짓 시스템)
- **Obsidian 스타일 노드 크기**: 링크 수(degree)에 비례, √degree 스케일
- **노드 컬러 모드**: 문서 타입 / 스피커 / 폴더 / 태그 / 토픽 클러스터별 색상
- **Phantom 노드**: 존재하지 않는 파일을 가리키는 위키링크도 그래프에 표시
- **이미지 노드**: `![[image.png]]`으로 참조된 이미지가 다이아몬드 모양 노드로 표시
- **AI 하이라이트**: AI 응답에서 언급된 문서가 자동으로 펄스 애니메이션 하이라이트
- **미니맵**: 그래프 전체 개요 네비게이션
- **노드 검색**: Ctrl+F로 그래프 내 노드 검색
- **볼트 비교 뷰**: 두 볼트를 나란히 비교

### Graph-Augmented RAG / 그래프 보강 RAG
- **directVaultSearch**: 날짜 파일명(`[2026.01.28] 피드백.md`) 및 정확한 제목 검색 — TF-IDF 이전에 실행
- **BM25 벡터 검색**: Web Worker로 자동 인덱싱, 코사인 유사도 기반 검색
- **동의어 확장**: 도메인 동의어 자동 적용 (프론트엔드/MCP 공유)
- **쿼리 커버리지 패널티**: 부분 매칭 문서 억제
- **최신성 부스트**: 6개월 지수 감쇠로 최신 문서 우선
- **IndexedDB 캐싱**: BM25 인덱스를 볼트 재오픈 시 캐시에서 복원
- **패시지 레벨 검색**: 문서 전체가 아닌 가장 관련성 높은 섹션만 선택
- **링크 강도**: 위키링크 참조 횟수 정규화 [0.15, 1.0]
- **Personalized PageRank (PPR)**: 강도 가중 랜덤 워커
- **암묵적 링크 발견**: BM25 유사도로 숨겨진 연결 탐지
- **클러스터 토픽 라벨**: 클러스터별 BM25 키워드 자동 추출
- **브릿지 노드 탐지**: 다중 클러스터를 연결하는 아키텍처 핵심 문서 식별

### Multi-Agent RAG / 멀티에이전트 RAG
- **Chief + Worker 구조**: 핵심 문서는 Chief LLM이 전체(20K)를 읽고, 보조 문서는 Worker LLM이 병렬 요약(200자)
- **자동 Worker 모델 선택**: 동일 프로바이더의 최저가 모델 (Haiku / GPT-4.1-mini / Gemini Flash Lite / Grok-mini)
- **병렬 요약**: 최대 5개 문서를 `Promise.all`로 동시 처리
- **폴백 안전장치**: Worker 실패 시 문서 첫 300자로 대체
- **토글**: Settings → AI 탭에서 활성화/비활성화

### Agentic Tool-Use / 에이전틱 도구 사용
- **streamMessageWithTools**: 파일 읽기/쓰기, 검색 등 도구를 자율적으로 사용하는 에이전트 루프
- **도메인 분류**: 문서를 서사/캐릭터 vs 시스템/게임플레이 도메인으로 자동 분류 후 도메인별 합성

### Context Compaction / 컨텍스트 압축
- **자동 대화 압축**: 채팅 히스토리가 20,000자 초과 시 Worker LLM이 요약하여 시스템 프롬프트에 주입
- **최근 8개 메시지 유지**: 최신 컨텍스트는 항상 보존
- **자동 메모리 저장**: 요약이 자동으로 `memoryStore`에 저장 — 세션 간 인사이트 축적

### AI Memory / AI 메모리
- **대화 요약 저장** (📝 버튼): AI가 현재 대화를 요약하여 영구 메모리에 추가
- **수동 + 자동**: 버튼으로 수동 저장, 컨텍스트 압축 시 자동 저장
- **축적 메모리**: 이전 세션의 결정/인사이트가 AI 프롬프트에 자동 주입

### Edit Agent / 편집 에이전트
- **자율 편집**: AI가 사용자 지시에 따라 마크다운을 읽고/수정
- **즉시 캐시 무효화**: 파일 저장 후 BM25 캐시 자동 클리어
- **자동 품질 검사**: 편집 후 `check_quality.py` 실행
- **후처리 파이프라인**: `inject_keywords.py → strengthen_links.py → enhance_wikilinks.py`
- **토큰 추적**: 사이클별 LLM 토큰 사용량 로깅

### Multiple LLM Personas / 멀티 LLM 페르소나
- 5개 디렉터 페르소나 (Chief / Art / Design / Level / Tech)
- 지원 프로바이더: **Anthropic Claude**, **OpenAI GPT**, **Google Gemini**, **xAI Grok**
- 이미지 첨부 지원 (Anthropic, OpenAI, Gemini)
- 페르소나별 커스텀 시스템 프롬프트

### Debate Mode / 토론 모드
- 디렉터 페르소나들이 주제에 대해 토론 (라운드 로빈 / 자유 토론 / 역할 배정 / 대결 모드)
- 참고 자료 첨부 (텍스트 / 이미지 / PDF), 실시간 스트리밍 출력

### Markdown Editor (CodeMirror 6) / 마크다운 에디터
- Obsidian 스타일 `[[WikiLink]]` WYSIWYG 렌더링 + 자동완성
- `~~취소선~~`, `==하이라이트==`, `%% 주석 %%` 시각 처리
- 키보드 단축키: `Ctrl+Shift+S` (취소선), `Ctrl+Shift+H` (하이라이트), `Ctrl+Shift+C` (인라인 코드)
- 스마트 Enter: 번호 리스트 자동 증가 / 인용 블록 연속
- 1.2초 자동 저장

### MiroFish Simulation / MiroFish 시뮬레이션
- 소셜 그래프 기반 AI 페르소나 시뮬레이션 엔진
- 팀 역학 분석 및 리포트 생성
- Oasis 환경 시뮬레이션

### Web Search / 웹 검색
- 볼트 외부 정보 검색으로 RAG 보강
- LLM이 자율적으로 웹 검색 필요성 판단

### Chat Reports / 채팅 리포트
- 대화 내용 기반 리포트 자동 생성
- PDF/마크다운 내보내기

### File Tree / 파일 트리
- 폴더 / 스피커 / 태그 분류 뷰
- 이름순 또는 수정일순 정렬
- 우클릭 컨텍스트 메뉴: 에디터 열기 / 복사 / 북마크 / 이름 변경 / 삭제

### Confluence Importer / Confluence 가져오기
- Confluence 스페이스 페이지를 볼트에 마크다운으로 직접 가져오기
- Atlassian Cloud (이메일 + API 토큰) 및 Server/Data Center (PAT 또는 Basic 인증) 지원

---

## Tech Stack / 기술 스택

### Frontend / 프론트엔드
| Technology | Version | Purpose |
|------------|---------|---------|
| React | 19.x | UI 컴포넌트 |
| TypeScript | 5.5 | 타입 안전성 |
| Vite | 5.4 | 빌드 도구 + HMR |
| Tailwind CSS | 4.x | 유틸리티 CSS |
| Zustand | 5.x | 글로벌 상태 관리 (with persist) |
| Framer Motion | 12.x | 애니메이션 |
| Lucide React | 0.400 | 아이콘 |

### Graph Visualization / 그래프 시각화
| Technology | Version | Purpose |
|------------|---------|---------|
| d3-force | 3.x | 2D 물리 시뮬레이션 |
| d3-force-3d | 3.x | 3D 물리 시뮬레이션 |
| Three.js | 0.175 | 3D 렌더링 (WebGL) |

### Editor / 에디터
| Technology | Version | Purpose |
|------------|---------|---------|
| CodeMirror | 6.x | 마크다운 에디터 코어 |
| @codemirror/lang-markdown | 6.5 | 마크다운 구문 + 파서 |

### Desktop / 데스크탑
| Technology | Version | Purpose |
|------------|---------|---------|
| Electron | 41.x | 데스크탑 앱 래퍼 |
| electron-builder | 26.x | 인스톨러 빌드 |

### Backend / 백엔드
| Technology | Purpose |
|------------|---------|
| Python Flask | REST API 서버 |
| Chroma | 벡터 데이터베이스 |
| PyYAML | YAML 파싱 |

### Testing / 테스트
| Technology | Purpose |
|------------|---------|
| Vitest | 유닛/통합 테스트 |
| @testing-library/react | 컴포넌트 테스트 |
| jsdom | DOM 시뮬레이션 |
| pytest | Python 백엔드 테스트 |

---

## Core Algorithms / 핵심 알고리즘

### 1. directVaultSearch — Grep 스타일 직접 검색 (`src/lib/graphRAG.ts`)

날짜 파일명(`[2026.01.28] 피드백 회의.md`)처럼 TF-IDF로 찾기 어려운 제목 기반 검색 처리.

Handles title-based searches that TF-IDF struggles with, such as date-named files.

**검색 전략 / Search strategy**:
1. **Strong match** (score >= 0.4): 파일명에 쿼리 포함 / 제목 매칭 / 숫자 추출 매칭
2. **Weak match** (score < 0.4): 본문 부분 문자열 매칭

### 2. BM25 Vector Search (`src/lib/bm25WorkerClient.ts`)

Web Worker에서 BM25 인덱싱/검색 실행. IndexedDB에 캐시하여 볼트 재오픈 시 즉시 복원.

BM25 indexing/search runs in a Web Worker. Cached in IndexedDB for instant restore on vault re-open.

### 3. TF-IDF Vector Search (`src/lib/graphAnalysis.ts`)

```
TF(t, d)  = term frequency in doc / total terms in doc
IDF(t)    = log((total docs + 1) / (docs containing t + 1)) + 1
TF-IDF    = TF x IDF
Cosine similarity = (query . doc) / (|query| x |doc|)
```

### 4. BFS Graph Traversal (`src/lib/graphRAG.ts`)

위키링크를 따라 최대 N홉까지 관련 문서 수집.

```
Seed (hop=0) → 1-hop (600 chars) → 2-hop (280 chars) → 3-hop (120 chars)
```

### 5. Personalized PageRank (PPR) (`src/workers/pprWorker.ts`)

링크 강도 가중치를 적용한 랜덤 워커 기반 개인화 PageRank.

### 6. Union-Find Cluster Detection (`src/lib/graphAnalysis.ts`)

위키링크로 연결된 문서 그룹을 자동 클러스터링. Path compression으로 준-O(1) 복잡도.

### 7. d3-force Physics Simulation

| Parameter | Default | Range | Description |
|-----------|---------|-------|-------------|
| centerForce | 0.8 | 0-1 | 중심 방향 인력 |
| charge | -80 | -1000-0 | 노드 반발력 |
| linkStrength | 0.7 | 0-2 | 링크 장력 |
| linkDistance | 60 | 20-300 | 목표 링크 길이 |

---

## Multi-Agent RAG Architecture

```
User query
    |
    +-- directVaultSearch() <-- date/title direct search
    |       |
    |       +-- Strong match?
    |               +-- YES --> "Directly Referenced Document"
    |               |   Top-1: Chief LLM (full 20K)
    |               |   Doc 2-5: Worker LLM x N (200-char summary, parallel)
    |               |
    |               +-- NO --> BM25 + TF-IDF path
    |
    +-- BM25 + TF-IDF cosine similarity --> top-8 candidates
            |
            +-- Reranking (keyword overlap + speaker affinity)
            +-- Seeds < 2? --> auto-supplement with hub nodes
            +-- BFS graph traversal (3 hops, up to 20 docs)
                    |
                    +-- Domain classification (narrative vs system)
                    +-- Per-domain synthesis
                    +-- buildDeepGraphContext()
                            |
                            +-- Context Compaction (auto)
                            +-- Web search augmentation (optional)
```

### Worker Model Auto-selection

| Chief Provider | Worker Model |
|----------------|--------------|
| Anthropic | `claude-haiku-4-5-20251001` |
| OpenAI | `gpt-4.1-mini` |
| Google | `gemini-2.5-flash-lite` |
| xAI | `grok-3-mini` |

---

## System Architecture / 시스템 아키텍처

```
+-------------------------------------------------------------+
|                     STRATA SYNC v0.3.0                      |
+-------------------------------------------------------------+

FRONTEND (React 19 + TypeScript + Vite)
+-- Graph Visualization (D3-Force 2D/3D, Three.js)
+-- RAG Search (BM25 Worker + PPR + TF-IDF)
+-- Chat UI (5 Personas + Debate)
+-- Edit Agent (Autonomous editing)
+-- File Editor (CodeMirror + Markdown)
+-- Settings (15+ tabs)
+-- State (Zustand stores x 15)

ELECTRON (v41)
+-- Main Process (IPC, File System, File Watch)
+-- RAG API HTTP (port 7331)
+-- strata-img:// protocol

BACKEND (Python Flask)
+-- Document API (CRUD)
+-- RAG Service (BM25 + Vector)
+-- Chroma Vector DB

BOTS
+-- Slack Bot (Socket Mode, persona RAG)
+-- Telegram Bot (Long Polling, persona RAG)

MCP SERVER (Node.js + TypeScript)
+-- Tool API for Claude Code / Cursor
+-- Vault operations + LLM integration

VAULT TOOLS (30 Python utilities)
+-- Format conversion (DOCX/PDF/PPTX/XLSX -> MD)
+-- Link strengthening + keyword injection
+-- Quality audits + index generation
```

---

## Installation & Setup / 설치 및 설정

### Prerequisites / 전제 조건
- Node.js 18+
- Python 3.10+ (백엔드/봇/도구용)

### Development / 개발

```bash
# 의존성 설치
npm install

# Electron + Vite 동시 실행
npm run electron:dev
```

### Production Build / 프로덕션 빌드

```bash
npm run electron:build
```

### Backend / 백엔드

```bash
cd backend
pip install -r requirements.txt
python main.py
```

### Tests / 테스트

```bash
# Frontend
npm test

# Backend
cd backend && pytest

# Bot
cd bot && pytest
```

---

## Usage Guide / 사용 가이드

### 1. 볼트 로드 / Load a Vault

1. 앱 실행 → 시작 화면에서 "Open Vault" 클릭
2. Obsidian 볼트 폴더 선택 (`.md` 파일이 포함된 폴더)
3. 지식 그래프가 자동 생성됨

### 2. 그래프 탐색 / Explore the Graph

- **마우스 드래그**: 이동 / 회전
- **스크롤**: 확대/축소
- **노드 클릭**: 문서 선택 (우측 문서 뷰어에 내용 표시)
- **노드 더블클릭**: 에디터에서 열기
- **Ctrl+F**: 노드 검색
- **미니맵**: 전체 그래프 네비게이션

### 3. AI 분석 / AI Analysis

**특정 노드 분석**: 노드 클릭 → "AI Analysis" → 관련 문서 자동 탐색 후 분석
**전체 볼트 분석**: 노드 미선택 → "Full AI Analysis" → 허브 노드 기반 전체 개요

### 4. AI 채팅 / AI Chat

- 우측 패널에서 AI 디렉터 페르소나 선택
- 자연어로 질문 — 관련 문서가 자동 검색됨
- **이미지 자동 첨부**: 선택된 문서에 `![[...]]` 이미지가 있으면 자동으로 AI에 전송

### 5. Command Palette / 커맨드 팔레트

- 빠른 액션 실행을 위한 커맨드 팔레트

### 6. 마크다운 에디터 / Markdown Editor

- 파일 트리에서 더블클릭 또는 우클릭 → "Open in Editor"
- `[[` 입력으로 볼트 문서 자동완성 트리거
- 저장: `Ctrl+S` 또는 1.2초 후 자동 저장

---

## Bot Integration / 봇 연동

### Slack Bot / 슬랙 봇

볼트 관리 + RAG 질의응답 + 멀티에이전트 분석을 Slack에서 사용.

```bash
cd bot
pip install -r requirements.txt
python bot.py
```

자세한 설정은 [bot/SLACK_SETUP.md](bot/SLACK_SETUP.md) 참조.

### Telegram Bot / 텔레그램 봇

동일한 RAG 파이프라인을 Telegram에서 사용.

```bash
cd bot
export TELEGRAM_BOT_TOKEN="your-token"
python telegram_bot.py
```

**커맨드 / Commands:**
| Command | Description |
|---------|-------------|
| `/ask [persona] 질문` | 페르소나 RAG 질의 |
| `/search 키워드` | 볼트 문서 검색 |
| `/debate 주제` | 멀티 페르소나 토론 |
| `/mirofish 주제` | MiroFish 시뮬레이션 |
| `/help` | 도움말 |

일반 메시지를 보내면 기본 페르소나(chief)가 응답합니다. Plain messages are answered by the default persona (chief).

자세한 설정은 [bot/TELEGRAM_SETUP.md](bot/TELEGRAM_SETUP.md) 참조.

---

## Backend & MCP Server

### Backend (Python Flask)

벡터 DB(Chroma) 기반 RAG 서비스 및 문서 CRUD API.

```bash
cd backend
pip install -r requirements.txt
python main.py
```

### MCP Server (Model Context Protocol)

Claude Code / Cursor 등 외부 에이전트와 볼트를 연동하는 MCP 서버.

```bash
cd mcp
npm install
npm start
```

볼트 검색, 페르소나 관리, LLM 호출 등을 MCP 도구로 노출합니다.

---

## Vault Tools / 볼트 도구

`tools/` 디렉토리에 30개의 Python 유틸리티가 포함되어 있습니다.

The `tools/` directory contains 30 Python utilities for vault maintenance.

| Tool | Purpose |
|------|---------|
| `audit_and_fix.py` | 품질 감사 및 자동 수정 |
| `enhance_wikilinks.py` | 위키링크 보강 |
| `inject_keywords.py` | 도메인 키워드 주입 |
| `strengthen_links.py` | 링크 빈도 강화 |
| `gen_index.py` | 인덱스 자동 생성 |
| `pdf_to_md.py` | PDF → Markdown 변환 |
| `docx_to_md.py` | DOCX → Markdown 변환 |
| `pptx_to_md.py` | PPTX → Markdown 변환 |
| `xlsx_to_md.py` | XLSX → Markdown 변환 |
| `split_large_docs.py` | 대용량 문서 분할 |
| `check_quality.py` | 문서 품질 검사 |
| `pipeline.py` | 전체 파이프라인 오케스트레이션 |

전체 목록은 [tools/README.md](tools/README.md) 참조.

---

## Vault Structure Guide / 볼트 구조 가이드

STRATA SYNC는 Obsidian과 완벽 호환됩니다. 더 풍부한 AI 인사이트를 위해 아래 구조를 권장합니다.

STRATA SYNC is fully compatible with Obsidian. For richer AI insights, we recommend this structure:

### Recommended Frontmatter / 권장 프런트매터

```yaml
---
speaker: tech_director
date: 2024-01-15
tags: [combat, balance, RPG]
type: design
---
```

### Wikilinks and Image Embeds / 위키링크와 이미지 임베드

```markdown
## Combat System

The basic attack mechanism connects to [[Skill Tree]].
Balancing principles follow [[Game Design Principles]].

![[combat_flowchart.png]]
```

**위키링크가 많을수록 BFS 탐색 범위가 넓어지고, AI 컨텍스트가 풍부해집니다.**

**More wikilinks = wider BFS traversal = richer AI context.**

### Speaker IDs / 스피커 ID

| ID | Role |
|----|------|
| `chief_director` | Chief Director / 수석 디렉터 |
| `art_director` | Art Director / 아트 디렉터 |
| `design_director` | Design Director / 기획 디렉터 |
| `level_director` | Level Director / 레벨 디렉터 |
| `tech_director` | Tech Director / 기술 디렉터 |

---

## LLM Configuration / LLM 설정

Settings 패널 → API 키 입력 → 페르소나별 모델 선택:

| Provider | Supported Models | Image |
|----------|-----------------|-------|
| Anthropic | claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5 | O |
| OpenAI | gpt-4.1, gpt-4.1-mini, gpt-4o, o3, o4-mini | O |
| Google Gemini | gemini-2.5-pro, gemini-2.5-flash, gemini-2.5-flash-lite | O |
| xAI Grok | grok-3, grok-3-mini, grok-3-fast | X |

**페르소나별 독립 모델 할당**: 각 디렉터 페르소나가 서로 다른 모델과 프로바이더를 사용 가능.

---

## Project Structure / 프로젝트 구조

```
strata-sync/
+-- src/
|   +-- components/
|   |   +-- chat/           # 채팅 패널 + 토론 모드
|   |   +-- editor/         # CodeMirror 마크다운 에디터
|   |   +-- editAgent/      # 자율 편집 에이전트 UI
|   |   +-- fileTree/       # 파일 트리 + 컨텍스트 메뉴
|   |   +-- graph/          # Graph2D/3D, GraphPanel, Minimap, InsightsPanel
|   |   +-- layout/         # MainLayout, TopBar, RightPanel, StatusBar, VaultTabs
|   |   +-- converter/      # Confluence 가져오기 UI
|   |   +-- settings/       # 설정 모달 (15+ 탭)
|   |   +-- shared/         # CommandPalette, ErrorBoundary, ToastContainer
|   |
|   +-- lib/
|   |   +-- graphAnalysis.ts    # TF-IDF + PageRank + 클러스터링
|   |   +-- graphRAG.ts         # Graph-Augmented RAG 파이프라인
|   |   +-- graphBuilder.ts     # 노드/링크 구축
|   |   +-- bm25WorkerClient.ts # BM25 검색 Web Worker 클라이언트
|   |   +-- markdownParser.ts   # YAML + WikiLink + imageRefs 파싱
|   |   +-- vectorEmbedIndex.ts # 벡터 임베딩 인덱스
|   |   +-- webSearch.ts        # 웹 검색 통합
|   |   +-- chatReportExporter.ts # 채팅 리포트 내보내기
|   |   +-- vaultStats.ts       # 볼트 통계
|   |
|   +-- services/
|   |   +-- llmClient.ts        # 멀티 LLM 통합 (Multi-Agent RAG + 도메인 합성)
|   |   +-- editAgentRunner.ts  # 자율 편집 에이전트 파이프라인
|   |   +-- agentLoop.ts        # 메인 에이전트 루프
|   |   +-- debateEngine.ts     # 토론 모드 엔진
|   |   +-- computerUse.ts      # 컴퓨터 사용 에이전트
|   |   +-- syncRunner.ts       # 동기화 오케스트레이션
|   |   +-- providers/          # Anthropic / OpenAI / Gemini / Grok
|   |   +-- mirofish/           # MiroFish 시뮬레이션 엔진
|   |
|   +-- stores/                 # Zustand 상태 관리 (15개 스토어)
|   +-- hooks/                  # React 커스텀 훅
|   +-- workers/                # Web Workers (BM25, PPR)
|   +-- __tests__/              # Vitest 테스트
|
+-- electron/                   # Electron 메인 프로세스
+-- backend/                    # Python Flask 백엔드
+-- bot/                        # Slack + Telegram 봇
+-- mcp/                        # MCP 서버 (Claude Code/Cursor 연동)
+-- tools/                      # 30개 Python 볼트 유틸리티
+-- docs/                       # 기술 문서
+-- manual/                     # 사용자 매뉴얼
```

---

## License

MIT License

---

> *"볼트에 문서가 많을수록 그래프는 깊어지고, AI가 탐색할 수 있는 범위는 넓어집니다."*
>
> *"The more documents in the vault, the deeper the graph — and the wider the AI can explore."*
