#!/usr/bin/env python3
"""
normalize_frontmatter.py — §6 Frontmatter normalization
- Empty tags: [] → auto-classify based on filename/body keywords
- Auto-add chief tag (§11.3.1)
- Re-determine type (for clearly misclassified cases)
- Auto-insert ## Overview heading for files without one (§10.1)

Usage:
  python normalize_frontmatter.py <active_dir>
"""

import re
import sys
import argparse
from pathlib import Path

# ── Domain tag rules (filename/title keywords → tags) ────────────────────
DOMAIN_RULES = [
    # chief/feedback
    (['이사장', '피드백', '정례보고', '정례 보고', '회장님'],          ['chief', 'meeting']),
    # Meeting notes
    (['회의록', '회의', 'meeting', '미팅'],                             ['meeting']),
    # Characters
    (['캐릭터', 'character', '캐릭터B', '캐릭터C', '캐릭터D', '캐릭터E',
      '캐릭터C', '캐릭터D', '캐릭터E', '캐릭터F', '캐릭터G'],               ['character']),
    # Tech/Server
    (['서버', 'server', '데디', 'dedi', '로비', 'lobby',
      '네트워크', 'network'],                                           ['tech', 'server']),
    # Design/System
    (['기획', 'pvp', '점령전', '난투전', 'br', '공성전',
      '매칭', 'matching', '전투', 'combat'],                            ['gameplay']),
    # Art/Graphics
    (['아트', 'art', 'fx', '이펙트', 'effect', '애니메이션', 'anim',
      '모션', 'motion', 'ui', 'ux', '배경', 'background'],             ['art']),
    # Spec/Architecture
    (['스펙', 'spec', '설계', '구조', 'architecture',
      '시스템 설계', '기술 스펙'],                                       ['spec']),
    # Guide/Onboarding
    (['가이드', 'guide', '매뉴얼', 'manual', '온보딩', '튜토리얼',
      '사용법', '설치', 'tutorial', 'how to'],                          ['guide']),
    # World/Scenario
    (['세계관', '시나리오', 'scenario', '스토리', 'story',
      '설정', '종족', 'npc', '퀘스트', 'quest'],                        ['world', 'scenario']),
    # Sound
    (['사운드', 'sound', '음악', 'music', '효과음'],                    ['sound']),
    # Data/Tables
    (['데이터테이블', 'datatable', '데이터 테이블', '블록 목록',
      '오브젝트 목록', 'data table'],                                   ['data']),
    # Security/Build/Infrastructure
    (['빌드', 'build', '배포', 'deploy', '인프라', 'infra',
      '치트', 'cheat'],                                                 ['tech']),
    # Reports/Regular meetings
    (['보고', '보고서', 'report', '정례'],                              ['meeting', 'report']),
]

CHIEF_KEYWORDS = ['이사장', '피드백', '정례보고', '정례 보고', '회장님']

TYPE_RULES = {
    'meeting': ['회의록', '피드백', '정례보고', '정례 보고', '회의', '미팅', '보고서'],
    'guide':   ['가이드', 'guide', '매뉴얼', '튜토리얼', '사용법', '설치', '온보딩'],
    'decision':['결정', 'decision', 'adr', '의사결정'],
    'reference':['레퍼런스', 'reference', '참고', '벤치마크', '외부', '조사', '분석'],
}


def parse_frontmatter(content: str) -> tuple[dict, str, str]:
    """Parse frontmatter. Returns (fields_dict, fm_raw, body)."""
    m = re.match(r'^---\s*\n(.*?)\n---\s*\n', content, re.DOTALL)
    if not m:
        return {}, '', content
    fm_raw = m.group(1)
    body = content[m.end():]
    fields = {}
    for line in fm_raw.split('\n'):
        if ':' in line:
            k, _, v = line.partition(':')
            fields[k.strip()] = v.strip()
    return fields, fm_raw, body


def infer_tags(filename: str, title: str, body: str) -> list[str]:
    """Infer tags from filename + title + body keywords."""
    text = (filename + ' ' + title + ' ' + body[:500]).lower()
    matched_tags = set()

    for keywords, tags in DOMAIN_RULES:
        for kw in keywords:
            if kw.lower() in text:
                matched_tags.update(tags)
                break  # Found first match in this rule, move to next rule

    return sorted(matched_tags) if matched_tags else []


def infer_type(filename: str, title: str, current_type: str) -> str:
    """Infer type from filename/title. Only re-determine if spec is the default."""
    if current_type != 'spec':
        return current_type
    text = (filename + ' ' + title).lower()
    for t, kws in TYPE_RULES.items():
        for kw in kws:
            if kw.lower() in text:
                return t
    return 'spec'


def ensure_section_heading(body: str) -> str:
    """Insert ## Overview if no ## heading exists in body (§10.1)."""
    if '## ' in body:
        return body
    # Find first paragraph and wrap with ## Overview
    lines = body.strip().split('\n')
    # Insert ## Overview above first non-empty line after H1
    insert_at = 0
    for i, line in enumerate(lines):
        if line.startswith('# '):
            insert_at = i + 1
            continue
        if line.startswith('> 원본:'):
            insert_at = i + 1
            continue
        if line.strip():
            break
    lines.insert(insert_at + 1, '')
    lines.insert(insert_at + 1, '## 개요')
    return '\n'.join(lines)


def process_file(md_path: Path) -> dict:
    """Normalize a single MD file."""
    try:
        content = md_path.read_text(encoding='utf-8', errors='replace')
    except Exception as e:
        return {'file': str(md_path), 'changed': False, 'error': str(e)}

    fields, fm_raw, body = parse_frontmatter(content)
    if not fields:
        return {'file': str(md_path), 'changed': False, 'error': 'no frontmatter'}

    fname = md_path.stem
    title = fields.get('title', '').strip('"\'')
    changed = False

    # ① Supplement tags
    current_tags_raw = fields.get('tags', '[]')
    current_tags = re.findall(r'[\w가-힣]+', current_tags_raw)

    if not current_tags or current_tags == ['']:
        new_tags = infer_tags(fname, title, body)
        # Check chief keywords
        if any(kw in fname + ' ' + title for kw in CHIEF_KEYWORDS):
            if 'chief' not in new_tags:
                new_tags.insert(0, 'chief')
        if new_tags:
            new_tags_yaml = '[' + ', '.join(new_tags) + ']'
            fm_raw = re.sub(r'tags:.*', f'tags: {new_tags_yaml}', fm_raw)
            changed = True
    else:
        # Check if chief tag should be added
        if any(kw in fname + ' ' + title for kw in CHIEF_KEYWORDS):
            if 'chief' not in current_tags:
                new_tags = ['chief'] + current_tags
                new_tags_yaml = '[' + ', '.join(new_tags) + ']'
                fm_raw = re.sub(r'tags:.*', f'tags: {new_tags_yaml}', fm_raw)
                changed = True

    # ② Re-determine type
    current_type = fields.get('type', 'spec').strip()
    new_type = infer_type(fname, title, current_type)
    if new_type != current_type:
        fm_raw = re.sub(r'^type:.*$', f'type: {new_type}', fm_raw, flags=re.MULTILINE)
        changed = True

    # ③ Insert ## Overview heading if missing (§10.1)
    heading_added = False
    if '## ' not in body:
        body = ensure_section_heading(body)
        heading_added = True
        changed = True

    if changed:
        new_content = '---\n' + fm_raw + '\n---\n' + body
        md_path.write_text(new_content, encoding='utf-8')

    return {
        'file': str(md_path),
        'changed': changed,
        'heading_added': heading_added,
    }


def main():
    parser = argparse.ArgumentParser(description='Frontmatter normalization + auto heading insertion (§6, §10.1)')
    parser.add_argument('active_dir', help='active/ folder path')
    args = parser.parse_args()

    active_dir = Path(args.active_dir)
    files = sorted(active_dir.glob('*.md'))
    print(f'Processing {len(files)} files...')

    changed_n, heading_n, error_n = 0, 0, 0

    for md_path in files:
        r = process_file(md_path)
        if r.get('error'):
            error_n += 1
        elif r.get('changed'):
            changed_n += 1
        if r.get('heading_added'):
            heading_n += 1

    print(f'\n=== §6 Normalization Complete ===')
    print(f'  Changed files:    {changed_n}')
    print(f'  ## Overview added: {heading_n}')
    print(f'  Errors:           {error_n}')


if __name__ == '__main__':
    main()
