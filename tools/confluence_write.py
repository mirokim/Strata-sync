#!/usr/bin/env python3
"""
confluence_write.py — Confluence 페이지 생성/수정 (Markdown → Storage XML)

사용법:
  # 새 페이지 생성
  python confluence_write.py create "페이지 제목" content.md
  python confluence_write.py create "페이지 제목" content.md --space SGEPJA --parent 123456

  # 기존 페이지 수정
  python confluence_write.py update "새 제목" content.md --page-id 686860837

  # stdin 에서 읽기
  echo "# 제목\n내용" | python confluence_write.py create "페이지 제목" -

설정:
  mcp-config.json 의 confluence 섹션을 읽습니다.
  spaceKey, targetFolder(parentId) 기본값으로 사용됩니다.
"""

import io
import re
import sys
import json
import argparse
import urllib.request
import urllib.error
import base64
import ssl
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

# ── 설정 로드 ────────────────────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / 'mcp-config.json'

def load_config() -> dict:
    with open(CONFIG_PATH, encoding='utf-8') as f:
        cfg = json.load(f)
    return cfg.get('confluence', {})

# ── HTTP 헬퍼 ────────────────────────────────────────────────────────────────
def make_ssl_ctx(cfg: dict) -> ssl.SSLContext:
    ctx = ssl.create_default_context()
    if cfg.get('bypassSSL', False):
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    return ctx

def make_auth(cfg: dict) -> str:
    auth_type = cfg.get('authType', 'cloud')
    if auth_type == 'server_pat':
        return f"Bearer {cfg['apiToken']}"
    cred = base64.b64encode(f"{cfg['email']}:{cfg['apiToken']}".encode()).decode()
    return f"Basic {cred}"

def cf_request(cfg: dict, path: str, method: str = 'GET', body: dict | None = None) -> dict | None:
    base = cfg['baseUrl'].rstrip('/')
    url = f"{base}{path}"
    auth = make_auth(cfg)
    headers = {
        'Authorization': auth,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
    }
    data = json.dumps(body).encode('utf-8') if body else None
    ctx = make_ssl_ctx(cfg)
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, context=ctx) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        body_text = e.read().decode('utf-8', errors='replace')
        print(f'[ERROR] {method} {path} → {e.code}: {body_text}', file=sys.stderr)
        return None

# ── Markdown → Confluence Storage XML ───────────────────────────────────────
def _escape(text: str) -> str:
    return text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')

def md_to_storage(md: str) -> str:
    """Markdown → Confluence Storage Format XML (간략 변환)"""
    lines = md.split('\n')
    out: list[str] = []
    in_code = False
    code_lang = ''
    code_buf: list[str] = []

    for line in lines:
        # 코드블록 시작/끝
        if line.startswith('```'):
            if not in_code:
                in_code = True
                code_lang = line[3:].strip() or 'none'
                code_buf = []
            else:
                in_code = False
                body = _escape('\n'.join(code_buf))
                out.append(
                    f'<ac:structured-macro ac:name="code">'
                    f'<ac:parameter ac:name="language">{code_lang}</ac:parameter>'
                    f'<ac:plain-text-body><![CDATA[{chr(10).join(code_buf)}]]></ac:plain-text-body>'
                    f'</ac:structured-macro>'
                )
            continue

        if in_code:
            code_buf.append(line)
            continue

        # 헤딩
        m = re.match(r'^(#{1,6})\s+(.*)', line)
        if m:
            level = len(m.group(1))
            text = _escape(m.group(2))
            out.append(f'<h{level}>{text}</h{level}>')
            continue

        # 순서 없는 목록
        m = re.match(r'^(\s*)[-*]\s+(.*)', line)
        if m:
            text = _escape(m.group(2))
            out.append(f'<ul><li>{text}</li></ul>')
            continue

        # 순서 있는 목록
        m = re.match(r'^(\s*)\d+\.\s+(.*)', line)
        if m:
            text = _escape(m.group(2))
            out.append(f'<ol><li>{text}</li></ol>')
            continue

        # 수평선
        if re.match(r'^---+$', line.strip()):
            out.append('<hr />')
            continue

        # 빈 줄
        if not line.strip():
            out.append('')
            continue

        # 일반 단락
        text = _escape(line)
        # 인라인 굵게
        text = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', text)
        text = re.sub(r'__(.+?)__', r'<strong>\1</strong>', text)
        # 인라인 기울임
        text = re.sub(r'\*(.+?)\*', r'<em>\1</em>', text)
        # 인라인 코드
        text = re.sub(r'`(.+?)`', r'<code>\1</code>', text)
        out.append(f'<p>{text}</p>')

    return '\n'.join(out)

# ── 페이지 조회 ──────────────────────────────────────────────────────────────
def get_page_info(cfg: dict, page_id: str) -> dict | None:
    result = cf_request(cfg, f'/rest/api/content/{page_id}?expand=version,space')
    if not result:
        return None
    return {
        'id': result['id'],
        'title': result['title'],
        'version': result['version']['number'],
        'spaceKey': result['space']['key'],
    }

# ── 페이지 생성 ──────────────────────────────────────────────────────────────
def create_page(cfg: dict, title: str, storage_body: str,
                space_key: str, parent_id: str | None = None) -> dict | None:
    body: dict = {
        'type': 'page',
        'title': title,
        'space': {'key': space_key},
        'body': {
            'storage': {
                'value': storage_body,
                'representation': 'storage',
            }
        },
    }
    if parent_id:
        body['ancestors'] = [{'id': parent_id}]
    return cf_request(cfg, '/rest/api/content', method='POST', body=body)

# ── 페이지 수정 ──────────────────────────────────────────────────────────────
def update_page(cfg: dict, page_id: str, title: str,
                storage_body: str, current_version: int) -> dict | None:
    body = {
        'version': {'number': current_version + 1},
        'type': 'page',
        'title': title,
        'body': {
            'storage': {
                'value': storage_body,
                'representation': 'storage',
            }
        },
    }
    return cf_request(cfg, f'/rest/api/content/{page_id}', method='PUT', body=body)

# ── 메인 ────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description='Confluence 페이지 생성/수정')
    sub = parser.add_subparsers(dest='cmd', required=True)

    # create
    p_create = sub.add_parser('create', help='새 페이지 생성')
    p_create.add_argument('title', help='페이지 제목')
    p_create.add_argument('file', help='Markdown 파일 경로 (- 이면 stdin)')
    p_create.add_argument('--space', default=None, help='스페이스 키 (기본: mcp-config.json 값)')
    p_create.add_argument('--parent', default=None, help='부모 페이지 ID')

    # update
    p_update = sub.add_parser('update', help='기존 페이지 수정')
    p_update.add_argument('title', help='새 제목')
    p_update.add_argument('file', help='Markdown 파일 경로 (- 이면 stdin)')
    p_update.add_argument('--page-id', required=True, help='수정할 페이지 ID')

    args = parser.parse_args()
    cfg = load_config()

    # Markdown 읽기
    if args.file == '-':
        md = sys.stdin.read()
    else:
        md = Path(args.file).read_text(encoding='utf-8')

    storage = md_to_storage(md)

    if args.cmd == 'create':
        space_key = args.space or cfg.get('spaceKey', '')
        if not space_key:
            print('[ERROR] --space 또는 mcp-config.json spaceKey 필요', file=sys.stderr)
            sys.exit(1)
        result = create_page(cfg, args.title, storage, space_key, args.parent)
        if result:
            page_id = result.get('id', '?')
            url = cfg['baseUrl'].rstrip('/') + result.get('_links', {}).get('webui', '')
            print(f'[OK] 생성 완료 — pageId={page_id}')
            if url:
                print(f'     URL: {url}')
        else:
            print('[ERROR] 생성 실패', file=sys.stderr)
            sys.exit(1)

    elif args.cmd == 'update':
        info = get_page_info(cfg, args.page_id)
        if not info:
            print('[ERROR] 페이지 정보 조회 실패', file=sys.stderr)
            sys.exit(1)
        result = update_page(cfg, args.page_id, args.title, storage, info['version'])
        if result:
            print(f'[OK] 수정 완료 — pageId={args.page_id}, version={info["version"] + 1}')
        else:
            print('[ERROR] 수정 실패', file=sys.stderr)
            sys.exit(1)

if __name__ == '__main__':
    main()
