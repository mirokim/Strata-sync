import os, sys
sys.stdout.reconfigure(encoding='utf-8')

jira_dir  = r'C:\Users\jhoonn\smielgate_jira1\jira'
epics     = sorted(f[:-3] for f in os.listdir(jira_dir) if f.startswith('Epic — ') and f.endswith('.md'))
releases  = sorted(f[:-3] for f in os.listdir(jira_dir) if f.startswith('Release ') and f.endswith('.md'))
att_md    = sorted(f[:-3] for f in os.listdir(os.path.join(jira_dir, 'attachments_md')) if f.endswith('.md'))
raw_count = len(os.listdir(os.path.join(jira_dir, 'raw')))
today     = '2026-03-25'

lines = [
    '---',
    'title: "Jira 이슈 인덱스"',
    'type: reference',
    'status: active',
    'origin: jira_aggregate',
    'graph_weight: normal',
    f'date: {today}',
    'tags: [jira, index, hub]',
    'related: []',
    '---',
    '',
    '# Jira 이슈 인덱스',
    '',
    f'> 전체 이슈 {raw_count}건 | Epic {len(epics)}개 | 마일스톤 {len(releases)}개 | 첨부문서 {len(att_md)}개',
    '',
    '## Epic',
    '',
]
for e in epics:
    lines.append(f'- [[{e}]]')

lines += ['', '## 마일스톤 (Release)', '']
for r in releases:
    lines.append(f'- [[{r}]]')

lines += ['', '## 첨부 문서', '']
for a in att_md:
    lines.append(f'- [[attachments_md/{a}]]')

lines += [
    '',
    '## 개별 이슈',
    '',
    f'> `jira/raw/` 폴더에 {raw_count}개 (graph_weight: skip — 검색은 되나 그래프 노드 제외)',
]

content = '\n'.join(lines)
out = os.path.join(jira_dir, 'jira_index.md')
with open(out, 'w', encoding='utf-8') as f:
    f.write(content)
print('생성:', out)
print(f'링크: Epic {len(epics)} + Release {len(releases)} + 첨부문서 {len(att_md)}')
