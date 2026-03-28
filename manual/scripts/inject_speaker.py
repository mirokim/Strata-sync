"""
speaker 필드 자동 주입 스크립트 (inject_speaker.py)  v1.0
────────────────────────────────────────────────────────
기능:
  frontmatter의 tags 기반으로 speaker 필드를 자동 추정·주입한다.
  이미 speaker 필드가 있는 파일은 스킵.

태그 → speaker 매핑:
  chief                    → chief_director
  art                      → art_director
  tech / prog              → tech_director
  spec / plan / design     → design_director
  level                    → level_director
  위 태그 없음              → unknown

사용법:
    python inject_speaker.py <vault_dir>

의존 패키지:
    pip install PyYAML
"""

import os
import re
import sys
import yaml

# ── 태그 → speaker 매핑 (순서 중요: 먼저 매치되는 것이 우선) ─────────────────
TAG_TO_SPEAKER: list[tuple[set[str], str]] = [
    ({'chief'},                  'chief_director'),
    ({'art'},                    'art_director'),
    ({'tech', 'prog'},           'tech_director'),
    ({'spec', 'plan', 'design'}, 'design_director'),
    ({'level'},                  'level_director'),
]
DEFAULT_SPEAKER = 'unknown'


def load_frontmatter(text: str) -> tuple[dict, int]:
    """YAML frontmatter 파싱. (fm_dict, fm_end_idx) 반환. frontmatter 없으면 ({}, -1)."""
    if not text.startswith('---'):
        return {}, -1
    close = text.find('\n---', 3)
    if close == -1:
        return {}, -1
    fm_end = close + 4  # \n--- 이후까지
    try:
        fm = yaml.safe_load(text[3:close]) or {}
    except Exception:
        fm = {}
    return fm, fm_end


def infer_speaker(tags: list) -> str:
    tag_set = {str(t).lower() for t in tags}
    for tag_keywords, speaker in TAG_TO_SPEAKER:
        if tag_set & tag_keywords:
            return speaker
    return DEFAULT_SPEAKER


def inject_speaker_field(text: str, speaker: str) -> str:
    """frontmatter 블록에 speaker 필드를 tags 줄 바로 다음에 삽입."""
    # frontmatter 범위 찾기
    close = text.find('\n---', 3)
    fm_block = text[3:close]  # --- 와 \n--- 사이 내용

    # tags: 줄 찾아서 바로 다음 줄에 삽입
    tags_pat = re.compile(r'^(tags\s*:.*(?:\n  ?-[^\n]+)*)', re.MULTILINE)
    m = tags_pat.search(fm_block)
    if m:
        insert_pos = m.end()
        new_fm = fm_block[:insert_pos] + f'\nspeaker: {speaker}' + fm_block[insert_pos:]
    else:
        # tags 줄 못 찾으면 frontmatter 끝에 추가
        new_fm = fm_block.rstrip('\n') + f'\nspeaker: {speaker}\n'

    return '---' + new_fm + text[close:]


def resolve_active_dir(vault_dir: str) -> str:
    """vault root 또는 active/ 서브폴더 중 실제 md 파일이 있는 쪽 반환."""
    active = os.path.join(vault_dir, 'active')
    if os.path.isdir(active):
        return active
    return vault_dir


def run(vault_dir: str) -> None:
    active_dir = resolve_active_dir(vault_dir)
    files = sorted(f for f in os.listdir(active_dir) if f.endswith('.md'))
    updated = 0
    skipped_has = 0
    skipped_no_fm = 0
    speaker_counts: dict[str, int] = {}

    for fname in files:
        path = os.path.join(active_dir, fname)
        try:
            with open(path, encoding='utf-8') as f:
                text = f.read()
        except Exception:
            continue

        fm, fm_end = load_frontmatter(text)
        if fm_end == -1:
            skipped_no_fm += 1
            continue
        if 'speaker' in fm:
            skipped_has += 1
            continue

        tags = fm.get('tags', [])
        if isinstance(tags, str):
            tags = [tags]
        speaker = infer_speaker(tags or [])

        new_text = inject_speaker_field(text, speaker)
        with open(path, 'w', encoding='utf-8') as f:
            f.write(new_text)

        speaker_counts[speaker] = speaker_counts.get(speaker, 0) + 1
        updated += 1

    print(f'완료: {updated}개 파일 speaker 필드 주입')
    print(f'스킵 (이미 있음): {skipped_has}개  |  스킵 (frontmatter 없음): {skipped_no_fm}개')
    if speaker_counts:
        print()
        print(f"{'speaker':<30} {'파일 수':>8}")
        print('-' * 40)
        for sp, cnt in sorted(speaker_counts.items(), key=lambda x: -x[1]):
            print(f'{sp:<30} {cnt:>8}개')


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: python inject_speaker.py <vault_dir>', file=sys.stderr)
        sys.exit(1)
    run(sys.argv[1])
