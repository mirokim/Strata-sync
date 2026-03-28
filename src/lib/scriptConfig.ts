/**
 * scriptConfig.ts — Python 스크립트 메타데이터 및 파이프라인 순서 SSOT
 *
 * 사용처:
 *   - VaultManagerTab: SCRIPTS (전체 목록), PIPELINE_ORDER (수동 실행)
 *   - syncRunner / useConfluenceAutoSync: POST_SYNC_SCRIPTS (자동 동기화 후)
 */

export interface ScriptDef {
  name: string
  label: string
  desc: string
  buildArgs: (vaultPath: string) => string[]
  category: 'fix' | 'link' | 'index' | 'check'
  primary?: boolean
}

/** 전체 스크립트 목록 (VaultManagerTab 수동 실행용) */
export const SCRIPTS: ScriptDef[] = [
  {
    name: 'audit_and_fix.py',
    label: 'Audit & Fix',
    desc: '깨진 링크·frontmatter 자동 수정',
    buildArgs: (v) => [v, '--vault', v, '--fix'],
    category: 'fix',
    primary: true,
  },
  {
    name: 'scan_cleanup.py',
    label: 'Scan & Cleanup',
    desc: '스텁·구버전 파일 탐지 및 아카이브 이동',
    buildArgs: (v) => [v],
    category: 'fix',
    primary: true,
  },
  {
    name: 'split_large_docs.py',
    label: '대용량 분할',
    desc: '200줄+ 파일을 허브-스포크 구조로 분할',
    buildArgs: (v) => [v],
    category: 'fix',
  },
  {
    name: 'enhance_wikilinks.py',
    label: 'Wiki 링크 강화',
    desc: '클러스터·제목 매칭·ghost 링크 주입',
    buildArgs: (v) => [v],
    category: 'link',
    primary: true,
  },
  {
    name: 'strengthen_links.py',
    label: '링크 보강',
    desc: '허브·계층·ghost→real·fallback 링크 처리',
    buildArgs: (v) => [v],
    category: 'link',
  },
  {
    name: 'inject_keywords.py',
    label: '키워드 링크',
    desc: '핵심 키워드 첫 등장을 [[허브|키워드]] 교체',
    buildArgs: (v) => [v],
    category: 'link',
  },
  {
    name: 'gen_index.py',
    label: '인덱스 생성',
    desc: '_index.md 날짜 역순 재생성·월별 그룹핑',
    buildArgs: (v) => [v],
    category: 'index',
    primary: true,
  },
  {
    name: 'gen_year_hubs.py',
    label: '연도 허브',
    desc: '연도별 허브 파일 생성 및 최신 섹션 갱신',
    buildArgs: (v) => [v, '--top', '5'],
    category: 'index',
  },
  {
    name: 'inject_speaker.py',
    label: 'Speaker 주입',
    desc: '§6.1 전체 볼트 speaker 필드 자동 주입',
    buildArgs: (v) => [v],
    category: 'fix',
  },
  {
    name: 'check_links.py',
    label: '링크 점검',
    desc: '이미지/문서 링크 분리 오류·깨진 링크 보고',
    buildArgs: (v) => [v, '--vault', v],
    category: 'check',
    primary: true,
  },
  {
    name: 'check_quality.py',
    label: '품질 보고서',
    desc: '품질 체크리스트 11개 항목 자동 점검',
    buildArgs: (v) => [v, '--vault', v],
    category: 'check',
  },
  {
    name: 'check_outdated.py',
    label: '최신성 점검',
    desc: 'outdated 파일·고립 신규 문서·허브 업데이트 점검',
    buildArgs: (v) => [v, '--vault', v],
    category: 'check',
  },
  {
    name: 'convert_jira.py',
    label: 'Jira 변환',
    desc: 'issues.json → 개별 이슈 MD + Epic/Release 집계 문서 생성',
    buildArgs: () => [],
    category: 'index',
  },
  {
    name: 'gen_jira_index.py',
    label: 'Jira 인덱스',
    desc: 'jira_index.md 허브 생성 (Epic·Release·첨부문서 링크)',
    buildArgs: () => [],
    category: 'index',
  },
  {
    name: 'crosslink_jira.py',
    label: 'Jira 교차링크',
    desc: 'Jira↔Active 양방향 교차 링크 주입 (§s12)',
    buildArgs: (v) => [v, '--apply'],
    category: 'link',
  },
]

/**
 * §17.1.4 동기화 후 파이프라인 — Confluence/Jira 자동 동기화 완료 후 순차 실행
 * 순서 중요: audit_and_fix → inject_speaker → gen_index → inject_keywords → gen_year_hubs → enhance_wikilinks
 * gen_index를 inject_keywords 전에 실행해야 최신 _index.md 기준으로 키워드 맵 구성 가능
 */
export const POST_SYNC_SCRIPTS: ScriptDef[] = [
  SCRIPTS.find(s => s.name === 'audit_and_fix.py')!,
  SCRIPTS.find(s => s.name === 'inject_speaker.py')!,
  SCRIPTS.find(s => s.name === 'gen_index.py')!,
  SCRIPTS.find(s => s.name === 'inject_keywords.py')!,
  SCRIPTS.find(s => s.name === 'gen_year_hubs.py')!,
  SCRIPTS.find(s => s.name === 'strengthen_links.py')!,  // Ghost→Real 허브 교체 (§8.3, PPR 오염 방지)
  SCRIPTS.find(s => s.name === 'enhance_wikilinks.py')!,
]

/**
 * §17.1.4 수동 전체 파이프라인 순서 (VaultManagerTab)
 */
export const PIPELINE_ORDER: string[] = [
  'audit_and_fix.py',
  'gen_index.py',
  'gen_year_hubs.py',
  'enhance_wikilinks.py',
  'strengthen_links.py',
  'inject_keywords.py',
  'check_links.py',
  'check_outdated.py',
]
