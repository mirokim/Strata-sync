/**
 * Search query synonym/abbreviation expansion table (MCP server copy)
 */
export const SYNONYM_MAP: Readonly<Record<string, readonly string[]>> = {
  // ── Abbreviation expansion ─────────────────────────────────────────────────
  '배틀로얄':    ['br', 'br모드'],
  'br':          ['배틀로얄', 'br모드'],

  // ── Korean → loanword/game terminology ─────────────────────────────────────
  '음향':        ['사운드'],
  '효과음':      ['사운드'],
  '배경음':      ['bgm', '사운드'],
  '배경음악':    ['bgm', '사운드'],

  '전용서버':    ['데디케이트'],
  '독립서버':    ['데디케이트'],
  '데디케이트':  ['전용서버', '클라서버'],

  '지도':        ['맵', 'world_map'],
  '세계지도':    ['맵', 'world_map', '월드맵'],

  '능력':        ['스킬'],
  '특수능력':    ['스킬'],

  '적':          ['몬스터'],
  '적군':        ['몬스터'],
  '보스':        ['몬스터'],

  '조합':        ['레시피', '크래프팅'],
  '제작':        ['레시피', '크래프팅'],

  '각성':        ['성장', '강화'],
  '눈뜨기':      ['각성'],
}

/** Returns a new array with synonym expansion applied to the tokenized query array */
export function expandTerms(terms: string[]): string[] {
  const expanded = new Set(terms)
  for (const term of terms) {
    for (const syn of SYNONYM_MAP[term] ?? []) {
      expanded.add(syn)
    }
  }
  return [...expanded]
}
