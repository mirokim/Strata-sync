#!/usr/bin/env python3
"""
normalize_frontmatter.py — §6 프론트매터 통일
- 빈 tags: [] → 파일명/본문 키워드 기반 자동 분류
- chief 태그 자동 추가 (§11.3.1)
- type 재판별 (명백히 잘못 분류된 경우)
- ## 개요 헤딩 없는 파일에 자동 삽입 (§10.1)

사용법:
  python normalize_frontmatter.py <active_dir>
"""

import re
import sys
import argparse
from pathlib import Path

# ── 도메인 태그 규칙 (파일명/제목 키워드 → 태그) ─────────────────────────
DOMAIN_RULES = [
    # chief/피드백
    (['이사장', '피드백', '정례보고', '정례 보고', '회장님'],          ['chief', 'meeting']),
    # 회의록
    (['회의록', '회의', 'meeting', '미팅'],                             ['meeting']),
    # 캐릭터
    (['캐릭터', 'character', '캐릭터B', '캐릭터C', '캐릭터D', '캐릭터E',
      '캐릭터C', '캐릭터D', '캐릭터E', '캐릭터F', '캐릭터G'],               ['character']),
    # 기술/서버
    (['서버', 'server', '데디', 'dedi', '로비', 'lobby',
      '네트워크', 'network'],                                           ['tech', 'server']),
    # 기획/시스템
    (['기획', 'pvp', '점령전', '난투전', 'br', '공성전',
      '매칭', 'matching', '전투', 'combat'],                            ['gameplay']),
    # 아트/그래픽
    (['아트', 'art', 'fx', '이펙트', 'effect', '애니메이션', 'anim',
      '모션', 'motion', 'ui', 'ux', '배경', 'background'],             ['art']),
    # 스펙/설계
    (['스펙', 'spec', '설계', '구조', 'architecture',
      '시스템 설계', '기술 스펙'],                                       ['spec']),
    # 가이드/온보딩
    (['가이드', 'guide', '매뉴얼', 'manual', '온보딩', '튜토리얼',
      '사용법', '설치', 'tutorial', 'how to'],                          ['guide']),
    # 세계관/시나리오
    (['세계관', '시나리오', 'scenario', '스토리', 'story',
      '설정', '종족', 'npc', '퀘스트', 'quest'],                        ['world', 'scenario']),
    # 사운드
    (['사운드', 'sound', '음악', 'music', '효과음'],                    ['sound']),
    # 데이터/테이블
    (['데이터테이블', 'datatable', '데이터 테이블', '블록 목록',
      '오브젝트 목록', 'data table'],                                   ['data']),
    # 보안/빌드/인프라
    (['빌드', 'build', '배포', 'deploy', '인프라', 'infra',
      '치트', 'cheat'],                                                 ['tech']),
    # 보고서/정례
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
    """frontmatter 파싱. (fields_dict, fm_raw, body) 반환."""
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
    """파일명+제목+본문 키워드로 태그 추론."""
    text = (filename + ' ' + title + ' ' + body[:500]).lower()
    matched_tags = set()

    for keywords, tags in DOMAIN_RULES:
        for kw in keywords:
            if kw.lower() in text:
                matched_tags.update(tags)
                break  # 이 규칙에서 첫 매치 찾으면 다음 규칙으로

    return sorted(matched_tags) if matched_tags else []


def infer_type(filename: str, title: str, current_type: str) -> str:
    """파일명/제목으로 type 추론. spec이 default인 경우만 재판별."""
    if current_type != 'spec':
        return current_type
    text = (filename + ' ' + title).lower()
    for t, kws in TYPE_RULES.items():
        for kw in kws:
            if kw.lower() in text:
                return t
    return 'spec'


def ensure_section_heading(body: str) -> str:
    """본문에 ## 헤딩이 없으면 ## 개요 삽입 (§10.1)."""
    if '## ' in body:
        return body
    # 첫 문단 찾아 ## 개요로 감쌈
    lines = body.strip().split('\n')
    # H1 이후 첫 비어있지 않은 줄 위에 ## 개요 삽입
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
    """단일 MD 파일 정규화."""
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

    # ① tags 보완
    current_tags_raw = fields.get('tags', '[]')
    current_tags = re.findall(r'[\w가-힣]+', current_tags_raw)

    if not current_tags or current_tags == ['']:
        new_tags = infer_tags(fname, title, body)
        # chief 키워드 체크
        if any(kw in fname + ' ' + title for kw in CHIEF_KEYWORDS):
            if 'chief' not in new_tags:
                new_tags.insert(0, 'chief')
        if new_tags:
            new_tags_yaml = '[' + ', '.join(new_tags) + ']'
            fm_raw = re.sub(r'tags:.*', f'tags: {new_tags_yaml}', fm_raw)
            changed = True
    else:
        # chief 태그 추가 확인
        if any(kw in fname + ' ' + title for kw in CHIEF_KEYWORDS):
            if 'chief' not in current_tags:
                new_tags = ['chief'] + current_tags
                new_tags_yaml = '[' + ', '.join(new_tags) + ']'
                fm_raw = re.sub(r'tags:.*', f'tags: {new_tags_yaml}', fm_raw)
                changed = True

    # ② type 재판별
    current_type = fields.get('type', 'spec').strip()
    new_type = infer_type(fname, title, current_type)
    if new_type != current_type:
        fm_raw = re.sub(r'^type:.*$', f'type: {new_type}', fm_raw, flags=re.MULTILINE)
        changed = True

    # ③ ## 개요 헤딩 없으면 삽입 (§10.1)
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
    parser = argparse.ArgumentParser(description='프론트매터 정규화 + 헤딩 자동 삽입 (§6, §10.1)')
    parser.add_argument('active_dir', help='active/ 폴더 경로')
    args = parser.parse_args()

    active_dir = Path(args.active_dir)
    files = sorted(active_dir.glob('*.md'))
    print(f'{len(files)}개 파일 처리 시작...')

    changed_n, heading_n, error_n = 0, 0, 0

    for md_path in files:
        r = process_file(md_path)
        if r.get('error'):
            error_n += 1
        elif r.get('changed'):
            changed_n += 1
        if r.get('heading_added'):
            heading_n += 1

    print(f'\n=== §6 정규화 완료 ===')
    print(f'  변경된 파일:      {changed_n}개')
    print(f'  ## 개요 추가:     {heading_n}개')
    print(f'  오류:             {error_n}개')


if __name__ == '__main__':
    main()
