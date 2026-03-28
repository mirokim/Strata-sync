/**
 * scriptConfig.ts — Python script metadata and pipeline order SSOT
 *
 * Usage:
 *   - VaultManagerTab: SCRIPTS (full list), PIPELINE_ORDER (manual execution)
 *   - syncRunner / useConfluenceAutoSync: POST_SYNC_SCRIPTS (post auto-sync)
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
    desc: 'Detect stubs/outdated files and move to archive',
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
    label: 'Enhance WikiLinks',
    desc: 'Cluster/title matching and ghost link injection',
    buildArgs: (v) => [v],
    category: 'link',
    primary: true,
  },
  {
    name: 'strengthen_links.py',
    label: 'Strengthen Links',
    desc: 'Hub/hierarchy/ghost→real/fallback link processing',
    buildArgs: (v) => [v],
    category: 'link',
  },
  {
    name: 'inject_keywords.py',
    label: 'Keyword Links',
    desc: 'Replace first occurrence of key terms with [[hub|keyword]]',
    buildArgs: (v) => [v],
    category: 'link',
  },
  {
    name: 'gen_index.py',
    label: 'Generate Index',
    desc: 'Regenerate _index.md in reverse date order with monthly grouping',
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
    desc: 'Auto-inject speaker field across entire vault (§6.1)',
    buildArgs: (v) => [v],
    category: 'fix',
  },
  {
    name: 'check_links.py',
    label: 'Check Links',
    desc: 'Report image/document link separation errors and broken links',
    buildArgs: (v) => [v, '--vault', v],
    category: 'check',
    primary: true,
  },
  {
    name: 'check_quality.py',
    label: 'Quality Report',
    desc: 'Auto-check 11-item quality checklist',
    buildArgs: (v) => [v, '--vault', v],
    category: 'check',
  },
  {
    name: 'check_outdated.py',
    label: 'Freshness Check',
    desc: 'Check outdated files, orphan new docs, and hub updates',
    buildArgs: (v) => [v, '--vault', v],
    category: 'check',
  },
  {
    name: 'convert_jira.py',
    label: 'Jira Convert',
    desc: 'issues.json → individual issue MD + Epic/Release aggregate docs',
    buildArgs: () => [],
    category: 'index',
  },
  {
    name: 'gen_jira_index.py',
    label: 'Jira Index',
    desc: 'Generate jira_index.md hub (Epic/Release/attachment links)',
    buildArgs: () => [],
    category: 'index',
  },
  {
    name: 'crosslink_jira.py',
    label: 'Jira Crosslinks',
    desc: 'Jira↔Active bidirectional crosslink injection (§s12)',
    buildArgs: (v) => [v, '--apply'],
    category: 'link',
  },
]

/**
 * §17.1.4 Post-sync pipeline — runs sequentially after Confluence/Jira auto-sync completion
 * Order matters: audit_and_fix → inject_speaker → gen_index → inject_keywords → gen_year_hubs → enhance_wikilinks
 * gen_index must run before inject_keywords so keyword map is built from the latest _index.md
 */
export const POST_SYNC_SCRIPTS: ScriptDef[] = [
  SCRIPTS.find(s => s.name === 'audit_and_fix.py')!,
  SCRIPTS.find(s => s.name === 'inject_speaker.py')!,
  SCRIPTS.find(s => s.name === 'gen_index.py')!,
  SCRIPTS.find(s => s.name === 'inject_keywords.py')!,
  SCRIPTS.find(s => s.name === 'gen_year_hubs.py')!,
  SCRIPTS.find(s => s.name === 'strengthen_links.py')!,  // Ghost→Real hub replacement (§8.3, PPR contamination prevention)
  SCRIPTS.find(s => s.name === 'enhance_wikilinks.py')!,
]

/**
 * §17.1.4 Manual full pipeline order (VaultManagerTab)
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
