/**
 * scriptConfig.ts — Python script metadata and pipeline order SSOT
 *
 * Usage:
 *   - VaultManagerTab: SCRIPTS (full list), PIPELINE_ORDER (manual execution)
 *   - syncRunner / useAutoSync: POST_SYNC_SCRIPTS (post auto-sync)
 */

export interface ScriptDef {
  name: string
  label: string
  desc: string
  buildArgs: (vaultPath: string) => string[]
  category: 'fix' | 'link' | 'index' | 'check'
  primary?: boolean
}

/** Full script list (for VaultManagerTab manual execution) */
export const SCRIPTS: ScriptDef[] = [
  {
    name: 'audit_and_fix.py',
    label: 'Audit & Fix',
    desc: 'Auto-fix broken links and frontmatter',
    buildArgs: (v) => [v, '--vault', v, '--fix'],
    category: 'fix',
    primary: true,
  },
  {
    name: 'scan_cleanup.py',
    label: 'Scan & Cleanup',
    desc: 'Detect stub/outdated files and move to archive',
    buildArgs: (v) => [v],
    category: 'fix',
    primary: true,
  },
  {
    name: 'split_large_docs.py',
    label: 'Split Large Docs',
    desc: 'Split 200+ line files into hub-spoke structure',
    buildArgs: (v) => [v],
    category: 'fix',
  },
  {
    name: 'enhance_wikilinks.py',
    label: 'Enhance Wiki Links',
    desc: 'Cluster matching, title matching, ghost link injection',
    buildArgs: (v) => [v],
    category: 'link',
    primary: true,
  },
  {
    name: 'strengthen_links.py',
    label: 'Strengthen Links',
    desc: 'Hub, hierarchy, ghost-to-real, fallback link processing',
    buildArgs: (v) => [v],
    category: 'link',
  },
  {
    name: 'inject_keywords.py',
    label: 'Keyword Links',
    desc: 'Replace first occurrence of core keywords with [[hub|keyword]]',
    buildArgs: (v) => [v],
    category: 'link',
  },
  {
    name: 'gen_index.py',
    label: 'Generate Index',
    desc: 'Regenerate _index.md in reverse-date order with monthly grouping',
    buildArgs: (v) => [v],
    category: 'index',
    primary: true,
  },
  {
    name: 'gen_year_hubs.py',
    label: 'Year Hubs',
    desc: 'Generate yearly hub files and update latest sections',
    buildArgs: (v) => [v, '--top', '5'],
    category: 'index',
  },
  {
    name: 'inject_speaker.py',
    label: 'Inject Speaker',
    desc: 'Auto-inject speaker field across the entire vault',
    buildArgs: (v) => [v],
    category: 'fix',
  },
  {
    name: 'check_links.py',
    label: 'Check Links',
    desc: 'Report broken image/document links and separation errors',
    buildArgs: (v) => [v, '--vault', v],
    category: 'check',
    primary: true,
  },
  {
    name: 'check_quality.py',
    label: 'Quality Report',
    desc: 'Automated quality checklist with 11 inspection items',
    buildArgs: (v) => [v, '--vault', v],
    category: 'check',
  },
  {
    name: 'check_outdated.py',
    label: 'Freshness Check',
    desc: 'Check outdated files, orphaned new docs, hub updates',
    buildArgs: (v) => [v, '--vault', v],
    category: 'check',
  },
]

/**
 * Post-sync pipeline — executed sequentially after auto-sync completes.
 * Order matters: audit_and_fix -> inject_speaker -> gen_index -> inject_keywords -> gen_year_hubs -> enhance_wikilinks
 * gen_index must run before inject_keywords so the keyword map is built from the latest _index.md
 */
export const POST_SYNC_SCRIPTS: ScriptDef[] = [
  SCRIPTS.find(s => s.name === 'audit_and_fix.py')!,
  SCRIPTS.find(s => s.name === 'inject_speaker.py')!,
  SCRIPTS.find(s => s.name === 'gen_index.py')!,
  SCRIPTS.find(s => s.name === 'inject_keywords.py')!,
  SCRIPTS.find(s => s.name === 'gen_year_hubs.py')!,
  SCRIPTS.find(s => s.name === 'strengthen_links.py')!,  // Ghost->Real hub replacement (prevents PPR contamination)
  SCRIPTS.find(s => s.name === 'enhance_wikilinks.py')!,
]

/**
 * Manual full pipeline order (VaultManagerTab)
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
